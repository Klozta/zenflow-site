/**
 * Routes pour le formulaire de contact
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import { sendEmail } from '../services/emailService.js';
import { logger } from '../utils/logger.js';

const router = Router();

const contactSchema = z.object({
  name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères'),
  email: z.string().email('Email invalide'),
  subject: z.string().min(5, 'Le sujet doit contenir au moins 5 caractères'),
  message: z.string().min(10, 'Le message doit contenir au moins 10 caractères'),
});

/**
 * POST /api/contact
 * Envoie un message de contact
 */
router.post(
  '/',
  validate(contactSchema),
  async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;

      // Envoyer l'email de notification (si service email configuré)
      const contactEmail = process.env.CONTACT_EMAIL || 'contact@zenflow.fr';

      try {
        await sendEmail({
          to: contactEmail,
          subject: `[Contact] ${subject}`,
          html: `
            <h2>Nouveau message de contact</h2>
            <p><strong>De :</strong> ${name} (${email})</p>
            <p><strong>Sujet :</strong> ${subject}</p>
            <hr>
            <p>${message.replace(/\n/g, '<br>')}</p>
          `,
          text: `
Nouveau message de contact
De : ${name} (${email})
Sujet : ${subject}

${message}
          `,
        });

        logger.info('Contact form submitted', { email, subject });
      } catch (emailError) {
        // Ne pas bloquer la réponse si l'email échoue
        const errorMsg = emailError instanceof Error ? emailError.message : String(emailError);
        logger.warn('Failed to send contact email', { error: errorMsg });
      }

      // Envoyer un email de confirmation au client (optionnel)
      try {
        await sendEmail({
          to: email,
          subject: 'Votre message a bien été reçu - ZenFlow',
          html: `
            <h2>Bonjour ${name},</h2>
            <p>Nous avons bien reçu votre message concernant : <strong>${subject}</strong></p>
            <p>Notre équipe vous répondra dans les plus brefs délais.</p>
            <hr>
            <p><em>ZenFlow</em></p>
          `,
          text: `
Bonjour ${name},

Nous avons bien reçu votre message concernant : ${subject}

Notre équipe vous répondra dans les plus brefs délais.

ZenFlow
          `,
        });
      } catch (confirmationError) {
        // Non-bloquant
        logger.warn('Failed to send confirmation email', { error: confirmationError });
      }

      return res.status(200).json({
        success: true,
        message: 'Votre message a été envoyé avec succès. Nous vous répondrons rapidement.',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Contact form error', { error: errorMessage });
      return res.status(500).json({
        error: 'Une erreur est survenue lors de l\'envoi de votre message. Veuillez réessayer.',
      });
    }
  }
);

export default router;
