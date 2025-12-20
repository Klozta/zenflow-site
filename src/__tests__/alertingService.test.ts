/**
 * Tests unitaires pour alertingService
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { AlertingService, type AlertRule } from '../services/alertingService.js';

describe('AlertingService', () => {
  let alertingService: AlertingService;

  beforeEach(() => {
    alertingService = new AlertingService();
  });

  describe('evaluateAlert - Seuils statiques', () => {
    it('devrait déclencher une alerte si valeur dépasse le seuil (>)', async () => {
      const rule: AlertRule = {
        name: 'High Value',
        metric: 'test_metric',
        threshold: 50,
        operator: '>',
        severity: 'warning',
      };

      const alert = await alertingService.evaluateAlert(rule, 60);

      expect(alert).not.toBeNull();
      expect(alert?.rule).toBe('High Value');
      expect(alert?.value).toBe(60);
      expect(alert?.threshold).toBe(50);
      expect(alert?.severity).toBe('warning');
    });

    it('ne devrait pas déclencher si valeur inférieure au seuil (>)', async () => {
      const rule: AlertRule = {
        name: 'High Value',
        metric: 'test_metric',
        threshold: 50,
        operator: '>',
        severity: 'warning',
      };

      const alert = await alertingService.evaluateAlert(rule, 40);

      expect(alert).toBeNull();
    });

    it('devrait déclencher une alerte si valeur inférieure au seuil (<)', async () => {
      const rule: AlertRule = {
        name: 'Low Stock',
        metric: 'stock_count',
        threshold: 10,
        operator: '<',
        severity: 'critical',
      };

      const alert = await alertingService.evaluateAlert(rule, 5);

      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe('critical');
    });

    it('devrait respecter l\'opérateur >=', async () => {
      const rule: AlertRule = {
        name: 'Threshold Test',
        metric: 'test',
        threshold: 50,
        operator: '>=',
        severity: 'info',
      };

      const alert1 = await alertingService.evaluateAlert(rule, 50);
      const alert2 = await alertingService.evaluateAlert(rule, 51);
      const alert3 = await alertingService.evaluateAlert(rule, 49);

      expect(alert1).not.toBeNull();
      expect(alert2).not.toBeNull();
      expect(alert3).toBeNull();
    });

    it('devrait respecter l\'opérateur <=', async () => {
      const rule: AlertRule = {
        name: 'Threshold Test',
        metric: 'test',
        threshold: 10,
        operator: '<=',
        severity: 'warning',
      };

      const alert1 = await alertingService.evaluateAlert(rule, 10);
      const alert2 = await alertingService.evaluateAlert(rule, 9);
      const alert3 = await alertingService.evaluateAlert(rule, 11);

      expect(alert1).not.toBeNull();
      expect(alert2).not.toBeNull();
      expect(alert3).toBeNull();
    });
  });

  describe('evaluateAlert - Cooldown', () => {
    it('ne devrait pas déclencher deux alertes identiques dans le cooldown', async () => {
      const rule: AlertRule = {
        name: 'Test Rule',
        metric: 'test_metric',
        threshold: 50,
        severity: 'critical',
      };

      const alert1 = await alertingService.evaluateAlert(rule, 60);
      const alert2 = await alertingService.evaluateAlert(rule, 60);

      expect(alert1).not.toBeNull();
      expect(alert2).toBeNull(); // En cooldown
    });

    it('devrait permettre une nouvelle alerte après le cooldown (simulation)', async () => {
      const rule: AlertRule = {
        name: 'Test Rule',
        metric: 'test_metric',
        threshold: 50,
        severity: 'info', // Cooldown plus long (1h)
      };

      const alert1 = await alertingService.evaluateAlert(rule, 60);
      expect(alert1).not.toBeNull();

      // Réinitialiser l'historique manuellement pour simuler la fin du cooldown
      (alertingService as any).alertHistory.clear();

      const alert2 = await alertingService.evaluateAlert(rule, 60);
      expect(alert2).not.toBeNull();
    });
  });

  describe('evaluateAlert - Messages', () => {
    it('devrait générer un message d\'alerte approprié', async () => {
      const rule: AlertRule = {
        name: 'Low Stock',
        metric: 'stock_count',
        threshold: 10,
        operator: '<',
        severity: 'critical',
      };

      const alert = await alertingService.evaluateAlert(rule, 5);

      expect(alert?.message).toBeDefined();
      expect(alert?.message).toContain('Low Stock');
      expect(alert?.message).toContain('5');
      expect(alert?.message).toContain('10');
    });
  });

  describe('evaluateAlert - Déduplication', () => {
    it('devrait utiliser une clé de déduplication basée sur name:metric', async () => {
      const rule: AlertRule = {
        name: 'Test Rule',
        metric: 'test_metric',
        threshold: 50,
        severity: 'warning',
      };

      const alert1 = await alertingService.evaluateAlert(rule, 60);
      const alert2 = await alertingService.evaluateAlert(rule, 70); // Même règle, valeur différente

      expect(alert1).not.toBeNull();
      expect(alert2).toBeNull(); // Même clé de déduplication
    });

    it('devrait permettre des alertes différentes pour des règles différentes', async () => {
      const rule1: AlertRule = {
        name: 'Rule 1',
        metric: 'metric_1',
        threshold: 50,
        severity: 'warning',
      };

      const rule2: AlertRule = {
        name: 'Rule 2',
        metric: 'metric_2',
        threshold: 50,
        severity: 'warning',
      };

      const alert1 = await alertingService.evaluateAlert(rule1, 60);
      const alert2 = await alertingService.evaluateAlert(rule2, 60);

      expect(alert1).not.toBeNull();
      expect(alert2).not.toBeNull(); // Clés de déduplication différentes
    });
  });

  describe('evaluateAlert - Réinitialisation', () => {
    it('devrait réinitialiser l\'historique si la règle n\'est plus déclenchée', async () => {
      const rule: AlertRule = {
        name: 'Test Rule',
        metric: 'test_metric',
        threshold: 50,
        operator: '>',
        severity: 'warning',
      };

      const alert1 = await alertingService.evaluateAlert(rule, 60);
      expect(alert1).not.toBeNull();

      // Valeur retombe sous le seuil
      const alert2 = await alertingService.evaluateAlert(rule, 40);
      expect(alert2).toBeNull();

      // L'historique devrait être réinitialisé, donc nouvelle alerte possible
      const alert3 = await alertingService.evaluateAlert(rule, 60);
      expect(alert3).not.toBeNull();
    });
  });
});

