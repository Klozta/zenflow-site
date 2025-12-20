/**
 * Service d'export de données optimisé
 * Supporte streaming, pagination, formats multiples
 */

import { Response } from 'express';
import { logger } from '../utils/logger.js';
import { structuredLogger } from '../utils/structuredLogger.js';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'jsonl';

export interface ExportOptions {
  format: ExportFormat;
  limit?: number; // Limite d'export (défaut: pas de limite)
  offset?: number; // Pagination offset
  fields?: string[]; // Champs à exporter (si vide, tous les champs)
  filters?: Record<string, unknown>; // Filtres à appliquer
  stream?: boolean; // Utiliser streaming (défaut: true si grande quantité)
}

/**
 * Convertit un objet en ligne CSV
 */
function objectToCsvRow(obj: Record<string, unknown>, headers: string[]): string {
  return headers
    .map((header) => {
      const value = obj[header];
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      // Échapper les guillemets et virgules
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    })
    .join(',');
}

/**
 * Export en CSV avec streaming
 */
export async function exportToCsv(
  data: Array<Record<string, unknown>>,
  res: Response,
  options: ExportOptions
): Promise<void> {
  if (data.length === 0) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    res.send('');
    return;
  }

  // Déterminer les headers
  const headers = options.fields || Object.keys(data[0]);
  const csvHeaders = headers.join(',');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.csv"`);

  // Streaming: envoyer les headers d'abord
  res.write('\ufeff'); // BOM UTF-8 pour Excel
  res.write(csvHeaders + '\n');

  // Streaming: envoyer les données par chunks
  const chunkSize = 100; // Envoyer 100 lignes à la fois
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const csvRows = chunk.map((row) => objectToCsvRow(row, headers)).join('\n');
    res.write(csvRows + '\n');
  }

  res.end();
}

/**
 * Export en JSON avec streaming pour grandes quantités
 */
export async function exportToJson(
  data: Array<Record<string, unknown>>,
  res: Response,
  options: ExportOptions
): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.json"`);

  // Si streaming activé et grande quantité, utiliser JSONL (JSON Lines)
  if (options.stream && data.length > 1000) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.jsonl"`);

    // JSONL: une ligne JSON par objet
    for (const item of data) {
      const filteredItem = options.fields
        ? Object.fromEntries(options.fields.map((field) => [field, item[field]]))
        : item;
      res.write(JSON.stringify(filteredItem) + '\n');
    }
    res.end();
    return;
  }

  // JSON standard pour petites quantités
  const filteredData = options.fields
    ? data.map((item) => Object.fromEntries(options.fields!.map((field) => [field, item[field]])))
    : data;

  res.json(filteredData);
}

/**
 * Export en JSONL (JSON Lines) - optimisé pour streaming
 */
export async function exportToJsonl(
  data: Array<Record<string, unknown>>,
  res: Response,
  options: ExportOptions
): Promise<void> {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.jsonl"`);

  const headers = options.fields || Object.keys(data[0] || {});

  // Streaming: une ligne par objet
  for (const item of data) {
    const filteredItem = Object.fromEntries(headers.map((field) => [field, item[field]]));
    res.write(JSON.stringify(filteredItem) + '\n');
  }

  res.end();
}

/**
 * Export principal - route les données vers le format approprié
 */
export async function exportData(
  data: Array<Record<string, unknown>>,
  res: Response,
  options: ExportOptions
): Promise<void> {
  try {
    structuredLogger.info('Data export started', {
      format: options.format,
      recordCount: data.length,
      stream: options.stream,
    });

    switch (options.format) {
      case 'csv':
        await exportToCsv(data, res, options);
        break;
      case 'json':
      case 'jsonl':
        await exportToJsonl(data, res, options);
        break;
      case 'xlsx':
        // XLSX nécessiterait une librairie comme 'xlsx' ou 'exceljs'
        // Pour l'instant, retourner JSON
        logger.warn('XLSX export not yet implemented, falling back to JSON');
        await exportToJson(data, res, options);
        break;
      default:
        res.status(400).json({
          error: 'Unsupported export format',
          message: `Format ${options.format} is not supported`,
          supportedFormats: ['csv', 'json', 'jsonl'],
        });
        return;
    }

    structuredLogger.info('Data export completed', {
      format: options.format,
      recordCount: data.length,
    });
  } catch (error) {
    logger.error('Data export error', error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Export failed',
        message: 'An error occurred during data export',
      });
    }
  }
}

/**
 * Helper pour exporter avec pagination automatique
 * Utile pour grandes quantités de données
 */
export async function exportWithPagination(
  fetchData: (offset: number, limit: number) => Promise<Array<Record<string, unknown>>>,
  res: Response,
  options: ExportOptions & { pageSize?: number }
): Promise<void> {
  const pageSize = options.pageSize || 1000;
  let offset = options.offset || 0;
  let hasMore = true;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.jsonl"`);

  try {
    while (hasMore) {
      const pageData = await fetchData(offset, pageSize);

      if (pageData.length === 0) {
        hasMore = false;
        break;
      }

      // Exporter la page
      if (options.format === 'csv' && offset === 0) {
        // Headers CSV uniquement pour la première page
        const headers = options.fields || Object.keys(pageData[0]);
        res.write(headers.join(',') + '\n');
      }

      for (const item of pageData) {
        if (options.format === 'csv') {
          const headers = options.fields || Object.keys(item);
          res.write(objectToCsvRow(item, headers) + '\n');
        } else {
          const filteredItem = options.fields
            ? Object.fromEntries(options.fields.map((field) => [field, item[field]]))
            : item;
          res.write(JSON.stringify(filteredItem) + '\n');
        }
      }

      offset += pageSize;
      hasMore = pageData.length === pageSize; // Continue si on a récupéré une page complète

      // Limite globale
      if (options.limit && offset >= options.limit) {
        hasMore = false;
      }
    }

    res.end();
  } catch (error) {
    logger.error('Pagination export error', error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Export failed',
        message: 'An error occurred during paginated export',
      });
    }
  }
}

