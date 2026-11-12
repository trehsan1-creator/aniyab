import 'server-only';

import { listLostReports, listMemories, latestConsultation } from '@/lib/db/store';
import type { Conversation, Customer, LostReport, Memory, TagConsultation } from '@/lib/db/types';
import { statusFa } from '@/lib/status';

export { statusFa };
import { toFaDigits } from '@/lib/validators';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/memory.ts — read path (customer brief) + write path helpers
 * ─────────────────────────────────────────────────────────────────────────────
 *  Read path:   buildCustomerBrief() → ≤ ~400 tokens injected into the system
 *               prompt as "what you already know", plus proactive chips.
 *  Write path:  the extraction itself happens after the response is flushed
 *               (see app/api/chat/route.ts → extractMemoriesAfterResponse).
 */

export interface CustomerBrief {
  /** Text block injected into the system prompt. */
  promptFa: string;
  /** Short Persian greeting line the UI can show (proactive continuity). */
  greetingFa: string | null;
  /** Status chips for the context panel. */
  chips: Array<{ id: string; labelFa: string; tone: 'info' | 'warn' | 'success' }>;
  name: string | null;
  memories: Memory[];
  openReports: LostReport[];
  consultation: TagConsultation | null;
  isReturning: boolean;
}

const KIND_LABEL_FA: Record<string, string> = {
  fact: 'واقعیت',
  preference: 'ترجیح',
  item: 'شیء',
  event: 'رویداد',
  concern: 'دغدغه',
};

function memoryLine(m: Memory): string {
  return `• [${KIND_LABEL_FA[m.kind] ?? m.kind}] ${m.key}: ${m.value}`;
}

/**
 * Builds the "customer brief". Deliberately compact: the prompt budget matters
 * more than completeness, so we cap memories and ticket lines.
 */
export async function buildCustomerBrief(params: {
  customer: Customer;
  conversation?: Conversation | null;
  memories?: Memory[];
}): Promise<CustomerBrief> {
  const { customer } = params;
  const memories = params.memories ?? (await listMemories(customer.id));
  const reports = await listLostReports(customer.id);
  const consultation = await latestConsultation(customer.id);
  const openReports = reports.filter((r) => r.status !== 'delivered').slice(0, 3);

  const isReturning = customer.visit_count > 1 || memories.length > 0;
  const name = customer.preferred_name ?? customer.full_name ?? null;

  const lines: string[] = [];
  if (name) lines.push(`نام ترجیحی مشتری: ${name}`);
  if (customer.city) lines.push(`شهر: ${customer.city}`);
  lines.push(`تعداد بازدید: ${toFaDigits(customer.visit_count)}`);

  if (memories.length) {
    lines.push('\nآنچه از قبل می‌دانی (به‌صورت طبیعی استفاده کن، فهرست‌وار تحویل نده):');
    for (const m of memories.slice(0, 12)) lines.push(memoryLine(m));
  }

  if (consultation) {
    const productFa = consultation.recommended_product === 'ani-pro' ? 'آنی پرو' : 'آنی پارک';
    lines.push(
      `\nآخرین مشاوره: شیء «${consultation.object_type ?? 'نامشخص'}» · پیشنهاد ${productFa} · مرحله ${consultation.stage}` +
        (consultation.objections.length ? ` · تردیدها: ${consultation.objections.join('، ')}` : ''),
    );
  }

  if (openReports.length) {
    lines.push('\nپرونده‌های باز:');
    for (const r of openReports) {
      lines.push(`• ${r.tracking_code} — ${r.item_type} — وضعیت ${r.status}`);
    }
  }

  if (params.conversation?.summary) {
    lines.push(`\nخلاصه گفتگوی قبلی: ${params.conversation.summary}`);
  }

  const promptFa = lines.join('\n');

  /* ── proactive continuity ─────────────────────────────────────────────── */
  const chips: CustomerBrief['chips'] = [];
  for (const r of openReports) {
    chips.push({
      id: `report-${r.tracking_code}`,
      labelFa: `پیگیری ${toFaDigits(r.tracking_code)}: ${statusFa(r.status)}`,
      tone: r.status === 'matched' ? 'success' : 'info',
    });
  }
  if (consultation?.recommended_product) {
    chips.push({
      id: `consult-${consultation.id}`,
      labelFa: `مشاوره ${consultation.recommended_product === 'ani-pro' ? 'آنی پرو' : 'آنی پارک'} در جریان`,
      tone: 'warn',
    });
  }

  let greetingFa: string | null = null;
  if (isReturning && (name || chips.length > 0)) {
    // No name yet? Still greet — an anonymous returning device must feel remembered.
    const parts = [name ? `سلام ${name} جان! خوش برگشتی 👋` : 'سلام! خوش برگشتی 👋'];
    const firstOpen = openReports[0];
    if (firstOpen) parts.push(`تیکت ${toFaDigits(firstOpen.tracking_code)} ${statusFa(firstOpen.status)} است.`);
    if (consultation?.recommended_product && consultation.stage !== 'clicked') {
      const productFa = consultation.recommended_product === 'ani-pro' ? 'آنی پرو' : 'آنی پارک';
      const objectFa = consultation.object_type ? `برای ${consultation.object_type}` : '';
      parts.push(`هنوز به ${productFa} ${objectFa} فکر می‌کنید؟`);
    }
    greetingFa = parts.join(' ');
  }

  return { promptFa, greetingFa, chips, name, memories, openReports, consultation, isReturning };
}
