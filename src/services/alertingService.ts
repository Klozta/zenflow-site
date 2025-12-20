/**
 * Service d'alerting intelligent pour les métriques
 * Implémente des seuils dynamiques, déduplication, et cooldown pour éviter l'alert fatigue
 *
 * @module services/alertingService
 * @description
 * Service permettant de définir et évaluer des règles d'alerte avec:
 * - Seuils statiques (ex: stock < 10)
 * - Seuils dynamiques basés sur l'historique (z-score, MAD)
 * - Déduplication pour éviter les alertes dupliquées
 * - Cooldown par sévérité (critical: 10min, warning: 30min, info: 1h)
 * - Groupement d'alertes liées
 *
 * @example
 * ```typescript
 * const rule: AlertRule = {
 *   name: 'Low Stock',
 *   metric: 'stock_count',
 *   threshold: 10,
 *   operator: '<',
 *   severity: 'critical'
 * };
 *
 * const alert = await alertingService.evaluateAlert(rule, 5);
 * if (alert) {
 *   console.log('Alerte déclenchée:', alert.message);
 * }
 * ```
 */

import { logger } from '../utils/logger.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type ComparisonOperator = '>' | '<' | '>=' | '<=';

export interface AlertRule {
  name: string;
  metric: string;
  threshold?: number; // Seuil statique
  operator?: ComparisonOperator; // Opérateur de comparaison (défaut: '>')
  dynamicThreshold?: {
    algorithm: 'zscore' | 'mad'; // Z-score ou Median Absolute Deviation
    sensitivity: number; // 2 = 2σ, 3 = 3σ, etc.
    baselinePeriod?: string; // '7d', '30d', etc.
  };
  for?: string; // Durée avant déclenchement: '5m', '15m', '1h'
  severity: AlertSeverity;
  channels?: string[];
}

export interface Alert {
  id: string;
  rule: string;
  metric: string;
  value: number;
  threshold?: number;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  dedupKey: string;
}

interface AlertHistory {
  lastTriggered: number;
  count: number;
  firstTriggered: number;
}

/**
 * Service d'alerting avec déduplication et cooldown
 */
export class AlertingService {
  private alertHistory: Map<string, AlertHistory> = new Map();
  private readonly cooldownDurations: Record<AlertSeverity, number> = {
    critical: 10 * 60 * 1000, // 10 minutes
    warning: 30 * 60 * 1000, // 30 minutes
    info: 60 * 60 * 1000, // 1 heure
  };

  /**
   * Évalue une métrique contre une règle d'alerte
   */
  async evaluateAlert(rule: AlertRule, currentValue: number, historicalValues?: number[]): Promise<Alert | null> {
    // Générer une clé de déduplication
    const dedupKey = `${rule.name}:${rule.metric}`;

    // Vérifier le cooldown
    if (this.isInCooldown(dedupKey, rule.severity)) {
      return null; // En cooldown, ne pas alerter
    }

    // Évaluer si la règle est déclenchée
    const triggered = await this.isRuleTriggered(rule, currentValue, historicalValues);

    if (!triggered) {
      // Réinitialiser le compteur si la règle n'est plus déclenchée
      this.alertHistory.delete(dedupKey);
      return null;
    }

    // Créer l'alerte
    const threshold = rule.threshold || this.calculateDynamicThreshold(rule, historicalValues || []);
    const alert: Alert = {
      id: `${dedupKey}:${Date.now()}`,
      rule: rule.name,
      metric: rule.metric,
      value: currentValue,
      threshold,
      severity: rule.severity,
      message: this.generateAlertMessage(rule, currentValue, threshold),
      timestamp: new Date().toISOString(),
      dedupKey,
    };

    // Enregistrer dans l'historique
    this.recordAlert(dedupKey, rule.severity);

    // Envoyer les notifications si configuré (non-bloquant)
    this.sendNotifications(alert, rule).catch((error) => {
      // Logger mais ne pas faire échouer l'évaluation de l'alerte
      logger.error('Erreur envoi notifications pour alerte', error, {
        alertId: alert.id,
        rule: rule.name,
      });
    });

    return alert;
  }

  /**
   * Vérifie si une règle est déclenchée
   */
  private async isRuleTriggered(rule: AlertRule, currentValue: number, historicalValues?: number[]): Promise<boolean> {
    const operator = rule.operator || '>'; // Par défaut: supérieur au seuil

    // Seuil statique
    if (rule.threshold !== undefined) {
      switch (operator) {
        case '>':
          return currentValue > rule.threshold;
        case '<':
          return currentValue < rule.threshold;
        case '>=':
          return currentValue >= rule.threshold;
        case '<=':
          return currentValue <= rule.threshold;
        default:
          return currentValue > rule.threshold;
      }
    }

    // Seuil dynamique
    if (rule.dynamicThreshold && historicalValues && historicalValues.length > 0) {
      return this.evaluateDynamicThreshold(rule.dynamicThreshold, currentValue, historicalValues);
    }

    return false;
  }

  /**
   * Évalue un seuil dynamique (z-score ou MAD)
   */
  private evaluateDynamicThreshold(
    config: NonNullable<AlertRule['dynamicThreshold']>,
    currentValue: number,
    historicalValues: number[]
  ): boolean {
    if (config.algorithm === 'zscore') {
      return this.evaluateZScore(currentValue, historicalValues, config.sensitivity);
    } else if (config.algorithm === 'mad') {
      return this.evaluateMAD(currentValue, historicalValues, config.sensitivity);
    }

    return false;
  }

  /**
   * Calcule et évalue un z-score
   */
  private evaluateZScore(currentValue: number, historicalValues: number[], sensitivity: number): boolean {
    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return false; // Pas de variation, impossible de détecter une anomalie

    const zScore = Math.abs((currentValue - mean) / stdDev);
    return zScore > sensitivity;
  }

  /**
   * Calcule et évalue avec Median Absolute Deviation (plus robuste aux outliers)
   */
  private evaluateMAD(currentValue: number, historicalValues: number[], sensitivity: number): boolean {
    const sorted = [...historicalValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const deviations = historicalValues.map(val => Math.abs(val - median));
    deviations.sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];

    if (mad === 0) return false;

    const madScore = Math.abs((currentValue - median) / mad);
    return madScore > sensitivity;
  }

  /**
   * Calcule le seuil dynamique pour affichage
   */
  private calculateDynamicThreshold(rule: AlertRule, historicalValues: number[]): number {
    if (!rule.dynamicThreshold || historicalValues.length === 0) {
      return 0;
    }

    if (rule.dynamicThreshold.algorithm === 'zscore') {
      const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
      const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
      const stdDev = Math.sqrt(variance);
      return mean + rule.dynamicThreshold.sensitivity * stdDev;
    }

    return 0;
  }

  /**
   * Génère un message d'alerte
   */
  private generateAlertMessage(rule: AlertRule, currentValue: number, threshold: number): string {
    const diff = rule.threshold !== undefined
      ? currentValue - threshold
      : currentValue - threshold;

    const diffPercent = threshold > 0 ? ((diff / threshold) * 100).toFixed(1) : '0';

    return `${rule.name}: ${currentValue} (seuil: ${threshold.toFixed(2)}, écart: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} / ${diffPercent}%)`;
  }

  /**
   * Vérifie si une alerte est en cooldown
   */
  private isInCooldown(dedupKey: string, severity: AlertSeverity): boolean {
    const history = this.alertHistory.get(dedupKey);
    if (!history) return false;

    const cooldown = this.cooldownDurations[severity];
    const timeSinceLastAlert = Date.now() - history.lastTriggered;

    return timeSinceLastAlert < cooldown;
  }

  /**
   * Enregistre une alerte dans l'historique
   */
  private recordAlert(dedupKey: string, _severity: AlertSeverity): void {
    const existing = this.alertHistory.get(dedupKey);
    const now = Date.now();

    if (existing) {
      existing.lastTriggered = now;
      existing.count += 1;
    } else {
      this.alertHistory.set(dedupKey, {
        lastTriggered: now,
        count: 1,
        firstTriggered: now,
      });
    }

    // Nettoyer l'historique périodiquement (garder seulement les dernières 24h)
    if (this.alertHistory.size > 1000) {
      this.cleanupHistory();
    }
  }

  /**
   * Nettoie l'historique des alertes anciennes
   */
  private cleanupHistory(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, history] of this.alertHistory.entries()) {
      if (history.firstTriggered < oneDayAgo && history.lastTriggered < oneDayAgo) {
        this.alertHistory.delete(key);
      }
    }
  }

  /**
   * Récupère l'historique d'une alerte
   */
  getAlertHistory(dedupKey: string): AlertHistory | undefined {
    return this.alertHistory.get(dedupKey);
  }

  /**
   * Réinitialise l'historique d'une alerte (pour tests ou réinitialisation manuelle)
   */
  resetAlertHistory(dedupKey?: string): void {
    if (dedupKey) {
      this.alertHistory.delete(dedupKey);
    } else {
      this.alertHistory.clear();
    }
  }

  /**
   * Groupe les alertes liées pour éviter le spam
   */
  groupRelatedAlerts(alerts: Alert[]): Map<string, Alert[]> {
    const grouped = new Map<string, Alert[]>();

    for (const alert of alerts) {
      // Grouper par type de métrique et sévérité
      const groupKey = `${alert.metric}:${alert.severity}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }

      grouped.get(groupKey)!.push(alert);
    }

    return grouped;
  }

  /**
   * Envoie les notifications pour une alerte déclenchée
   * Utilise les canaux spécifiés dans la règle ou la configuration par défaut
   */
  private async sendNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    try {
      // Importer dynamiquement pour éviter les dépendances circulaires
      const { sendAlertNotification, getDefaultNotificationConfig } = await import('./notificationsService.js');

      // Si la règle spécifie des canaux, construire une config personnalisée
      if (rule.channels && rule.channels.length > 0) {
        const defaultConfig = getDefaultNotificationConfig();
        if (!defaultConfig) {
          logger.warn('Aucune configuration de notification par défaut disponible');
          return;
        }

        // Filtrer les canaux selon ceux spécifiés dans la règle
        const customConfig: typeof defaultConfig = {
          ...defaultConfig,
          channels: rule.channels.filter((ch: string) => defaultConfig.channels.includes(ch as any)) as any[],
        };

        if (customConfig.channels.length > 0) {
          await sendAlertNotification(alert, customConfig);
        }
      } else {
        // Utiliser la configuration par défaut
        await sendAlertNotification(alert);
      }
    } catch (error) {
      // Erreur déjà loggée dans sendNotifications, juste propager silencieusement
      // pour ne pas bloquer l'évaluation de l'alerte
    }
  }
}

// Instance singleton
export const alertingService = new AlertingService();

