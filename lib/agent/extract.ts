import 'server-only';

import { slimPayload, resolveProvider } from '@/lib/llm';
import { upsertMemory, setConversationSummary } from '@/lib/db/store';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/extract.ts — memory write path (runs AFTER the response is sent)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A tiny, cheap model call turns the last exchange into structured facts.
 *  Everything is best-effort: a failure here must never affect the user's turn.
 */

export interface ExtractedMemory {
  kind: 'fact' | 'preference' | 'item' | 'event' | 'concern';
  key: string;
  value: string;
  confidence: number;
}

const EXTRACTION_PROMPT = `
تو یک استخراج‌کننده حافظه هستی. از گفتگوی زیر فقط نکات پایدار و قابل استناد دربارهٔ کاربر را بیرون بکش.
قواعد:
- حداکثر ۴ مورد.
- فقط چیزهایی که کاربر درباره خودش گفته: نام، شهر، شیء مهم، ترجیح، دغدغه، رویداد.
- هیچ داده حساس (کد ملی، IMEI کامل، شماره کارت، رمز) را ذخیره نکن.
- کلیدها کوتاه و انگلیسی، مقدارها فارسی و کوتاه.
- اگر چیز پایداری نیست، آرایه خالی برگردان.

خروجی فقط JSON: {"memories":[{"kind":"fact|preference|item|event|concern","key":"...","value":"...","confidence":0.0-1.0}],"summary":"یک جمله خلاصهٔ فارسی"}
`.trim();

function safeJson<T>(text: string): T | null {
  const candidate = text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

/**
 * Extracts and upserts memories + refreshes the conversation summary.
 * Never throws.
 */
export async function extractMemories(params: {
  customerId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  sessionId: string;
}): Promise<{ saved: number; summary: string | null }> {
  try {
    const resolved = resolveProvider({ requested: null, sessionId: params.sessionId, flow: 'general' });
    if (!resolved.ok) return { saved: 0, summary: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    const response = await fetch(resolved.plan.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...resolved.plan.headers,
      },
      body: JSON.stringify(
        slimPayload({
          ...resolved.plan.bodyExtras,
          stream: false,
          temperature: 0,
          max_tokens: 400,
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            {
              role: 'user',
              content: `کاربر: ${params.userText.slice(0, 800)}\nدستیار: ${params.assistantText.slice(0, 800)}`,
            },
          ],
        }),
      ),
      signal: controller.signal,
      cache: 'no-store' as RequestCache,
    });

    clearTimeout(timer);
    if (!response.ok) return { saved: 0, summary: null };

    const json = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    } | null;

    const content = json?.choices?.[0]?.message?.content ?? '';
    const parsed = safeJson<{ memories?: ExtractedMemory[]; summary?: string }>(content);
    if (!parsed) return { saved: 0, summary: null };

    let saved = 0;
    for (const m of (parsed.memories ?? []).slice(0, 4)) {
      if (!m?.key || !m?.value) continue;
      // Hard block on anything that looks like a secret.
      if (/\d{10,}/.test(m.value)) continue;
      const record = await upsertMemory({
        customerId: params.customerId,
        kind: m.kind ?? 'fact',
        key: m.key,
        value: m.value,
        confidence: Math.min(1, Math.max(0, m.confidence ?? 0.6)),
      });
      if (record) saved += 1;
    }

    const summary = parsed.summary?.slice(0, 400) ?? null;
    if (summary) await setConversationSummary(params.conversationId, summary);

    return { saved, summary };
  } catch {
    return { saved: 0, summary: null };
  }
}
