/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/status.ts — shared, isomorphic status vocabulary
 * ─────────────────────────────────────────────────────────────────────────────
 *  Used by BOTH the server agent and the client cards, so it must stay
 *  dependency-free (no 'server-only', no DB imports).
 */

import type { LostReportStatus } from '@/lib/db/types';

export const REPORT_STEPS: Array<{ key: LostReportStatus; labelFa: string; afterMinutes: number }> = [
  { key: 'submitted', labelFa: 'ثبت شد', afterMinutes: 0 },
  { key: 'referred', labelFa: 'ارجاع به مرجع مجاز', afterMinutes: 1 },
  { key: 'reviewing', labelFa: 'در حال بررسی', afterMinutes: 3 },
  { key: 'matched', labelFa: 'تطبیق با مورد یافته‌شده', afterMinutes: 8 },
  { key: 'delivered', labelFa: 'آماده تحویل', afterMinutes: 20 },
];

export const STEP_ORDER: LostReportStatus[] = REPORT_STEPS.map((s) => s.key);

const STATUS_LABELS: Record<LostReportStatus, string> = {
  submitted: 'ثبت شد',
  referred: 'ارجاع به مرجع مجاز',
  reviewing: 'در حال بررسی',
  matched: 'تطبیق با مورد یافته‌شده',
  delivered: 'تحویل شد',
};

export function statusFa(status: LostReportStatus | string): string {
  return STATUS_LABELS[status as LostReportStatus] ?? String(status);
}

/**
 * A ticket looks alive without a cron: its stage is derived from `created_at`.
 * The stored status acts as a floor, so a human-updated status never regresses.
 */
export function deriveStatusIndex(
  createdAt: string,
  storedStatus: string,
  now: number = Date.now(),
): number {
  const storedIndex = STEP_ORDER.indexOf(storedStatus as LostReportStatus);
  const ageMinutes = (now - new Date(createdAt).getTime()) / 60_000;
  let derived = 0;
  REPORT_STEPS.forEach((step, i) => {
    if (ageMinutes >= step.afterMinutes) derived = i;
  });
  return Math.min(Math.max(storedIndex < 0 ? 0 : storedIndex, derived), STEP_ORDER.length - 1);
}

export function deriveStatus(createdAt: string, storedStatus: string, now?: number): LostReportStatus {
  return STEP_ORDER[deriveStatusIndex(createdAt, storedStatus, now)] ?? 'submitted';
}

/** Demo aid: advance one step. */
export function nextStatus(current: string): LostReportStatus {
  const index = STEP_ORDER.indexOf(current as LostReportStatus);
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] ?? 'submitted';
}
