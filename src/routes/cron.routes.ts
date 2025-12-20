/**
 * Routes pour tâches cron/scheduled (emails, nettoyage, backup, etc.)
 * À protéger avec API key en production
 */
import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { sendAbandonedCartEmails } from '../services/abandonedCartService.js';
import { backupService, createDatabaseBackup } from '../services/backupService.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/cron/abandoned-carts
 * Envoie les emails pour les paniers abandonnés
 * À appeler périodiquement (ex: toutes les heures)
 * Envoie automatiquement :
 * - Premier email à 24h
 * - Second email (rappel) à 48h
 */
router.post('/abandoned-carts', requireAdminAuth, async (_req, res) => {
  try {
    // Envoyer premier email (24h)
    const result24h = await sendAbandonedCartEmails(24, 'first');

    // Envoyer second email (48h)
    const result48h = await sendAbandonedCartEmails(48, 'second');

    res.json({
      success: true,
      firstEmail: {
        sent: result24h.sent,
        failed: result24h.failed,
      },
      secondEmail: {
        sent: result48h.sent,
        failed: result48h.failed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Erreur cron abandoned carts', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/cron/health
 * Health check pour cron jobs
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      email:
        !!process.env.RESEND_API_KEY ||
        !!process.env.SENDGRID_API_KEY ||
        (!!process.env.MAILGUN_API_KEY && !!process.env.MAILGUN_DOMAIN),
      backup: !!process.env.SUPABASE_DB_PASSWORD,
    },
  });
});

/**
 * POST /api/cron/backup
 * Crée un backup de la base de données
 * À appeler périodiquement (ex: quotidiennement)
 * Protégé par authentification admin
 */
router.post(
  '/backup',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    try {
      const result = await createDatabaseBackup();

      if (result.success) {
        // Envoyer notification de succès si configuré
        if (process.env.BACKUP_NOTIFICATION_EMAIL) {
          try {
            const { sendEmail } = await import('../services/emailService.js');
            await sendEmail({
              to: process.env.BACKUP_NOTIFICATION_EMAIL,
              subject: '✅ Backup DB réussi - ZenFlow',
              html: `
                <h2>Backup de la base de données réussi</h2>
                <p><strong>Date:</strong> ${new Date(result.timestamp).toLocaleString('fr-FR')}</p>
                <p><strong>Taille:</strong> ${result.backupSize ? `${(result.backupSize / 1024 / 1024).toFixed(2)} MB` : 'N/A'}</p>
                <p><strong>Durée:</strong> ${(result.duration / 1000).toFixed(2)}s</p>
                ${result.backupPath ? `<p><strong>Fichier:</strong> ${result.backupPath}</p>` : ''}
              `,
            });
          } catch (emailError) {
            logger.warn('Failed to send backup success notification', { error: emailError });
          }
        }

        return res.json({
          message: 'Backup créé avec succès',
          ...result,
        });
      } else {
        // Envoyer notification d'échec
        if (process.env.BACKUP_NOTIFICATION_EMAIL) {
          try {
            const { sendEmail } = await import('../services/emailService.js');
            await sendEmail({
              to: process.env.BACKUP_NOTIFICATION_EMAIL,
              subject: '❌ Backup DB échoué - ZenFlow',
              html: `
                <h2>Échec du backup de la base de données</h2>
                <p><strong>Date:</strong> ${new Date(result.timestamp).toLocaleString('fr-FR')}</p>
                <p><strong>Erreur:</strong> ${result.error || 'Erreur inconnue'}</p>
                <p><strong>Durée:</strong> ${(result.duration / 1000).toFixed(2)}s</p>
                <p style="color: red;">⚠️ Action requise: Vérifier la configuration du backup</p>
              `,
            });
          } catch (emailError) {
            logger.warn('Failed to send backup failure notification', { error: emailError });
          }
        }

        return res.status(500).json({
          message: 'Échec du backup',
          ...result,
        });
      }
    } catch (error) {
      throw handleServiceError(error, 'createBackup', 'Erreur création backup DB');
    }
  })
);

/**
 * GET /api/cron/backups
 * Liste les backups disponibles
 */
router.get(
  '/backups',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    try {
      const backups = await backupService.listBackups();
      return res.json({
        backups: backups.map((b) => ({
          name: b.name,
          size: b.size,
          sizeFormatted: `${(b.size / 1024 / 1024).toFixed(2)} MB`,
          date: b.date.toISOString(),
          age: `${Math.floor((Date.now() - b.date.getTime()) / (1000 * 60 * 60 * 24))} days`,
        })),
        count: backups.length,
      });
    } catch (error) {
      throw handleServiceError(error, 'listBackups', 'Erreur liste backups');
    }
  })
);

export default router;
