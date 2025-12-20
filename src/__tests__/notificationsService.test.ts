/**
 * Tests unitaires pour notificationsService
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Alert } from '../services/alertingService.js';
import {
    getDefaultNotificationConfig,
    notificationsService,
    sendAlertNotification,
    type NotificationConfig,
} from '../services/notificationsService.js';

// Mock fetch global
global.fetch = jest.fn() as jest.Mock;

// Mock emailService
jest.mock('../services/emailService.js', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

describe('NotificationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset env vars
    delete process.env.ALERT_EMAIL_TO;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  const mockAlert: Alert = {
    id: 'test-alert-1',
    rule: 'Test Rule',
    metric: 'test_metric',
    value: 42,
    threshold: 50,
    severity: 'warning',
    message: 'Test alert message',
    timestamp: new Date().toISOString(),
    dedupKey: 'test:test_metric',
  };

  describe('getDefaultNotificationConfig', () => {
    it('devrait retourner null si aucun canal configuré', () => {
      const config = getDefaultNotificationConfig();
      expect(config).toBeNull();
    });

    it('devrait retourner config email si ALERT_EMAIL_TO est défini', () => {
      process.env.ALERT_EMAIL_TO = 'admin@example.com';
      const config = getDefaultNotificationConfig();
      expect(config).not.toBeNull();
      expect(config?.channels).toContain('email');
      expect(config?.email?.to).toBe('admin@example.com');
    });

    it('devrait supporter plusieurs emails séparés par virgule', () => {
      process.env.ALERT_EMAIL_TO = 'admin@example.com,team@example.com';
      const config = getDefaultNotificationConfig();
      expect(config?.email?.to).toEqual(['admin@example.com', 'team@example.com']);
    });

    it('devrait retourner config Slack si SLACK_WEBHOOK_URL est défini', () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/xxx';
      const config = getDefaultNotificationConfig();
      expect(config).not.toBeNull();
      expect(config?.channels).toContain('slack');
      expect(config?.slack?.webhookUrl).toBe('https://hooks.slack.com/services/xxx');
    });

    it('devrait retourner config webhook si ALERT_WEBHOOK_URL est défini', () => {
      process.env.ALERT_WEBHOOK_URL = 'https://webhook.example.com/alerts';
      const config = getDefaultNotificationConfig();
      expect(config).not.toBeNull();
      expect(config?.channels).toContain('webhook');
      expect(config?.webhook?.url).toBe('https://webhook.example.com/alerts');
    });

    it('devrait combiner plusieurs canaux', () => {
      process.env.ALERT_EMAIL_TO = 'admin@example.com';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/xxx';
      const config = getDefaultNotificationConfig();
      expect(config?.channels).toContain('email');
      expect(config?.channels).toContain('slack');
      expect(config?.channels.length).toBe(2);
    });
  });

  describe('sendAlertNotification', () => {
    it('devrait logger un warning si aucune config disponible', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const results = await sendAlertNotification(mockAlert);
      expect(results).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('devrait envoyer une notification email si configuré', async () => {
      const config: NotificationConfig = {
        channels: ['email'],
        email: {
          to: 'admin@example.com',
          from: 'alerts@test.com',
        },
      };

      const { sendEmail } = await import('../services/emailService.js');
      const results = await sendAlertNotification(mockAlert, config);

      expect(results.length).toBe(1);
      expect(results[0].channel).toBe('email');
      expect(results[0].success).toBe(true);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringContaining('Test Rule'),
          html: expect.any(String),
        })
      );
    });

    it('devrait envoyer une notification Slack si configuré', async () => {
      const config: NotificationConfig = {
        channels: ['slack'],
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/xxx',
          channel: '#alerts',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const results = await sendAlertNotification(mockAlert, config);

      expect(results.length).toBe(1);
      expect(results[0].channel).toBe('slack');
      expect(results[0].success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/xxx',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('Test Rule'),
        })
      );
    });

    it('devrait envoyer une notification webhook si configuré', async () => {
      const config: NotificationConfig = {
        channels: ['webhook'],
        webhook: {
          url: 'https://webhook.example.com/alerts',
          secret: 'test-secret',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const results = await sendAlertNotification(mockAlert, config);

      expect(results.length).toBe(1);
      expect(results[0].channel).toBe('webhook');
      expect(results[0].success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://webhook.example.com/alerts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Signature': expect.any(String),
          }),
        })
      );
    });

    it('devrait gérer les erreurs gracieusement', async () => {
      const config: NotificationConfig = {
        channels: ['slack'],
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/xxx',
        },
      };

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const results = await sendAlertNotification(mockAlert, config);

      expect(results.length).toBe(1);
      expect(results[0].channel).toBe('slack');
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });
  });

  describe('notificationsService.sendAlert', () => {
    it('devrait envoyer via plusieurs canaux simultanément', async () => {
      const config: NotificationConfig = {
        channels: ['email', 'slack'],
        email: {
          to: 'admin@example.com',
        },
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/xxx',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const results = await notificationsService.sendAlert(mockAlert, config);

      expect(results.length).toBe(2);
      expect(results.map(r => r.channel)).toEqual(['email', 'slack']);
      expect(results.every(r => r.success)).toBe(true);
    });
  });
});

