'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker after first paint. Deliberately silent: a failed
 * registration (private mode, unsupported browser) must never surface to the user.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

    const timer = window.setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
