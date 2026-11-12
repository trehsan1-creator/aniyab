import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/db/client.ts — server-only Supabase admin client
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Uses the SERVICE ROLE key; never import this from a client component.
 *  • Returns null when Supabase is not configured, so the app degrades to the
 *    in-memory store instead of crashing (see lib/db/store.ts).
 */

let cached: SupabaseClient | null | undefined;

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/** Service-role client (server only). `null` when unconfigured. */
export function adminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  if (!supabaseConfigured()) {
    cached = null;
    return cached;
  }

  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-aniyab-app': 'smart-assistant' } },
    },
  );
  return cached;
}

/**
 * Logs once per process so an operator notices the degraded mode without
 * drowning the logs on every request.
 */
let warned = false;
export function warnEphemeral(reason: string): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[aniyab/db] Supabase is not configured (${reason}). ` +
      'Running with the in-memory store: data will be lost on restart. ' +
      'Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to persist.',
  );
}
