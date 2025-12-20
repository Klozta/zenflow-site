/**
 * Service d'import en batch (plusieurs produits à la fois)
 * OPTIMISÉ avec retry et logging + ISR on-demand revalidation
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';
import { analyzeProductUrl, importAndCreateProduct } from './productImportService.js';

export interface BatchImportItem {
  url: string;
  options?: {
    useSuggestedPrice?: boolean;
    customPrice?: number;
    customCategory?: string;
    stock?: number;
    downloadImages?: boolean;
  };
}

export interface BatchImportResult {
  success: number;
  failed: number;
  total: number;
  results: Array<{
    url: string;
    success: boolean;
    product?: any;
    error?: string;
  }>;
}

/**
 * Importe plusieurs produits en batch avec retry automatique
 */
export async function batchImportProducts(
  items: BatchImportItem[],
  options?: {
    maxConcurrent?: number; // Nombre max de requêtes simultanées
    downloadImages?: boolean;
  }
): Promise<BatchImportResult> {
  const maxConcurrent = options?.maxConcurrent || 3; // Par défaut 3 à la fois
  const results: BatchImportResult['results'] = [];
  let success = 0;
  let failed = 0;

  logger.info('Début import batch', { total: items.length, maxConcurrent });

  const complianceMode = (process.env.COMPLIANCE_MODE || 'strict').toLowerCase().trim();
  const dataScope = (process.env.COMPLIANCE_DATA_SCOPE || 'minimal').toLowerCase().trim();
  const allowImages = complianceMode === 'off';

  // En mode conformité + dataScope=minimal, la création est interdite (analyse-only).
  if (complianceMode !== 'off' && dataScope === 'minimal') {
    const errMsg =
      "Mode conformité actif (dataScope=minimal) : batch import (création) désactivé. Utilise /api/products/import/batch/analyze.";
    logger.warn(errMsg, { total: items.length });
    return {
      success: 0,
      failed: items.length,
      total: items.length,
      results: items.map((i) => ({ url: i.url, success: false, error: errMsg })),
    };
  }

  // Traiter par batch pour éviter la surcharge
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);

    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        try {
          // Utiliser retry pour les imports
          const result = await retryNetwork(
            () => importAndCreateProduct(item.url, {
              ...item.options,
              // Conformité: ne jamais télécharger d'images par défaut.
              // Images uniquement si explicitement demandé ET COMPLIANCE_MODE=off.
              downloadImages: allowImages
                ? (item.options?.downloadImages ?? options?.downloadImages ?? false)
                : false,
            }),
            {
              maxRetries: 2, // 2 retries max pour batch
              initialDelay: 500,
            }
          );

          return {
            url: item.url,
            success: true,
            product: result.product,
          };
        } catch (error: any) {
          logger.warn('Échec import produit', { url: item.url, error: error.message });
          return {
            url: item.url,
            success: false,
            error: error.message || 'Erreur inconnue',
          };
        }
      })
    );

    // Traiter les résultats
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.success) {
          success++;
        } else {
          failed++;
        }
      } else {
        // Erreur lors de l'exécution de la promesse
        logger.error('Erreur traitement batch', result.reason, { batchIndex: i });
        results.push({
          url: 'unknown',
          success: false,
          error: result.reason?.message || 'Erreur lors du traitement',
        });
        failed++;
      }
    }

    // Petite pause entre les batches pour éviter la surcharge
    if (i + maxConcurrent < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  logger.info('Import batch terminé', { success, failed, total: items.length });

  // Trigger ISR on-demand revalidation si au moins un import a réussi
  if (success > 0) {
    await triggerRevalidation();
  }

  return {
    success,
    failed,
    total: items.length,
    results,
  };
}

/**
 * Déclenche la revalidation ISR on-demand de la page produits
 * Ne bloque pas l'import si la revalidation échoue
 */
async function triggerRevalidation() {
  try {
    const frontendUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await axios.post(
      `${frontendUrl}/api/revalidate`,
      {
        path: '/products',
        secret: process.env.REVALIDATE_SECRET,
      },
      {
        headers: {
          'Cookie': `admin-token=${process.env.ADMIN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // Timeout 5s pour ne pas bloquer
      }
    );

    if (response.data.revalidated) {
      logger.info('✅ Products page revalidated successfully');
    } else {
      logger.warn('⚠️ Revalidation response unexpected:', response.data);
    }
  } catch (error: any) {
    logger.error('❌ Revalidation failed:', error.response?.data || error.message);
    // Ne pas faire échouer l'import entier - continuer
  }
}

/**
 * Analyse plusieurs produits sans les créer (pour prévisualisation)
 */
export async function batchAnalyzeProducts(
  urls: string[],
  maxConcurrent: number = 3
): Promise<Array<{
  url: string;
  success: boolean;
  analysis?: any;
  error?: string;
}>> {
  const results: Array<{
    url: string;
    success: boolean;
    analysis?: any;
    error?: string;
  }> = [];

  logger.info('Début analyse batch', { total: urls.length, maxConcurrent });

  // Traiter par batch
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);

    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          // Utiliser retry pour les analyses
          const analysis = await retryNetwork(
            () => analyzeProductUrl(url),
            {
              maxRetries: 2,
              initialDelay: 500,
            }
          );

          return {
            url,
            success: true,
            analysis,
          };
        } catch (error: any) {
          logger.warn('Échec analyse produit', { url, error: error.message });
          return {
            url,
            success: false,
            error: error.message || 'Erreur inconnue',
          };
        }
      })
    );

    // Traiter les résultats
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        logger.error('Erreur analyse batch', result.reason, { batchIndex: i });
        results.push({
          url: 'unknown',
          success: false,
          error: result.reason?.message || 'Erreur lors de l\'analyse',
        });
      }
    }

    // Pause entre batches
    if (i + maxConcurrent < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  logger.info('Analyse batch terminée', {
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  });

  return results;
}
