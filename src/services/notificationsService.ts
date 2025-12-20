/**
 * Service de notifications pour les alertes
 * Supporte plusieurs canaux : Email, Slack, Webhooks
 *
 * @module services/notificationsService
 */

import { logger } from '../utils/logger.js';
import type { Alert, AlertSeverity } from './alertingService.js';

export type NotificationChannel = 'email' | 'slack' | 'webhook';

export interface NotificationConfig {
  channels: NotificationChannel[];
  email?: {
    to: string | string[];
    from?: string;
  };
  slack?: {
    webhookUrl: string;
    channel?: string;
    username?: string;
  };
  webhook?: {
    url: string;
    secret?: string; // Pour signer les webhooks
  };
}

export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Service de notifications pour les alertes
 */
export class NotificationsService {
  /**
   * Envoie une notification d'alerte via les canaux configurés
   */
  async sendAlert(alert: Alert, config: NotificationConfig): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    // Envoyer via chaque canal configuré
    for (const channel of config.channels) {
      try {
        let result: NotificationResult;

        switch (channel) {
          case 'email':
            result = await this.sendEmail(alert, config.email!);
            break;
          case 'slack':
            result = await this.sendSlack(alert, config.slack!);
            break;
          case 'webhook':
            result = await this.sendWebhook(alert, config.webhook!);
            break;
          default:
            result = {
              channel,
              success: false,
              error: `Canal non supporté: ${channel}`,
              timestamp: new Date().toISOString(),
            };
        }

        results.push(result);
      } catch (error: any) {
        logger.error(`Erreur envoi notification ${channel}`, error);
        results.push({
          channel,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Envoie une alerte par email
   */
  private async sendEmail(alert: Alert, emailConfig: NonNullable<NotificationConfig['email']>): Promise<NotificationResult> {
    try {
      const { sendEmail } = await import('./emailService.js');
      const recipients = Array.isArray(emailConfig.to) ? emailConfig.to : [emailConfig.to];
      const from = emailConfig.from || process.env.EMAIL_FROM || 'alerts@zenflow.com';

      const severityEmoji = this.getSeverityEmoji(alert.severity);
      const subject = `${severityEmoji} [${alert.severity.toUpperCase()}] ${alert.rule}`;

      const html = this.generateEmailTemplate(alert);

      let successCount = 0;
      let lastError: string | undefined;

      // Envoyer à chaque destinataire
      for (const recipient of recipients) {
        try {
          const sent = await sendEmail({
            to: recipient,
            from,
            subject,
            html,
          });

          if (sent) {
            successCount++;
          } else {
            lastError = 'Échec envoi email';
          }
        } catch (error: any) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.error(`Erreur envoi email à ${recipient}`, error);
        }
      }

      return {
        channel: 'email',
        success: successCount > 0,
        error: successCount === 0 ? lastError : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        channel: 'email',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Envoie une alerte sur Slack
   */
  private async sendSlack(alert: Alert, slackConfig: NonNullable<NotificationConfig['slack']>): Promise<NotificationResult> {
    try {
      const severityColor = this.getSeverityColor(alert.severity);
      const severityEmoji = this.getSeverityEmoji(alert.severity);

      const payload = {
        channel: slackConfig.channel || '#alerts',
        username: slackConfig.username || 'ZenFlow Alerts',
        icon_emoji: ':warning:',
        attachments: [
          {
            color: severityColor,
            title: `${severityEmoji} ${alert.rule}`,
            text: alert.message,
            fields: [
              {
                title: 'Métrique',
                value: alert.metric,
                short: true,
              },
              {
                title: 'Valeur',
                value: String(alert.value),
                short: true,
              },
              ...(alert.threshold !== undefined
                ? [
                    {
                      title: 'Seuil',
                      value: String(alert.threshold),
                      short: true,
                    },
                  ]
                : []),
              {
                title: 'Sévérité',
                value: alert.severity.toUpperCase(),
                short: true,
              },
            ],
            footer: 'ZenFlow Monitoring',
            ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
          },
        ],
      };

      const response = await fetch(slackConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack API error: ${response.status} - ${errorText}`);
      }

      return {
        channel: 'slack',
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        channel: 'slack',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Envoie une alerte via webhook
   */
  private async sendWebhook(alert: Alert, webhookConfig: NonNullable<NotificationConfig['webhook']>): Promise<NotificationResult> {
    try {
      const payload = {
        alert: {
          id: alert.id,
          rule: alert.rule,
          metric: alert.metric,
          value: alert.value,
          threshold: alert.threshold,
          severity: alert.severity,
          message: alert.message,
          timestamp: alert.timestamp,
        },
        timestamp: new Date().toISOString(),
      };

      // Ajouter une signature si secret fourni
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (webhookConfig.secret) {
        const crypto = await import('crypto');
        const signature = crypto
          .createHmac('sha256', webhookConfig.secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Webhook-Signature'] = signature;
      }

      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook error: ${response.status} - ${errorText}`);
      }

      return {
        channel: 'webhook',
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        channel: 'webhook',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Génère un template HTML pour l'email
   */
  private generateEmailTemplate(alert: Alert): string {
    const severityColor = this.getSeverityColor(alert.severity);
    const severityEmoji = this.getSeverityEmoji(alert.severity);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${severityColor}; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .footer { text-align: center; padding: 10px; color: #666; font-size: 12px; }
    .metric { background-color: white; padding: 15px; margin: 10px 0; border-left: 4px solid ${severityColor}; }
    .label { font-weight: bold; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${severityEmoji} ${alert.rule}</h1>
      <p style="margin: 0;">${alert.severity.toUpperCase()}</p>
    </div>
    <div class="content">
      <p><strong>Message:</strong></p>
      <p>${alert.message}</p>

      <div class="metric">
        <div><span class="label">Métrique:</span> ${alert.metric}</div>
        <div><span class="label">Valeur:</span> ${alert.value}</div>
        ${alert.threshold !== undefined ? `<div><span class="label">Seuil:</span> ${alert.threshold}</div>` : ''}
        <div><span class="label">Horodatage:</span> ${new Date(alert.timestamp).toLocaleString('fr-FR')}</div>
      </div>
    </div>
    <div class="footer">
      <p>ZenFlow Monitoring System</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Retourne l'emoji associé à la sévérité
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚠️';
    }
  }

  /**
   * Retourne la couleur (hex) associée à la sévérité
   */
  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '#dc3545'; // Rouge
      case 'warning':
        return '#ffc107'; // Jaune
      case 'info':
        return '#0dcaf0'; // Bleu
      default:
        return '#6c757d'; // Gris
    }
  }
}

// Export singleton
export const notificationsService = new NotificationsService();

/**
 * Génère une configuration de notifications depuis les variables d'environnement
 * Permet de configurer les canaux par défaut via .env
 */
export function getDefaultNotificationConfig(): NotificationConfig | null {
  const channels: NotificationChannel[] = [];
  const config: NotificationConfig = {
    channels: [],
  };

  // Email
  if (process.env.ALERT_EMAIL_TO) {
    channels.push('email');
    config.email = {
      to: process.env.ALERT_EMAIL_TO.split(',').map(e => e.trim()),
      from: process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM || 'alerts@zenflow.com',
    };
  }

  // Slack
  if (process.env.SLACK_WEBHOOK_URL) {
    channels.push('slack');
    config.slack = {
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || '#alerts',
      username: process.env.SLACK_USERNAME || 'ZenFlow Alerts',
    };
  }

  // Webhook
  if (process.env.ALERT_WEBHOOK_URL) {
    channels.push('webhook');
    config.webhook = {
      url: process.env.ALERT_WEBHOOK_URL,
      secret: process.env.ALERT_WEBHOOK_SECRET, // Optionnel
    };
  }

  if (channels.length === 0) {
    return null; // Aucun canal configuré
  }

  config.channels = channels;
  return config;
}

/**
 * Envoie une notification d'alerte avec configuration par défaut
 * Utilise les variables d'environnement si aucune config n'est fournie
 */
export async function sendAlertNotification(
  alert: Alert,
  customConfig?: NotificationConfig
): Promise<NotificationResult[]> {
  const config = customConfig || getDefaultNotificationConfig();

  if (!config) {
    // Aucune configuration disponible, logger seulement
    logger.warn('Aucune configuration de notification disponible pour l\'alerte', {
      alertId: alert.id,
      rule: alert.rule,
      severity: alert.severity,
    });
    return [];
  }

  return notificationsService.sendAlert(alert, config);
}

