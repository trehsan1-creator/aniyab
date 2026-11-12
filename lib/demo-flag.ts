/**
 * Single source of truth for "may the presenter-facing demo tools run?".
 *
 * Defaults:
 *   development / preview  → on
 *   production             → off, unless DEMO_TOOLS=1 is set explicitly
 */
export function demoAllowedOnServer(): boolean {
  const raw = process.env.DEMO_TOOLS?.trim().toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
