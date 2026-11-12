import 'server-only';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/crypto.ts — hashing & constant-time helpers (server only)
 * ─────────────────────────────────────────────────────────────────────────────
 *  National IDs are never stored or logged in plaintext — only this hash.
 */

const PEPPER = process.env.PII_HASH_PEPPER?.trim() || 'aniyab-demo-pepper-v1';

/** SHA-256 of `${pepper}:${value}` as hex. Deterministic for lookups. */
export async function hashNationalId(nationalId: string): Promise<string> {
  const data = new TextEncoder().encode(`${PEPPER}:${nationalId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (avoids leaking length/timing of secrets). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare digests so differing lengths don't short-circuit visibly.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** Redacts anything that looks like an IMEI / national ID / phone in logs. */
export function redactPii(text: string): string {
  return text
    .replace(/\b\d{15}\b/g, '[IMEI]')
    .replace(/\b\d{10}\b/g, '[NID]')
    .replace(/\b09\d{9}\b/g, '[PHONE]');
}
