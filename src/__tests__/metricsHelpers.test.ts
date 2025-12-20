/**
 * Tests unitaires pour metricsHelpers
 */
import { describe, expect, it } from '@jest/globals';
import {
    calculateDateRange,
    calculateMADScore,
    calculateTrend,
    calculateZScore,
    dateFilterSchema,
    escapeCsvValue,
} from '../utils/metricsHelpers.js';

describe('metricsHelpers', () => {
  describe('calculateDateRange', () => {
    it('devrait utiliser startDate et endDate si fournis', () => {
      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-01-31T23:59:59Z';
      const { start, end } = calculateDateRange(startDate, endDate);

      expect(start.toISOString()).toBe(new Date(startDate).toISOString());
      expect(end.toISOString()).toBe(new Date(endDate).toISOString());
    });

    it('devrait calculer la période 24h', () => {
      const { start, end } = calculateDateRange(undefined, undefined, '24h');

      const diff = end.getTime() - start.getTime();
      const expectedDiff = 24 * 60 * 60 * 1000;

      // Tolérance de 1 seconde pour les calculs
      expect(Math.abs(diff - expectedDiff)).toBeLessThan(1000);
    });

    it('devrait calculer la période 7d', () => {
      const { start, end } = calculateDateRange(undefined, undefined, '7d');

      const diff = end.getTime() - start.getTime();
      const expectedDiff = 7 * 24 * 60 * 60 * 1000;

      // Tolérance de 1 seconde pour les calculs
      expect(Math.abs(diff - expectedDiff)).toBeLessThan(1000);
    });

    it('devrait retourner une période par défaut si aucun paramètre', () => {
      const { start, end } = calculateDateRange();

      expect(start).toBeInstanceOf(Date);
      expect(end).toBeInstanceOf(Date);
      expect(end.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });
  });

  describe('calculateTrend', () => {
    it('devrait calculer une augmentation en pourcentage', () => {
      const trend = calculateTrend(100, 80);
      expect(trend.value).toBe(100);
      expect(trend.percentage).toBeGreaterThan(0);
      expect(trend.direction).toBe('up');
    });

    it('devrait calculer une diminution en pourcentage', () => {
      const trend = calculateTrend(60, 100);
      expect(trend.value).toBe(60);
      expect(trend.percentage).toBeLessThan(0);
      expect(trend.direction).toBe('down');
    });

    it('devrait gérer une valeur précédente de 0', () => {
      const trend = calculateTrend(100, 0);
      expect(trend.value).toBe(100);
      expect(trend.percentage).toBe(100);
      expect(trend.direction).toBe('up');
    });

    it('devrait retourner stable si les valeurs sont identiques', () => {
      const trend = calculateTrend(100, 100);
      expect(trend.value).toBe(100);
      expect(trend.percentage).toBe(0);
      expect(trend.direction).toBe('stable');
    });

    it('devrait être stable pour de petites variations (< 5%)', () => {
      const trend = calculateTrend(102, 100); // +2%
      expect(trend.direction).toBe('stable');
    });
  });

  describe('calculateZScore', () => {
    it('devrait calculer le Z-score correctement', () => {
      const values = [10, 20, 30, 40, 50];
      const currentValue = 60;
      const zScore = calculateZScore(currentValue, values);

      // Moyenne = 30, Écart-type ≈ 15.81
      // Z-score = (60 - 30) / 15.81 ≈ 1.897
      expect(zScore).toBeGreaterThan(1.5);
      expect(zScore).toBeLessThan(2.5);
    });

    it('devrait retourner 0 si pas assez de valeurs historiques', () => {
      const zScore = calculateZScore(50, []);
      expect(zScore).toBe(0);
    });

    it('devrait gérer un seul élément historique', () => {
      const zScore = calculateZScore(50, [40]);
      expect(zScore).toBe(0); // Pas assez de données pour calculer l'écart-type
    });
  });

  describe('calculateMADScore', () => {
    it('devrait calculer le score MAD correctement', () => {
      const values = [10, 20, 30, 40, 50];
      const currentValue = 60;
      const madScore = calculateMADScore(currentValue, values);

      expect(madScore).toBeGreaterThan(0);
    });

    it('devrait retourner 0 si pas assez de valeurs historiques', () => {
      const madScore = calculateMADScore(50, []);
      expect(madScore).toBe(0);
    });
  });

  describe('escapeCsvValue', () => {
    it('devrait échapper les virgules', () => {
      const result = escapeCsvValue('test,value');
      expect(result).toBe('"test,value"');
    });

    it('devrait échapper les guillemets', () => {
      const result = escapeCsvValue('test"value');
      expect(result).toBe('"test""value"');
    });

    it('devrait échapper les retours à la ligne', () => {
      const result = escapeCsvValue('test\nvalue');
      expect(result).toBe('"test\nvalue"');
    });

    it('ne devrait pas modifier les valeurs simples', () => {
      const result = escapeCsvValue('simple value');
      expect(result).toBe('simple value');
    });

    it('devrait convertir les nombres en string', () => {
      const result = escapeCsvValue(123);
      expect(result).toBe('123');
    });

    it('devrait gérer les valeurs null/undefined', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });
  });

  describe('dateFilterSchema', () => {
    it('devrait valider un schéma avec startDate et endDate', () => {
      const result = dateFilterSchema.safeParse({
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59Z',
      });

      expect(result.success).toBe(true);
    });

    it('devrait valider un schéma avec period', () => {
      const result = dateFilterSchema.safeParse({
        period: '7d',
      });

      expect(result.success).toBe(true);
    });

    it('devrait rejeter une période invalide', () => {
      const result = dateFilterSchema.safeParse({
        period: 'invalid',
      });

      expect(result.success).toBe(false);
    });
  });
});

