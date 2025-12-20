/**
 * Service d'envoi d'emails (Resend/SendGrid/Mailgun)
 * Support pour paniers abandonnés et notifications
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { canSendEmail } from './emailPreferencesService.js';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  attachments?: EmailAttachment[];
}

export function generateOrderConfirmationEmailHTML(params: {
  orderNumber: string;
  total: number;
  createdAt?: string;
  shippingName?: string;
  shippingAddressLine?: string;
  items?: Array<{ title: string; quantity: number; unitPrice: number }>;
}): string {
  const createdAt = params.createdAt ? new Date(params.createdAt).toLocaleString('fr-FR') : undefined;
  const items = Array.isArray(params.items) ? params.items : [];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px;">
    <h1 style="margin: 0 0 12px; color: #db2777;">Commande confirmée ✅</h1>
    <p style="margin: 0 0 16px; color: #374151;">
      Merci pour votre achat${params.shippingName ? `, ${params.shippingName}` : ''} !
    </p>

    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Numéro de commande</p>
      <p style="margin: 4px 0 0; font-size: 22px; font-weight: 700; color: #059669;">${params.orderNumber}</p>
      <p style="margin: 10px 0 0; color: #374151;">
        <strong>Total :</strong> ${params.total.toFixed(2)}€
      </p>
      ${createdAt ? `<p style="margin: 6px 0 0; color: #6b7280; font-size: 14px;">Date : ${createdAt}</p>` : ''}
    </div>

    ${params.shippingAddressLine ? `
      <div style="margin: 16px 0;">
        <p style="margin: 0 0 6px; font-weight: 700;">Adresse de livraison</p>
        <p style="margin: 0; color: #374151;">${params.shippingAddressLine}</p>
      </div>
    ` : ''}

    ${items.length > 0 ? `
      <div style="margin: 16px 0;">
        <p style="margin: 0 0 10px; font-weight: 700;">Articles</p>
        <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
          ${items.map((it) => `
            <div style="display:flex; justify-content:space-between; gap:12px; padding:12px 14px; border-top:1px solid #f3f4f6;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight:600; color:#111827;">${String(it.title)}</div>
                <div style="color:#6b7280; font-size:13px;">Qté: ${it.quantity} × ${it.unitPrice.toFixed(2)}€</div>
              </div>
              <div style="font-weight:700; color:#059669; white-space:nowrap;">
                ${(it.unitPrice * it.quantity).toFixed(2)}€
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <p style="margin: 18px 0 0; color: #6b7280; font-size: 14px;">
      Vous recevrez un email quand votre commande sera expédiée.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
    <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
      © ${new Date().getFullYear()} ZenFlow — Tous droits réservés
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Envoie un email (implémentation flexible)
 * Supporte Resend (recommandé), SendGrid ou Mailgun
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const emailProvider = process.env.EMAIL_PROVIDER || 'resend';
    const fromEmail = options.from || process.env.EMAIL_FROM || 'noreply@zenflow.com';

    if (emailProvider === 'resend') {
      return await sendEmailResend({
        ...options,
        from: fromEmail,
      });
    } else if (emailProvider === 'sendgrid') {
      return await sendEmailSendGrid({
        ...options,
        from: fromEmail,
      });
    } else if (emailProvider === 'mailgun') {
      return await sendEmailMailgun({
        ...options,
        from: fromEmail,
      });
    } else {
      logger.warn('Aucun provider email configuré - email non envoyé', { to: options.to });
      return false;
    }
  } catch (error: any) {
    logger.error('Erreur envoi email', error, { to: options.to });
    return false;
  }
}

/**
 * Envoie un email via Mailgun (HTTP API)
 * Variables:
 * - MAILGUN_API_KEY
 * - MAILGUN_DOMAIN (ex: mg.votredomaine.com)
 *
 * Note: la vérification de domaine est requise côté Mailgun.
 */
async function sendEmailMailgun(options: EmailOptions): Promise<boolean> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;

  if (!apiKey || !domain) {
    logger.warn('MAILGUN_API_KEY ou MAILGUN_DOMAIN non configuré - email non envoyé');
    return false;
  }

  try {
    const url = `https://api.mailgun.net/v3/${domain}/messages`;

    const params = new URLSearchParams();
    params.set('from', options.from || 'noreply@zenflow.com');
    params.set('to', options.to);
    params.set('subject', options.subject);
    params.set('html', options.html);

    const response = await axios.post(url, params, {
      auth: { username: 'api', password: apiKey },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });

    if (response.status >= 200 && response.status < 300) {
      logger.info('Email envoyé via Mailgun', { to: options.to, status: response.status });
      return true;
    }

    logger.warn('Réponse Mailgun non OK', { to: options.to, status: response.status });
    return false;
  } catch (error: any) {
    logger.error('Erreur Mailgun API', error, { to: options.to });
    return false;
  }
}

/**
 * Envoie un email via Resend (recommandé)
 * Nécessite: npm install resend
 * Variable: RESEND_API_KEY
 */
async function sendEmailResend(options: EmailOptions): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      logger.warn('RESEND_API_KEY non configuré - email non envoyé');
      return false;
    }

    // Import dynamique pour éviter erreur si package non installé
    // @ts-ignore - Module optionnel, peut ne pas être installé
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const emailData: any = {
      from: options.from || 'noreply@zenflow.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    // Ajouter les attachments si présents
    if (options.attachments && options.attachments.length > 0) {
      emailData.attachments = options.attachments.map((att) => ({
        filename: att.filename,
        content: att.content.toString('base64'),
        content_type: att.contentType || 'application/pdf',
      }));
    }

    const { data, error } = await resend.emails.send(emailData);

    if (error) {
      logger.error('Erreur Resend API', error);
      return false;
    }

    logger.info('Email envoyé via Resend', { to: options.to, id: data?.id });
    return true;
  } catch (error: any) {
    // Si le package n'est pas installé, on log et on retourne false
    if (error.message?.includes('Cannot find module')) {
      logger.warn('Package "resend" non installé. Installer avec: npm install resend');
      return false;
    }
    throw error;
  }
}

/**
 * Envoie un email via SendGrid
 * Nécessite: npm install @sendgrid/mail
 * Variable: SENDGRID_API_KEY
 */
async function sendEmailSendGrid(options: EmailOptions): Promise<boolean> {
  try {
    const apiKey = process.env.SENDGRID_API_KEY;

    if (!apiKey) {
      logger.warn('SENDGRID_API_KEY non configuré - email non envoyé');
      return false;
    }

    // Import dynamique
    // @ts-ignore - Module optionnel, peut ne pas être installé
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(apiKey);

    await sgMail.default.send({
      from: options.from || 'noreply@zenflow.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    logger.info('Email envoyé via SendGrid', { to: options.to });
    return true;
  } catch (error: any) {
    if (error.message?.includes('Cannot find module')) {
      logger.warn('Package "@sendgrid/mail" non installé. Installer avec: npm install @sendgrid/mail');
      return false;
    }
    throw error;
  }
}

/**
 * Génère le template HTML pour panier abandonné
 */
export function generateAbandonedCartEmailHTML(
  items: Array<{ productId: string; title: string; quantity: number; price: number }>,
  total: number,
  recoveryUrl?: string,
  emailType: 'first' | 'second' = 'first',
  promoCode?: string | null
): string {
  const itemsHTML = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <strong>${item.title}</strong><br>
        <small>Quantité: ${item.quantity} × ${item.price.toFixed(2)}€</small>
      </td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid #eee;">
        ${(item.quantity * item.price).toFixed(2)}€
      </td>
    </tr>
  `
    )
    .join('');

  const recoveryButton = recoveryUrl
    ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${recoveryUrl}"
         style="background-color: #6366f1; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 6px; display: inline-block;">
        Récupérer mon panier
      </a>
    </div>
  `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
    <h1 style="color: #6366f1; margin-top: 0;">
      ${emailType === 'second' ? '⏰ Dernière chance : Votre panier vous attend !' : 'Votre panier vous attend ! 🛒'}
    </h1>

    <p>Bonjour,</p>
    <p>
      ${
        emailType === 'second'
          ? promoCode
            ? `Nous vous offrons un code promo exclusif <strong>${promoCode}</strong> pour vous aider à finaliser votre achat ! Profitez de -10% sur votre panier.`
            : 'Nous vous envoyons un dernier rappel : vous avez toujours des articles dans votre panier. Ne les manquez pas !'
          : 'Nous avons remarqué que vous avez laissé des articles dans votre panier. Ne les oubliez pas !'
      }
    </p>

    ${promoCode ? `
    <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-weight: bold; color: #92400e;">
        🎁 Code promo : <strong style="font-size: 1.2em;">${promoCode}</strong>
      </p>
      <p style="margin: 5px 0 0 0; color: #78350f;">
        Utilisez ce code pour obtenir -10% sur votre commande. Valable 7 jours.
      </p>
    </div>
    ` : ''}

    <div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
      <h2 style="margin-top: 0;">Vos articles :</h2>
      <table style="width: 100%; border-collapse: collapse;">
        ${itemsHTML}
        <tr>
          <td style="padding: 15px 10px; border-top: 2px solid #6366f1;">
            <strong>Total</strong>
          </td>
          <td style="padding: 15px 10px; text-align: right; border-top: 2px solid #6366f1;">
            <strong>${total.toFixed(2)}€</strong>
          </td>
        </tr>
      </table>
    </div>

    ${recoveryButton}

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      Cet email a été envoyé automatiquement. Si vous avez déjà finalisé votre commande,
      vous pouvez ignorer ce message.
    </p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

    <p style="color: #999; font-size: 12px; text-align: center;">
      © ${new Date().getFullYear()} ZenFlow - Tous droits réservés
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Envoie un email de panier abandonné
 * @param emailType - 'first' pour premier email (24h), 'second' pour rappel (48h)
 */
export async function sendAbandonedCartEmail(
  email: string,
  items: Array<{ productId: string; title: string; quantity: number; price: number }>,
  total: number,
  sessionId: string,
  emailType: 'first' | 'second' = 'first',
  promoCode?: string | null,
  userId?: string
): Promise<boolean> {
  // Vérifier les préférences utilisateur si userId fourni
  if (userId) {
    const canSend = await canSendEmail(userId, 'abandoned_cart');
    if (!canSend) {
      logger.info('Email panier abandonné non envoyé (préférences utilisateur)', { userId, email });
      return false;
    }
  }
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const recoveryUrl = promoCode
    ? `${siteUrl}/cart?recover=${sessionId}&promo=${promoCode}`
    : `${siteUrl}/cart?recover=${sessionId}`;

  const html = generateAbandonedCartEmailHTML(items, total, recoveryUrl, emailType, promoCode);

  const subject =
    emailType === 'second'
      ? promoCode
        ? `🎁 ${promoCode} : -10% sur votre panier !`
        : '⏰ Dernière chance : Votre panier vous attend toujours !'
      : '🛒 Votre panier vous attend sur ZenFlow';

  return await sendEmail({
    to: email,
    subject,
    html,
  });
}

export function generateOrderStatusEmailHTML(params: {
  title: string;
  orderNumber: string;
  message: string;
  items?: Array<{ title: string; quantity: number; unitPrice: number }>;
}): string {
  const items = Array.isArray(params.items) ? params.items : [];

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px;">
    <h1 style="margin: 0 0 12px; color: #db2777;">${params.title}</h1>
    <p style="margin: 0 0 16px; color: #374151;">
      Commande <strong>${params.orderNumber}</strong>
    </p>
    <p style="margin: 0 0 16px; color: #374151;">
      ${params.message}
    </p>

    ${items.length > 0 ? `
      <div style="margin: 16px 0;">
        <p style="margin: 0 0 10px; font-weight: 700;">Articles</p>
        <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
          ${items.map((it) => `
            <div style="display:flex; justify-content:space-between; gap:12px; padding:12px 14px; border-top:1px solid #f3f4f6;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight:600; color:#111827;">${String(it.title)}</div>
                <div style="color:#6b7280; font-size:13px;">Qté: ${it.quantity} × ${it.unitPrice.toFixed(2)}€</div>
              </div>
              <div style="font-weight:700; color:#059669; white-space:nowrap;">
                ${(it.unitPrice * it.quantity).toFixed(2)}€
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <p style="margin: 18px 0 0; color: #6b7280; font-size: 14px;">
      Merci pour votre confiance.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
    <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
      © ${new Date().getFullYear()} ZenFlow — Tous droits réservés
    </p>
  </div>
</body>
</html>
  `.trim();
}

export async function sendOrderShippedEmail(params: {
  to: string;
  orderNumber: string;
  items?: Array<{ title: string; quantity: number; unitPrice: number }>;
  userId?: string; // Pour vérifier les préférences
}): Promise<boolean> {
  // Vérifier les préférences utilisateur si userId fourni
  if (params.userId) {
    const canSend = await canSendEmail(params.userId, 'order_shipped');
    if (!canSend) {
      logger.info('Email commande expédiée non envoyé (préférences utilisateur)', { userId: params.userId, email: params.to });
      return false;
    }
  }
  const html = generateOrderStatusEmailHTML({
    title: 'Commande expédiée 📦',
    orderNumber: params.orderNumber,
    message: 'Bonne nouvelle ! Votre commande a été expédiée. Vous la recevrez très bientôt.',
    items: params.items,
  });

  return await sendEmail({
    to: params.to,
    subject: `📦 Expédition — Commande ${params.orderNumber}`,
    html,
  });
}

export async function sendOrderDeliveredEmail(params: {
  to: string;
  orderNumber: string;
  items?: Array<{ title: string; quantity: number; unitPrice: number }>;
  userId?: string; // Pour vérifier les préférences
}): Promise<boolean> {
  // Vérifier les préférences utilisateur si userId fourni
  if (params.userId) {
    const canSend = await canSendEmail(params.userId, 'order_delivered');
    if (!canSend) {
      logger.info('Email commande livrée non envoyé (préférences utilisateur)', { userId: params.userId, email: params.to });
      return false;
    }
  }
  const html = generateOrderStatusEmailHTML({
    title: 'Commande livrée ✅',
    orderNumber: params.orderNumber,
    message: 'Votre commande est indiquée comme livrée. Nous espérons que tout est parfait !',
    items: params.items,
  });

  return await sendEmail({
    to: params.to,
    subject: `✅ Livraison — Commande ${params.orderNumber}`,
    html,
  });
}

export async function sendOrderConfirmationEmail(params: {
  to: string;
  orderNumber: string;
  total: number;
  createdAt?: string;
  shippingName?: string;
  shippingAddressLine?: string;
  items?: Array<{ title: string; quantity: number; unitPrice: number }>;
  userId?: string; // Pour vérifier les préférences
  // Données additionnelles pour PDF
  subtotal?: number;
  shipping?: number;
  discount?: number;
  promoCode?: string | null;
  shippingAddress?: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
  includePDF?: boolean; // Optionnel: générer PDF (désactivé par défaut si données manquantes)
}): Promise<boolean> {
  // Vérifier les préférences utilisateur si userId fourni
  if (params.userId) {
    const canSend = await canSendEmail(params.userId, 'order_confirmation');
    if (!canSend) {
      logger.info('Email confirmation commande non envoyé (préférences utilisateur)', { userId: params.userId, email: params.to });
      return false;
    }
  }
  const html = generateOrderConfirmationEmailHTML({
    orderNumber: params.orderNumber,
    total: params.total,
    createdAt: params.createdAt,
    shippingName: params.shippingName,
    shippingAddressLine: params.shippingAddressLine,
    items: params.items,
  });

  const attachments: EmailAttachment[] = [];

  // Générer PDF si demandé et données disponibles
  if (params.includePDF && params.items && params.items.length > 0) {
    try {
      const { generateInvoicePDF } = await import('./pdfInvoiceService.js');
      const pdfBuffer = await generateInvoicePDF({
        orderNumber: params.orderNumber,
        orderDate: params.createdAt || new Date().toISOString(),
        customerName: params.shippingName,
        customerEmail: params.to,
        shippingAddress: params.shippingAddress,
        items: params.items,
        subtotal: params.subtotal ?? params.total,
        shipping: params.shipping ?? 0,
        discount: params.discount ?? 0,
        total: params.total,
        promoCode: params.promoCode,
      });

      attachments.push({
        filename: `facture-${params.orderNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch (error) {
      logger.warn('Failed to generate invoice PDF (non-blocking)', {
        orderNumber: params.orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue sans PDF si génération échoue
    }
  }

  return await sendEmail({
    to: params.to,
    subject: `✅ Confirmation — Commande ${params.orderNumber}`,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
}
