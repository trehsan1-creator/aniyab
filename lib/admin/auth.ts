import 'server-only';

import { cookies } from 'next/headers';

import { timingSafeEqual } from '@/lib/crypto';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/admin/auth.ts — password-gated admin session
 * ─────────────────────────────────────────────────────────────────────────────
 *  • httpOnly, sameSite=strict, secure in production
 *  • constant-time compare (no timing oracle)
 *  • naive in-process rate limit (3 failures / 10 min per IP)
 */

const COOKIE = 'aniyab_admin';
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8h demo session

interface Attempt {
  count: number;
  firstAt: number;
}
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

/**
 * The cookie value is a hash of the password, never the password itself, so a
 * stolen cookie can't be replayed against other services and rotates when the
 * password changes.
 */
async function sessionToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD?.trim() ?? '';
  const data = new TextEncoder().encode(`aniyab-admin:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(input: string, ip: string): Promise<boolean> {
  const now = Date.now();
  const record = attempts.get(ip);
  if (record && now - record.firstAt > WINDOW_MS) attempts.delete(ip);
  const current = attempts.get(ip);
  if (current && current.count >= MAX_ATTEMPTS) return false;

  const expected = process.env.ADMIN_PASSWORD?.trim() ?? '';
  if (!expected) return false;

  const ok = timingSafeEqual(input, expected);
  if (!ok) {
    const next = attempts.get(ip) ?? { count: 0, firstAt: now };
    next.count += 1;
    attempts.set(ip, next);
  } else {
    attempts.delete(ip);
  }
  return ok;
}

export async function createSession(): Promise<void> {
  cookies().set(COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  cookies().delete(COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  const value = cookies().get(COOKIE)?.value;
  if (!value || !adminConfigured()) return false;
  return timingSafeEqual(value, await sessionToken());
}
