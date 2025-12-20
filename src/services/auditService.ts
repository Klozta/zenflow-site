import { supabase } from '../config/supabase.js';
import type { OrderStatus } from '../utils/orderStatus.js';
import { structuredLogger } from '../utils/structuredLogger.js';

type AuditActor = 'admin' | 'stripe' | 'system' | 'user';

function supabaseReady(): boolean {
  return !!supabase && typeof (supabase as any).from === 'function';
}

function isDuplicateOrUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code;
  const msg = String((err as any)?.message || '');
  return code === '23505' || /duplicate/i.test(msg) || /unique/i.test(msg);
}

/**
 * Réserve un envoi de notification (idempotence durable).
 * Retourne true si on peut envoyer, false si déjà envoyé.
 */
export async function reserveOrderNotification(params: {
  orderId: string;
  type: 'shipped' | 'delivered';
}): Promise<boolean> {
  if (!supabaseReady()) return true;
  try {
    const { error } = await supabase.from('order_notifications').insert({
      order_id: params.orderId,
      type: params.type,
    });
    if (!error) return true;
    if (isDuplicateOrUniqueViolation(error)) return false;
    // Table pas migrée / pas d'accès: non-bloquant, on envoie quand même
    structuredLogger.warn('order_notifications insert failed (non-blocking)', {
      orderId: params.orderId,
      type: params.type,
      code: (error as any)?.code,
      message: (error as any)?.message,
    });
    return true;
  } catch (e) {
    structuredLogger.warn('order_notifications insert exception (non-blocking)', {
      orderId: params.orderId,
      type: params.type,
      message: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

export async function auditOrderStatusTransition(params: {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: AuditActor;
  stripeEventId?: string;
  requestId?: string;
}): Promise<void> {
  if (!supabaseReady()) return;
  try {
    const { error } = await supabase.from('order_status_events').insert({
      order_id: params.orderId,
      from_status: params.from,
      to_status: params.to,
      actor: params.actor,
      stripe_event_id: params.stripeEventId || null,
      request_id: params.requestId || null,
    });
    if (error) {
      structuredLogger.warn('order_status_events insert failed (non-blocking)', {
        orderId: params.orderId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        stripeEventId: params.stripeEventId,
        requestId: params.requestId,
        code: (error as any)?.code,
        message: (error as any)?.message,
      });
    }
  } catch (e) {
    structuredLogger.warn('order_status_events insert exception (non-blocking)', {
      orderId: params.orderId,
      from: params.from,
      to: params.to,
      actor: params.actor,
      stripeEventId: params.stripeEventId,
      requestId: params.requestId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function upsertStripeOrderRef(params: {
  orderId: string;
  stripeEventId: string;
  stripeEventType: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
}): Promise<void> {
  if (!supabaseReady()) return;
  try {
    const { error } = await supabase.from('stripe_order_refs').upsert(
      {
        order_id: params.orderId,
        stripe_event_id: params.stripeEventId,
        stripe_event_type: params.stripeEventType,
        checkout_session_id: params.checkoutSessionId || null,
        payment_intent_id: params.paymentIntentId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'order_id' }
    );
    if (error) {
      structuredLogger.warn('stripe_order_refs upsert failed (non-blocking)', {
        orderId: params.orderId,
        stripeEventId: params.stripeEventId,
        stripeEventType: params.stripeEventType,
        code: (error as any)?.code,
        message: (error as any)?.message,
      });
    }
  } catch (e) {
    structuredLogger.warn('stripe_order_refs upsert exception (non-blocking)', {
      orderId: params.orderId,
      stripeEventId: params.stripeEventId,
      stripeEventType: params.stripeEventType,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


