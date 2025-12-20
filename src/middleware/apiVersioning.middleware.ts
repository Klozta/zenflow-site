/**
 * Middleware de versioning API
 * Supporte les versions d'API (v1, v2, etc.) pour compatibilité future
 */

import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export type ApiVersion = 'v1' | 'v2';

/**
 * Configuration du versioning
 */
export interface ApiVersioningConfig {
  defaultVersion?: ApiVersion; // Version par défaut (défaut: 'v1')
  supportedVersions?: ApiVersion[]; // Versions supportées (défaut: ['v1'])
  versionSource?: 'header' | 'query' | 'path' | 'all'; // Source de la version (défaut: 'all')
}

const DEFAULT_CONFIG: Required<ApiVersioningConfig> = {
  defaultVersion: 'v1',
  supportedVersions: ['v1'],
  versionSource: 'all',
};

/**
 * Extrait la version de l'API depuis différentes sources
 */
function extractApiVersion(req: Request, config: ApiVersioningConfig): ApiVersion | null {
  const { versionSource = 'all', defaultVersion = 'v1' } = config;

  // 1. Depuis le header Accept: application/vnd.api.v1+json
  if (versionSource === 'header' || versionSource === 'all') {
    const acceptHeader = req.headers.accept || '';
    const versionMatch = acceptHeader.match(/application\/vnd\.api\.(v\d+)/i);
    if (versionMatch && (versionMatch[1] === 'v1' || versionMatch[1] === 'v2')) {
      return versionMatch[1] as ApiVersion;
    }

    // Format alternatif: X-API-Version
    const apiVersionHeader = req.headers['x-api-version'] as string;
    if (apiVersionHeader && (apiVersionHeader === 'v1' || apiVersionHeader === 'v2')) {
      return apiVersionHeader as ApiVersion;
    }
  }

  // 2. Depuis query param: ?version=v1
  if (versionSource === 'query' || versionSource === 'all') {
    const versionParam = req.query.version as string;
    if (versionParam && (versionParam === 'v1' || versionParam === 'v2')) {
      return versionParam as ApiVersion;
    }
  }

  // 3. Depuis le path: /api/v1/products
  if (versionSource === 'path' || versionSource === 'all') {
    const pathMatch = req.path.match(/\/api\/(v\d+)\//);
    if (pathMatch && (pathMatch[1] === 'v1' || pathMatch[1] === 'v2')) {
      return pathMatch[1] as ApiVersion;
    }
  }

  // Retourner la version par défaut si aucune trouvée
  return defaultVersion;
}

/**
 * Middleware pour gérer le versioning API
 */
export function apiVersioning(config: ApiVersioningConfig = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const version = extractApiVersion(req, finalConfig);

      if (!version) {
        res.status(400).json({
          error: 'Invalid API version',
          message: 'Unable to determine API version',
          supportedVersions: finalConfig.supportedVersions,
        });
        return;
      }

      // Vérifier si la version est supportée
      if (!finalConfig.supportedVersions.includes(version)) {
        res.status(400).json({
          error: 'Unsupported API version',
          message: `API version ${version} is not supported`,
          supportedVersions: finalConfig.supportedVersions,
          defaultVersion: finalConfig.defaultVersion,
        });
        return;
      }

      // Injecter la version dans la requête
      (req as any).apiVersion = version;

      // Ajouter header de réponse avec la version utilisée
      res.setHeader('X-API-Version', version);

      next();
    } catch (error) {
      logger.error('API versioning middleware error', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred during API version detection',
      });
    }
  };
}

/**
 * Helper pour créer des routes versionnées
 */
export function createVersionedRouter(versions: {
  [K in ApiVersion]?: (req: Request, res: Response, next: NextFunction) => void;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const version = (req as any).apiVersion as ApiVersion | undefined;

    if (!version) {
      res.status(400).json({
        error: 'API version required',
        message: 'Unable to determine API version',
      });
      return;
    }

    const handler = versions[version];

    if (!handler) {
      res.status(400).json({
        error: 'Version not implemented',
        message: `API version ${version} is not yet implemented`,
        availableVersions: Object.keys(versions),
      });
      return;
    }

    handler(req, res, next);
  };
}

/**
 * Décorateur pour marquer les routes comme versionnées
 */
export function versioned(version: ApiVersion) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // Marquer la méthode avec sa version
    if (!target._versionedMethods) {
      target._versionedMethods = new Map();
    }
    target._versionedMethods.set(propertyKey, version);
    return descriptor;
  };
}

