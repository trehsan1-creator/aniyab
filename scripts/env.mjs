/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  scripts/env.mjs — the one place that loads environment variables for scripts
 * ─────────────────────────────────────────────────────────────────────────────
 *  Why: `tsx scripts/seed.ts` does NOT read `.env.local` on its own. So
 *  `npm run seed` printed "Supabase is not configured — nothing to seed." even
 *  when `.env.local` was correct, and looked like a Supabase problem when it was
 *  a loading problem. Anything run outside `next` must import this first.
 */

import { loadEnvConfig } from '@next/env';

/** Same precedence Next.js itself uses: .env.local wins over .env. */
export function loadEnv(dir = process.cwd()) {
  loadEnvConfig(dir, process.env.NODE_ENV === 'development', { info: () => {}, error: () => {} });
}

/** Reads an env var, treating empty/whitespace as missing. */
export function required(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}
