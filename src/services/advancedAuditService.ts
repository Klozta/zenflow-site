/**
 * Service d'audit logging avancé
 * Log toutes les actions critiques avec contexte complet
 */

import { supabase } from '../config/supabase.js';
import { structuredLogger } from '../utils/structuredLogger.js';

export type AuditAction =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.login'
  | 'user.logout'
  | 'order.created'
  | 'order.updated'
  | 'order.status_changed'
  | 'order.deleted'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'product.stock_updated'
  | 'payment.processed'
  | 'payment.refunded'
  | 'admin.action'
  | 'config.changed'
  | 'data.exported'
  | 'feature_flag.changed';

export type AuditActor = 'admin' | 'user' | 'system' | 'stripe' | 'webhook';

export interface AuditLog {
  action: AuditAction;
  actor: AuditActor;
  actorId?: string; // userId, adminId, etc.
  resourceType?: string; // 'order', 'product', 'user', etc.
  resourceId?: string; // ID de la ressource affectée
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Log une action d'audit
 */
export async function logAudit(log: AuditLog): Promise<void> {
  // Logger dans structuredLogger avec contexte
  structuredLogger.info('Audit log', {
    action: log.action,
    actor: log.actor,
    actorId: log.actorId,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    ...log.metadata,
  });

  // Stocker dans la base de données si table existe (non-bloquant)
  try {
    if (supabase && typeof (supabase as any).from === 'function') {
      const { error } = await supabase.from('audit_logs').insert({
        action: log.action,
        actor: log.actor,
        actor_id: log.actorId,
        resource_type: log.resourceType,
        resource_id: log.resourceId,
        changes: log.changes,
        metadata: log.metadata,
        ip: log.ip,
        user_agent: log.userAgent,
        request_id: log.requestId,
        created_at: log.timestamp,
      });

      if (error && !error.message.includes('relation') && !error.message.includes('does not exist')) {
        structuredLogger.warn('Audit log insert failed (non-blocking)', {
          action: log.action,
          error: error.message,
        });
      }
    }
  } catch (error) {
    // Table n'existe pas ou erreur DB - non-bloquant
    structuredLogger.warn('Audit log insert exception (non-blocking)', {
      action: log.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Helper pour créer un audit log depuis une requête Express
 */
export function createAuditLogFromRequest(
  action: AuditAction,
  actor: AuditActor,
  req: any,
  options?: {
    resourceType?: string;
    resourceId?: string;
    changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
    metadata?: Record<string, unknown>;
  }
): AuditLog {
  return {
    action,
    actor,
    actorId: (req as any).user?.id,
    resourceType: options?.resourceType,
    resourceId: options?.resourceId,
    changes: options?.changes,
    metadata: options?.metadata,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
    requestId: (req as any).requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Audit helpers pour actions communes
 */
export const audit = {
  /**
   * Log création d'utilisateur
   */
  userCreated: async (userId: string, req: any): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('user.created', 'system', req, {
        resourceType: 'user',
        resourceId: userId,
      })
    );
  },

  /**
   * Log connexion utilisateur
   */
  userLogin: async (userId: string, req: any, success: boolean): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('user.login', 'user', req, {
        resourceType: 'user',
        resourceId: userId,
        metadata: { success },
      })
    );
  },

  /**
   * Log création de commande
   */
  orderCreated: async (orderId: string, req: any, orderData: any): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('order.created', 'user', req, {
        resourceType: 'order',
        resourceId: orderId,
        changes: { after: { orderNumber: orderData.orderNumber, total: orderData.total } },
      })
    );
  },

  /**
   * Log changement de statut commande
   */
  orderStatusChanged: async (
    orderId: string,
    from: string,
    to: string,
    actor: AuditActor,
    req?: any,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    const log = {
      action: 'order.status_changed' as AuditAction,
      actor,
      actorId: req ? (req as any).user?.id : undefined,
      resourceType: 'order',
      resourceId: orderId,
      changes: { before: { status: from }, after: { status: to } },
      metadata,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      requestId: req ? (req as any).requestId : undefined,
      timestamp: new Date().toISOString(),
    };
    await logAudit(log);
  },

  /**
   * Log modification produit
   */
  productUpdated: async (
    productId: string,
    changes: { before: Record<string, unknown>; after: Record<string, unknown> },
    req: any
  ): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('product.updated', 'admin', req, {
        resourceType: 'product',
        resourceId: productId,
        changes,
      })
    );
  },

  /**
   * Log action admin
   */
  adminAction: async (
    action: string,
    req: any,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('admin.action', 'admin', req, {
        metadata: { adminAction: action, ...metadata },
      })
    );
  },

  /**
   * Log export de données
   */
  dataExported: async (
    exportType: string,
    req: any,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    await logAudit(
      createAuditLogFromRequest('data.exported', 'admin', req, {
        metadata: { exportType, ...metadata },
      })
    );
  },
};

