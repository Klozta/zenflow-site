/**
 * Service Chatbot IA - Support Client Intelligent
 * Répond automatiquement aux questions des clients avec contexte produits
 */

import { supabase } from '../config/supabase.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    productId?: string;
    orderId?: string;
    intent?: string;
    confidence?: number;
  };
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId?: string;
  sessionId: string;
  status: 'active' | 'resolved' | 'escalated';
  context?: {
    lastOrderId?: string;
    lastProductViewed?: string;
    userTier?: string;
  };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatbotResponse {
  message: string;
  suggestions?: string[];
  quickActions?: Array<{
    label: string;
    action: string;
    url?: string;
  }>;
  productRecommendations?: Array<{
    id: string;
    title: string;
    price: number;
    image: string;
  }>;
  needsHuman?: boolean;
}

/**
 * Service Chatbot IA
 */
export class ChatbotService {
  private readonly MAX_CONTEXT_MESSAGES = 10;
  // SYSTEM_PROMPT utilisé pour intégration IA future (OpenAI/Anthropic)
  // @ts-ignore - Utilisé dans callAIProvider (méthode future)
  private readonly SYSTEM_PROMPT = `Tu es l'assistant virtuel de ZenFlow, une boutique en ligne de produits pour femmes (bijoux, mode, beauté, décoration).

Ton rôle :
- Répondre aux questions des clients de manière amicale et professionnelle
- Aider avec les commandes, produits, livraisons, retours
- Recommander des produits pertinents
- Escalader vers un humain si nécessaire

Règles importantes :
- Sois concis et clair
- Utilise des emojis avec modération
- Propose toujours des actions concrètes
- Si tu ne sais pas, propose de contacter le support
- Ne jamais inventer d'informations sur les commandes ou produits

Format de réponse : JSON avec {
  "message": "réponse textuelle",
  "suggestions": ["suggestion1", "suggestion2"],
  "quickActions": [{"label": "...", "action": "...", "url": "..."}],
  "needsHuman": false
}`;

  /**
   * Crée ou récupère une conversation
   */
  async getOrCreateConversation(sessionId: string, userId?: string): Promise<Conversation> {
    try {
      // Chercher conversation active existante
      const { data: existing, error: findError } = await supabase
        .from('chatbot_conversations')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (existing && !findError) {
        return this.mapConversation(existing);
      }

      // Créer nouvelle conversation
      const { data: newConv, error: createError } = await supabase
        .from('chatbot_conversations')
        .insert({
          session_id: sessionId,
          user_id: userId || null,
          status: 'active',
          message_count: 0,
        })
        .select()
        .single();

      if (createError || !newConv) {
        throw createError || new Error('Failed to create conversation');
      }

      return this.mapConversation(newConv);
    } catch (error) {
      throw handleServiceError(error, 'getOrCreateConversation', 'Erreur gestion conversation');
    }
  }

  /**
   * Envoie un message et obtient une réponse du chatbot
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
    userId?: string
  ): Promise<ChatbotResponse> {
    try {
      // Enregistrer le message utilisateur
      await this.saveMessage(conversationId, 'user', userMessage);

      // Récupérer le contexte (historique + infos utilisateur)
      const context = await this.buildContext(conversationId, userId);

      // Générer la réponse avec IA
      const response = await this.generateResponse(userMessage, context);

      // Enregistrer la réponse
      await this.saveMessage(conversationId, 'assistant', response.message, response);

      // Mettre à jour la conversation
      await supabase
        .from('chatbot_conversations')
        .update({
          updated_at: new Date().toISOString(),
          message_count: context.messages.length + 2,
        })
        .eq('id', conversationId);

      return response;
    } catch (error) {
      throw handleServiceError(error, 'sendMessage', 'Erreur envoi message');
    }
  }

  /**
   * Construit le contexte pour l'IA
   */
  private async buildContext(conversationId: string, userId?: string): Promise<{
    messages: ChatMessage[];
    userInfo?: {
      lastOrder?: any;
      lastProductViewed?: any;
      loyaltyTier?: string;
    };
    products?: any[];
  }> {
    // Récupérer les messages récents
    const { data: messages, error: msgError } = await supabase
      .from('chatbot_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(this.MAX_CONTEXT_MESSAGES);

    if (msgError) {
      logger.warn('Error fetching messages', { error: msgError, conversationId });
    }

    const recentMessages = (messages || [])
      .reverse()
      .map((m: any) => this.mapMessage(m)) as ChatMessage[];

    // Récupérer infos utilisateur si connecté
    let userInfo: any = undefined;
    if (userId) {
      try {
        // Dernière commande
        const { data: lastOrder } = await supabase
          .from('orders')
          .select('id, order_number, status, total, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Dernier produit consulté
        const { data: lastProduct } = await supabase
          .from('view_history')
          .select('product_id')
          .eq('user_id', userId)
          .order('viewed_at', { ascending: false })
          .limit(1)
          .single();

        userInfo = {
          lastOrder: lastOrder || undefined,
          lastProductViewed: lastProduct?.product_id || undefined,
        };
      } catch {
        // Ignorer erreurs
      }
    }

    return {
      messages: recentMessages,
      userInfo,
    };
  }

  /**
   * Génère une réponse avec IA (fallback vers règles si pas d'IA)
   */
  private async generateResponse(
    userMessage: string,
    context: { messages: ChatMessage[]; userInfo?: any; products?: any[] }
  ): Promise<ChatbotResponse> {
    const lowerMessage = userMessage.toLowerCase().trim();

    // Détection d'intent simple (fallback si pas d'IA configurée)
    if (lowerMessage.includes('commande') || lowerMessage.includes('order')) {
      if (context.userInfo?.lastOrder) {
        return {
          message: `Votre dernière commande #${context.userInfo.lastOrder.order_number} est au statut "${context.userInfo.lastOrder.status}". Vous pouvez suivre votre commande dans votre espace compte.`,
          suggestions: ['Voir mes commandes', 'Contacter le support'],
          quickActions: [
            { label: 'Mes commandes', action: 'view_orders', url: '/account/orders' },
          ],
        };
      }
      return {
        message: 'Je peux vous aider avec vos commandes. Connectez-vous pour voir l\'historique de vos commandes.',
        suggestions: ['Se connecter', 'Créer un compte'],
        quickActions: [
          { label: 'Connexion', action: 'login', url: '/auth/login' },
        ],
      };
    }

    if (lowerMessage.includes('livraison') || lowerMessage.includes('delivery') || lowerMessage.includes('shipping')) {
      return {
        message: 'Livraison gratuite à partir de 40€ ! Sinon, frais de port de 5€. Délai de livraison : 5-10 jours ouvrés.',
        suggestions: ['Voir les produits', 'Conditions de livraison'],
      };
    }

    if (lowerMessage.includes('retour') || lowerMessage.includes('refund') || lowerMessage.includes('remboursement')) {
      return {
        message: 'Vous avez 14 jours pour retourner un article non utilisé. Contactez-nous via le formulaire de contact pour initier un retour.',
        suggestions: ['Formulaire de contact', 'Politique de retour'],
        quickActions: [
          { label: 'Contacter le support', action: 'contact', url: '/contact' },
        ],
      };
    }

    if (lowerMessage.includes('produit') || lowerMessage.includes('product') || lowerMessage.includes('article')) {
      return {
        message: 'Je peux vous aider à trouver des produits. Que recherchez-vous exactement ?',
        suggestions: ['Bijoux', 'Mode', 'Beauté', 'Décoration'],
        quickActions: [
          { label: 'Voir le catalogue', action: 'browse', url: '/products' },
        ],
      };
    }

    if (lowerMessage.includes('prix') || lowerMessage.includes('price') || lowerMessage.includes('coût')) {
      return {
        message: 'Les prix varient selon les produits. Vous pouvez filtrer par prix dans le catalogue. Livraison gratuite dès 40€ d\'achat !',
        suggestions: ['Voir le catalogue', 'Filtrer par prix'],
        quickActions: [
          { label: 'Catalogue', action: 'browse', url: '/products' },
        ],
      };
    }

    // Tentative d'utilisation d'IA externe si configurée
    const aiProvider = process.env.AI_PROVIDER || 'none';
    if (aiProvider !== 'none') {
      try {
        return await this.callAIProvider(userMessage, context, aiProvider);
      } catch (error) {
        logger.warn('AI provider failed, using fallback', { error, provider: aiProvider });
      }
    }

    // Réponse par défaut
    return {
      message: 'Je suis là pour vous aider ! Posez-moi une question sur nos produits, commandes, livraisons ou retours.',
      suggestions: [
        'Suivre ma commande',
        'Voir le catalogue',
        'Conditions de livraison',
        'Politique de retour',
      ],
      quickActions: [
        { label: 'Catalogue', action: 'browse', url: '/products' },
        { label: 'Mon compte', action: 'account', url: '/account' },
        { label: 'Support', action: 'contact', url: '/contact' },
      ],
    };
  }

  /**
   * Appelle un fournisseur d'IA externe (OpenAI, Anthropic, etc.)
   */
  private async callAIProvider(
    _userMessage: string,
    _context: { messages: ChatMessage[]; userInfo?: any },
    _provider: string
  ): Promise<ChatbotResponse> {
    // Placeholder pour intégration IA réelle
    // Exemple avec OpenAI :
    /*
    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const messages = [
        { role: 'system', content: this.SYSTEM_PROMPT },
        ...context.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      });

      return JSON.parse(completion.choices[0].message.content || '{}');
    }
    */

    // Pour l'instant, retourner une réponse par défaut
    throw new Error('AI provider not implemented');
  }

  /**
   * Enregistre un message
   */
  private async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: any
  ): Promise<void> {
    const { error } = await supabase.from('chatbot_messages').insert({
      conversation_id: conversationId,
      role,
      content,
      metadata: metadata || {},
    });

    if (error) {
      logger.warn('Failed to save message', { error, conversationId, role });
    }
  }

  /**
   * Récupère l'historique d'une conversation
   */
  async getConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabase
        .from('chatbot_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return (data || []).map((m: any) => this.mapMessage(m));
    } catch (error) {
      throw handleServiceError(error, 'getConversationHistory', 'Erreur récupération historique');
    }
  }

  /**
   * Résout une conversation
   */
  async resolveConversation(conversationId: string): Promise<void> {
    await supabase
      .from('chatbot_conversations')
      .update({ status: 'resolved' })
      .eq('id', conversationId);
  }

  /**
   * Escale vers un humain
   */
  async escalateToHuman(conversationId: string, reason?: string): Promise<void> {
    await supabase
      .from('chatbot_conversations')
      .update({
        status: 'escalated',
        metadata: { escalationReason: reason },
      })
      .eq('id', conversationId);

    // TODO: Notifier les admins
    logger.info('Conversation escalated to human', { conversationId, reason });
  }

  // Helpers
  private mapConversation(data: any): Conversation {
    return {
      id: data.id,
      userId: data.user_id,
      sessionId: data.session_id,
      status: data.status,
      context: data.context,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      messageCount: data.message_count || 0,
    };
  }

  private mapMessage(data: any): ChatMessage {
    return {
      id: data.id,
      conversationId: data.conversation_id,
      role: data.role,
      content: data.content,
      metadata: data.metadata,
      createdAt: data.created_at,
    };
  }
}

// Instance singleton
export const chatbotService = new ChatbotService();

