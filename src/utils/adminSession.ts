import crypto from 'crypto';

type AdminSessionPayload = {
  exp: number; // unix seconds
};

function getSigningSecret(): string | undefined {
  return process.env.CRON_API_KEY || process.env.ADMIN_TOKEN;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createAdminSessionToken(ttlSeconds: number = 7 * 24 * 60 * 60): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const payload: AdminSessionPayload = { exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadStr);
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined | null): boolean {
  const secret = getSigningSecret();
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64, secret);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return false;
  } catch {
    return false;
  }
  try {
    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr) as AdminSessionPayload;
    if (!payload?.exp) return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}


