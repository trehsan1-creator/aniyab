'use client';

/**
 * Funnel/analytics events. Fire-and-forget so a failed beacon never blocks the
 * UI. Server writes them to `events` (or the in-memory store).
 */

export function trackFunnel(type: string, payload: Record<string, unknown> = {}): void {
  try {
    const deviceId =
      typeof window !== 'undefined' ? window.localStorage.getItem('aniyab:device') ?? undefined : undefined;

    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload, deviceId }),
      keepalive: true,
    }).catch(() => {
      /* offline is fine */
    });
  } catch {
    /* never throw from analytics */
  }
}

/** Device identity used for the anonymous Supabase session (localStorage: UI pref only). */
export function getDeviceId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    let id = window.localStorage.getItem('aniyab:device');
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem('aniyab:device', id);
    }
    return id;
  } catch {
    return undefined;
  }
}
