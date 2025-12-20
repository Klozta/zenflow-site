export type PaymentsCounters = {
  checkoutSessionCreated: number;
  webhookReceived: number;
  orderConfirmed: number;
  orderCancelled: number;
  duplicateWebhookIgnored: number;
};

const paymentsCounters: PaymentsCounters = {
  checkoutSessionCreated: 0,
  webhookReceived: 0,
  orderConfirmed: 0,
  orderCancelled: 0,
  duplicateWebhookIgnored: 0,
};

export function incPaymentsCounter<K extends keyof PaymentsCounters>(key: K, delta = 1): void {
  paymentsCounters[key] += delta;
}

export function getPaymentsCounters(): PaymentsCounters {
  return { ...paymentsCounters };
}
