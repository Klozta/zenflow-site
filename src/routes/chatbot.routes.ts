/**
 * Routes pour le chatbot IA de support client
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { chatbotService } from '../services/chatbotService.js';
import { handleServiceError } from '../utils/errorHandlers.js';

const router = Router();

/**
 * POST /api/chatbot/conversation - Créer ou récupérer une conversation
 * Body: { sessionId?: string }
 */
router.post(
  '/conversation',
  asyncHandler(async (req: any, res) => {
    try {
      const sessionId = req.body.sessionId || req.cookies?.sessionId || uuidv4();
      const userId = req.user?.id;

      // Créer cookie session si nouveau
      if (!req.cookies?.sessionId) {
        res.cookie('sessionId', sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
        });
      }

      const conversation = await chatbotService.getOrCreateConversation(sessionId, userId);
      return res.json(conversation);
    } catch (error) {
      throw handleServiceError(error, 'createConversation', 'Erreur création conversation');
    }
  })
);

/**
 * POST /api/chatbot/message - Envoyer un message et obtenir une réponse
 * Body: { conversationId: string, message: string }
 */
router.post(
  '/message',
  validate(
    z.object({
      conversationId: z.string().uuid(),
      message: z.string().min(1).max(1000),
    })
  ),
  asyncHandler(async (req: any, res) => {
    try {
      const { conversationId, message } = req.body;
      const userId = req.user?.id;

      const response = await chatbotService.sendMessage(conversationId, message, userId);
      return res.json(response);
    } catch (error) {
      throw handleServiceError(error, 'sendMessage', 'Erreur envoi message');
    }
  })
);

/**
 * GET /api/chatbot/conversation/:id/history - Récupérer l'historique d'une conversation
 */
router.get(
  '/conversation/:id/history',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { id } = req.params;
      const history = await chatbotService.getConversationHistory(id);
      return res.json({ messages: history });
    } catch (error) {
      throw handleServiceError(error, 'getHistory', 'Erreur récupération historique');
    }
  })
);

/**
 * POST /api/chatbot/conversation/:id/resolve - Résoudre une conversation
 */
router.post(
  '/conversation/:id/resolve',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      await chatbotService.resolveConversation(id);
      return res.json({ success: true });
    } catch (error) {
      throw handleServiceError(error, 'resolveConversation', 'Erreur résolution conversation');
    }
  })
);

/**
 * POST /api/chatbot/conversation/:id/escalate - Escaler vers un humain
 * Body: { reason?: string }
 */
router.post(
  '/conversation/:id/escalate',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await chatbotService.escalateToHuman(id, reason);
      return res.json({ success: true, message: 'Conversation escaladée vers un agent humain' });
    } catch (error) {
      throw handleServiceError(error, 'escalateConversation', 'Erreur escalade conversation');
    }
  })
);

/**
 * GET /api/chatbot/knowledge - Récupérer la base de connaissances (FAQ)
 * Query: category?, search?
 */
router.get(
  '/knowledge',
  asyncHandler(async (req, res) => {
    try {
      const { category, search } = req.query;
      const { supabase } = await import('../config/supabase.js');

      let query = supabase
        .from('chatbot_knowledge_base')
        .select('*')
        .eq('is_active', true);

      if (category) {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.or(`question.ilike.%${search}%,answer.ilike.%${search}%`);
      }

      query = query.order('priority', { ascending: false }).order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return res.json({ knowledge: data || [] });
    } catch (error) {
      throw handleServiceError(error, 'getKnowledge', 'Erreur récupération base de connaissances');
    }
  })
);

/**
 * POST /api/chatbot/knowledge - Ajouter une entrée à la base de connaissances (admin)
 */
router.post(
  '/knowledge',
  requireAdminAuth,
  validate(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      priority: z.number().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    try {
      const { question, answer, category, tags, priority } = req.body;
      const { supabase } = await import('../config/supabase.js');

      const { data, error } = await supabase
        .from('chatbot_knowledge_base')
        .insert({
          question,
          answer,
          category: category || 'general',
          tags: tags || [],
          priority: priority || 0,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return res.json({ success: true, knowledge: data });
    } catch (error) {
      throw handleServiceError(error, 'addKnowledge', 'Erreur ajout base de connaissances');
    }
  })
);

export default router;

