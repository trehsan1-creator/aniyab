/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  app/api/chat/route.ts
 *  Aniyab Smart Assistant — orchestrator gateway (Edge Runtime)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  POST /api/chat
 *  body: { messages: ChatMessage[], sessionId: string, activeFlow: AniyabFlow }
 *
 *  Two upstreams, two jobs:
 *
 *   ┌─────────────────┬──────────────────────────────────┬──────────────────┐
 *   │ INFERENCE       │ NVIDIA NIM (integrate.api.nvidia)│ streamed tokens  │
 *   │ ORCHESTRATION   │ Laya SystemOne (/v1/systemone)   │ session/policy   │
 *   └─────────────────┴──────────────────────────────────┴──────────────────┘
 *
 *  SystemOne is optional and has three modes (`LAYA_SYSTEMONE_MODE`):
 *    · off         (default) — NVIDIA only.
 *    · preflight   — ask SystemOne for hints (prompt/model/temp), then call
 *                    NVIDIA ourselves. One extra JSON round-trip, lowest risk.
 *    · orchestrate — SystemOne owns the model call; NVIDIA becomes the
 *                    automatic fallback when SystemOne fails or is missing.
 *
 *  Responsibilities
 *  ────────────────
 *  1. Validate & normalise the inbound payload (never trust the browser).
 *  2. Inject the system prompt for the active Aniyab business flow.
 *  3. Call SystemOne (if configured) and merge its hints.
 *  4. Forward to the model provider with a hard timeout + abort propagation.
 *  5. Inspect the upstream `Content-Type`:
 *       • `text/event-stream`  → pipe the ReadableStream straight back to the
 *                                browser (zero buffering, zero re-encoding).
 *       • `application/json`   → parse, normalise to the OpenAI-compatible
 *                                envelope and return it.
 *  6. Map upstream failures to a stable, Persian-language JSON error contract
 *     (401 / 403 / 404 / 429 / 5xx / timeout / network).
 *
 *  Runtime: Node.js. The handler is runtime-agnostic (no `node:` imports), but
 *  Node + an explicit `maxDuration` gives the stream a much longer ceiling than
 *  Edge Functions do — important because `LAYA_TIMEOUT_MS` defaults to 45s.
 *  On Vercel, `maxDuration` must stay above `LAYA_TIMEOUT_MS`.
 */

import { NextResponse } from 'next/server';

import {
  MODEL_UNAVAILABLE_STATUSES,
  NVIDIA_DEFAULT_ENDPOINT,
  nvidiaModelChain,
  hasLayaInference,
  hasNvidiaKey,
  readSystemOneHints,
  resolveProvider,
  slimPayload,
  systemOneConfig,
  type ProviderId,
  type SystemOneHints,
  type SystemOnePreflightBody,
} from '@/lib/llm';

/* ════════════════════════════════════════════════════════════════════════════
   0. Runtime & contract types
   ════════════════════════════════════════════════════════════════════════════ */

export const runtime = 'nodejs';

/** Never let the CDN cache a conversation turn. */
export const dynamic = 'force-dynamic';

/**
 * Hard ceiling for the whole invocation (seconds). Must be greater than
 * `LAYA_TIMEOUT_MS`, otherwise the platform kills the stream before our own
 * timeout can return a clean Persian error. Vercel reads this export directly.
 */
export const maxDuration = 60;

/** The three commercial flows the assistant is allowed to reason about. */
export type AniyabFlow =
  | 'smart-tag' // 🏷️ خرید برچسب هوشمند (Lead Gen)
  | 'lost-report' // 🚨 اعلام مفقودی و ردیابی IMEI (Emergency)
  | 'found-report' // 🤝 ثبت اشیا و مدارک پیداشده (Found Reporting)
  | 'general'; // free-form / welcome state

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequestBody {
  messages?: unknown;
  sessionId?: unknown;
  activeFlow?: unknown;
  /** Optional per-request provider override: 'nvidia' | 'laya'. */
  provider?: unknown;
}

/* ── Public error contract returned to the client ─────────────────────────── */

type ErrorCode =
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'UPSTREAM_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'METHOD_NOT_ALLOWED';

interface ErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    /** Persian, user-presentable copy. */
    message: string;
    /** Machine hint for the UI (e.g. show the hotline CTA). */
    hint?: string;
    retryAfter?: number;
    upstreamStatus?: number;
  };
  /** Always populated so the chat can render a graceful bubble. */
  answer: string;
  sessionId: string | null;
}

/* ════════════════════════════════════════════════════════════════════════════
   1. Tunables
   ════════════════════════════════════════════════════════════════════════════ */

const UPSTREAM_TIMEOUT_MS = Number(
  process.env.LLM_TIMEOUT_MS ?? process.env.LAYA_TIMEOUT_MS ?? 45_000,
);
/** SystemOne preflight is a control-plane call: keep it on a short leash. */
const SYSTEMONE_TIMEOUT_MS = Number(process.env.LAYA_SYSTEMONE_TIMEOUT_MS ?? 6_000);

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8_000;
const MAX_BODY_BYTES = 256 * 1024; // 256 KiB is plenty for 40 turns of text.

const SUPPORT_HOTLINE = '۰۲۱-۶۲۸۰۱';

/** Fallback label used only when no provider resolves (see /api/chat health). */
const MODEL: string = nvidiaModelChain(process.env.NVIDIA_MODEL)[0] ?? 'nvidia/llama-3.1-nemotron-70b-instruct';

/* ════════════════════════════════════════════════════════════════════════════
   2. System prompts — one per business flow
   ════════════════════════════════════════════════════════════════════════════ */

const BASE_PROMPT = `تو «دستیار هوشمند آنی‌یاب» هستی؛ نماینده رسمی «مرکز ملی گمشده‌ها و پیداشده‌های آنی‌یاب».

قواعد قطعی پاسخ‌دهی:
- همیشه فارسی روان، محترمانه و انسانی بنویس. لحن: آرام، دقیق، اطمینان‌بخش.
- همه اعداد را با ارقام فارسی بنویس (۰۱۲۳۴۵۶۷۸۹). قیمت‌ها با «تومان».
- پاسخ‌ها کوتاه و ساختاریافته باشند: حداکثر ۵ گام. از فهرست شماره‌دار و **متن پررنگ** استفاده کن.
- هرگز شماره کارت، شماره شبا، رمز، یا کد یک‌بارمصرف نخواه. هرگز نگو «من هوش مصنوعی هستم».
- هیچ‌وقت اطلاعات مفقودی یا گزارش پیداشده را «قطعی» اعلام نکن؛ بگو «ثبت و ارجاع شد».
- اگر اطلاعات کافی نیست، فقط یک پرسش روشن‌کننده بپرس.
- در پایان پاسخ‌های عملیاتی، در صورت لزوم پشتیبانی انسانی را یادآوری کن: تماس ۲۴ ساعته ${SUPPORT_HOTLINE}.
- خارج از موضوع گمشده‌ها/پیداشده‌ها و خدمات آنی‌یاب پاسخ تفصیلی نده و کاربر را به مسیرهای رسمی هدایت کن.`;

const FLOW_PROMPTS: Record<AniyabFlow, string> = {
  'smart-tag': `${BASE_PROMPT}

جریان فعال تو: «خرید برچسب هوشمند» (Smart Tag).
محصولات رسمی:
- 🏷️ **آنی پارک** — برچسب هوشمند خودرو/پارکینگ، ۳۴۹٬۰۰۰ تومان. مناسب برای تماس امن در پارکینگ و اعلام مزاحمت پارک.
- 🛡️ **آنی پرو** — برچسب هوشمند همه‌کاره (کیف، لپ‌تاپ، ساک، حیوان خانگی)، ۶۹۴٬۰۰۰ تومان؛ دارای QR اختصاصی، تماس امن بی‌نام و اعلان اسکن.
در این جریان: محصول مناسب را بر اساس شیء کاربر پیشنهاد بده، تفاوت دو محصول را شفاف بگو، مزایا را در ۳ بولت خلاصه کن و کاربر را به تکمیل سفارش و ثبت آدرس هدایت کن. اگر تعداد یا ارسال به شهرستان پرسیده شد، شرایط ارسال را توضیح بده.`,

  'lost-report': `${BASE_PROMPT}

جریان فعال تو: «اعلام مفقودی و ردیابی» (Emergency).
مسیرهای رسمی:
1. **ردیابی موبایل با IMEI** — نیازمند کد ۱۵ رقمی IMEI (با شماره‌گیری *#۰۶# یا روی جعبه دستگاه). ردیابی فقط با ارائه مدارک مالکیت و از طریق پلیس/مراجع مجاز انجام می‌شود؛ آنی‌یاب هیچ‌گاه موقعیت لحظه‌ای گوشی را به کاربر لو نمی‌دهد.
2. **ردیابی بر اساس کد ملی** — استعلام ثبت‌های مرتبط با مالک (اشیای پیداشده تحویل‌شده به مرکز).
3. **پست یافته** — ارسال رایگان/تخفیفی شیء پیداشده به مالک احراز هویت‌شده از سوی یابنده.
4. **آگهی مفقودی در روزنامه** — سفارش آگهی رسمی برای مدارک هویتی و اسناد (کارت ملی، شناسنامه، گذرنامه، سند، دسته‌چک).
در این جریان: ابتدا نوع شیء و شماره تماس را بپرس، اگر موبایل است IMEI ۱۵ رقمی را بخواه، مراحل را شماره‌دار بچین و سطح فوریت را رعایت کن. اگر مورد شامل خشونت یا جرم است، تأکید کن که ابتدا با پلیس ۱۱۰ تماس گرفته شود.`,

  'found-report': `${BASE_PROMPT}

جریان فعال تو: «ثبت اشیا و مدارک پیدا‌شده» (Found Reporting).
مسیر ثبت:
1. **ثبت با کد QR** — اسکن برچسب آنی‌یاب روی شیء؛ در صورت نبود برچسب، ثبت شیء با کد سریال دستگاه.
2. **ثبت با کد سریال** — برای لپ‌تاپ، کنسول، دوچرخه، ساعت هوشمند و مدارک؛ شماره سریال/شماره سند را دریافت کن.
3. **تماس امن (Secure Anonymous Call)** — یابنده و مالک بدون افشای شماره واقعی، از طریق خط واسط آنی‌یاب با هم صحبت می‌کنند.
4. **تحویل امن** — پیشنهاد تحویل در دفاتر مرکز یا ارسال با «پست یافته».
در این جریان: هرگز شماره تماس واقعی طرفین را در چت چاپ نکن؛ توضیح بده که تماس امن چگونه کار می‌کند، شیء را توصیف کن (نشانه‌های شناسایی را ثبت کن اما در متن عمومی منتشر نکن) و رسید ثبت را خلاصه کن.`,

  general: `${BASE_PROMPT}

جریان فعال: راهنمای عمومی. کاربر را بین سه مسیر اصلی راهنمایی کن:
۱. 🏷️ خرید برچسب هوشمند (آنی پارک ۳۴۹٬۰۰۰ تومان / آنی پرو ۶۹۴٬۰۰۰ تومان)
۲. 🚨 اعلام مفقودی و ردیابی IMEI / کد ملی / پست یافته / آگهی روزنامه
۳. 🤝 ثبت اشیا و مدارک پیداشده با QR یا کد سریال و تماس امن
پاسخ کوتاه بده و در پایان یک پرسش روشن‌کننده بپرس.`,
};

/* ════════════════════════════════════════════════════════════════════════════
   3. Validation helpers
   ════════════════════════════════════════════════════════════════════════════ */

const VALID_FLOWS: readonly AniyabFlow[] = [
  'smart-tag',
  'lost-report',
  'found-report',
  'general',
] as const;

function isFlow(value: unknown): value is AniyabFlow {
  return typeof value === 'string' && (VALID_FLOWS as readonly string[]).includes(value);
}

/** Coerce arbitrary client data into a strictly-typed, size-capped transcript. */
function normaliseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const cleaned: ChatMessage[] = [];

  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (typeof item !== 'object' || item === null) continue;
    const { role, content } = item as Record<string, unknown>;

    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    if (typeof content !== 'string') continue;

    const trimmed = content.trim().slice(0, MAX_CONTENT_CHARS);
    if (!trimmed) continue;

    cleaned.push({ role, content: trimmed });
  }

  return cleaned.length > 0 ? cleaned : null;
}

function sanitiseSessionId(raw: unknown): string {
  if (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw)) return raw;
  // Edge runtime supports Web Crypto — same primitive the client uses.
  return crypto.randomUUID();
}

/* ════════════════════════════════════════════════════════════════════════════
   4. Response helpers
   ════════════════════════════════════════════════════════════════════════════ */

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extra: { hint?: string; retryAfter?: number; upstreamStatus?: number; sessionId?: string | null } = {},
): NextResponse<ErrorBody> {
  const { hint, retryAfter, upstreamStatus, sessionId = null } = extra;

  return NextResponse.json<ErrorBody>(
    {
      ok: false,
      error: { code, message, ...(hint ? { hint } : {}), ...(retryAfter ? { retryAfter } : {}), ...(upstreamStatus ? { upstreamStatus } : {}) },
      answer: message,
      sessionId,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    },
  );
}

/** Best-effort parse of the upstream `Retry-After` header (seconds or HTTP date). */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.ceil(asNumber);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Best-effort extraction of a human-readable upstream error message.
 * Handles NVIDIA (`{title, detail}`), OpenAI-style (`{error:{message}}`) and
 * plain-text bodies without ever throwing.
 */
function extractUpstreamMessage(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const err = obj.error;
      if (typeof err === 'string' && err.trim()) return err.trim().slice(0, 160);
      if (typeof err === 'object' && err !== null) {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 160);
      }
      for (const key of ['detail', 'title', 'message'] as const) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 160);
      }
    }
  } catch {
    // Non-JSON body (HTML error page, plain text) — fall through.
  }

  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine ? singleLine.slice(0, 160) : null;
}

/** Small non-blocking telemetry hook — swap for your real sink. */
function logUpstream(event: string, detail: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.error(`[aniyab/api/chat] ${event}`, detail);
}

/* ════════════════════════════════════════════════════════════════════════════
   5. POST /api/chat
   ════════════════════════════════════════════════════════════════════════════ */

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  /* ── 5.2 Body size guard (Edge: no Content-Length trust, read as text) ──── */
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'درخواست نامعتبر است. لطفاً صفحه را دوباره بارگذاری کنید.');
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'حجم گفتگو بیش از حد مجاز است. لطفاً گفتگوی جدیدی آغاز کنید.', {
      hint: 'RESET_SESSION',
    });
  }

  let body: ChatRequestBody;
  try {
    body = JSON.parse(rawBody) as ChatRequestBody;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'ساختار درخواست قابل خواندن نیست. لطفاً دوباره تلاش کنید.');
  }

  /* ── 5.3 Validate ───────────────────────────────────────────────────────── */
  const messages = normaliseMessages(body.messages);
  if (!messages) {
    return errorResponse(400, 'BAD_REQUEST', 'هیچ پیامی برای ارسال یافت نشد. لطفاً متن خود را بنویسید.');
  }

  const activeFlow: AniyabFlow = isFlow(body.activeFlow) ? body.activeFlow : 'general';
  const sessionId = sanitiseSessionId(body.sessionId);

  /* ── 5.4 Resolve the inference provider ─────────────────────────────────── */
  // Body may carry an explicit `provider`, but only the two known ids are honoured.
  const requestedProvider =
    body.provider === 'nvidia' || body.provider === 'laya' ? (body.provider as ProviderId) : null;

  const resolved = resolveProvider({
    requested: requestedProvider,
    sessionId,
    flow: activeFlow,
  });

  if (!resolved.ok) {
    logUpstream('missing_config', { reason: resolved.reason, nvidia: hasNvidiaKey(), laya: hasLayaInference() });
    return errorResponse(
      503,
      'NOT_CONFIGURED',
      `سرویس هوشمند آنی‌یاب در حال حاضر در دسترس نیست. لطفاً چند لحظه بعد تلاش کنید یا با پشتیبانی ۲۴ ساعته ${SUPPORT_HOTLINE} تماس بگیرید.`,
      { hint: 'ENV_MISSING' },
    );
  }

  let plan = resolved.plan;

  /* ── 5.5 SystemOne preflight (optional) ─────────────────────────────────── */
  // Control-plane call: short timeout, failures are non-fatal by design.
  const systemOne = systemOneConfig();

  // `orchestrate` mode: SystemOne becomes the *primary model endpoint* and NVIDIA
  // reverts to being the fallback. This is a topology switch, not a provider hint.
  if (systemOne.enabled && systemOne.mode === 'orchestrate' && systemOne.endpoint) {
    plan = {
      id: 'laya',
      label: 'Laya SystemOne (orchestrated)',
      endpoint: systemOne.endpoint,
      headers: {
        Authorization: `Bearer ${systemOne.apiKey}`,
        Accept: 'text/event-stream, application/json;q=0.9',
        'X-Laya-Gateway': 'systemone',
        'X-Aniyab-Flow': activeFlow,
        'X-Aniyab-Session': sessionId,
      },
      bodyExtras: plan.bodyExtras,
      strictBody: false,
    };
  }
  let hints: SystemOneHints = {};
  let systemOneStatus: 'off' | 'ok' | 'skipped' | 'failed' = 'off';

  if (systemOne.enabled && systemOne.mode === 'preflight' && systemOne.endpoint) {
    const conversation = messages.filter((m) => m.role !== 'system');
    const preflightBody: SystemOnePreflightBody = {
      session_id: sessionId,
      flow: activeFlow,
      locale: 'fa-IR',
      channel: 'aniyab-web',
      messages: conversation.slice(-12),
    };

    const preflightController = new AbortController();
    const preflightTimer = setTimeout(() => preflightController.abort(), SYSTEMONE_TIMEOUT_MS);

    try {
      const preflight = await fetch(systemOne.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${systemOne.apiKey}`,
          'X-Laya-Gateway': 'systemone',
          'X-Aniyab-Flow': activeFlow,
          'X-Aniyab-Session': sessionId,
        },
        body: JSON.stringify(preflightBody),
        signal: preflightController.signal,
        cache: 'no-store' as RequestCache,
      });

      if (preflight.ok) {
        const payload: unknown = await preflight.json().catch(() => null);
        hints = readSystemOneHints(payload);
        systemOneStatus = 'ok';
      } else {
        systemOneStatus = 'failed';
        logUpstream('systemone_preflight_rejected', {
          sessionId,
          status: preflight.status,
          ms: Date.now() - startedAt,
        });
      }
    } catch (err) {
      systemOneStatus = 'failed';
      logUpstream('systemone_preflight_error', {
        sessionId,
        cause: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(preflightTimer);
    }
  } else if (systemOne.enabled) {
    // Mode 'orchestrate' handles SystemOne further down; 'off' stays silent.
    systemOneStatus = systemOne.mode === 'orchestrate' ? 'skipped' : 'off';
  }

  /* ── 5.6 Build the upstream payload ─────────────────────────────────────── */
  // Strip any client-supplied system prompt: the server owns the persona.
  const conversation = messages.filter((m) => m.role !== 'system');

  // SystemOne may refine the persona; we keep our guardrails as the base and
  // append its instructions rather than replacing them outright.
  const systemPrompt = hints.system_prompt
    ? `${FLOW_PROMPTS[activeFlow]}\n\n[دستور تکمیلی SystemOne]\n${hints.system_prompt}`
    : FLOW_PROMPTS[activeFlow];

  /** Routing metadata — only sent to gateways that tolerate extra keys. */
  const routingMetadata = {
    gateway: systemOne.enabled ? 'systemone' : 'direct',
    provider: plan.id === 'nvidia' ? 'nvidia-nim' : 'laya',
    flow: activeFlow,
    session_id: sessionId,
    locale: 'fa-IR',
    channel: 'aniyab-web',
    app: 'aniyab-smart-assistant',
    ...(hints.metadata ?? {}),
  };

  /** The documented OpenAI chat-completions body — safe for every provider. */
  const upstreamPayload: Record<string, unknown> = {
    ...plan.bodyExtras,
    // A SystemOne hint may pin a different model; the provider default wins otherwise.
    ...(hints.model && plan.id === 'nvidia' ? { model: hints.model } : {}),
    stream: true,
    temperature: hints.temperature ?? 0.4,
    top_p: 0.9,
    max_tokens: hints.max_tokens ?? 1024,
    messages: [{ role: 'system', content: systemPrompt }, ...conversation],
  };

  // NVIDIA NIM answers 400 `Validation: Unsupported parameter(s)` for unknown
  // top-level keys, so strict providers only ever receive the documented fields.
  if (!plan.strictBody) {
    upstreamPayload.metadata = routingMetadata;
  }

  /* ── 5.7 Abort plumbing: client disconnect + hard timeout ───────────────── */
  // A plain flag is used instead of `abort(reason)` — some fetch implementations
  // reject non-standard reason values, and this stays readable across runtimes.
  let abortCause: 'timeout' | 'client-closed' | null = null;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortCause = 'timeout';
    timeoutController.abort();
  }, UPSTREAM_TIMEOUT_MS);

  /**
   * One-shot fetch helper.
   *
   * The systemone→NVIDIA fallback needs a *second* fetch. Reusing one signal
   * across two requests is unsafe: once the first response is consumed the
   * upstream body is gone, and some runtimes tear the signal down with it.
   * Every attempt therefore gets its own controller, linked to the shared
   * timeout/client-close controller so cancellation still propagates.
   */
  const fetchWithSignal = async (url: string, init: Omit<RequestInit, 'signal'>): Promise<Response> => {
    const attempt = new AbortController();
    const onAbort = () => attempt.abort();
    timeoutController.signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutController.signal.aborted) attempt.abort();

    try {
      return await fetch(url, { ...init, signal: attempt.signal });
    } finally {
      timeoutController.signal.removeEventListener('abort', onAbort);
    }
  };

  // If the browser closes the tab / navigates away, stop paying for tokens.
  if (request.signal) {
    request.signal.addEventListener(
      'abort',
      () => {
        abortCause = 'client-closed';
        timeoutController.abort();
      },
      { once: true },
    );
  }

  /* ── 5.8 Call the model provider ────────────────────────────────────────── */
  // Strict gateways (NVIDIA NIM) answer 400 for any key they do not recognise.
  // `upstreamPayload` is already stripped to documented fields, but a future
  // hint could slip an extra key in — so a 400 triggers one automatic retry
  // with the bare-minimum body before we surface an error to the user.

  let upstream: Response;
  try {
    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json;q=0.9',
        ...plan.headers,
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(upstreamPayload),
      signal: timeoutController.signal,
      cache: 'no-store' as RequestCache,
      // `duplex` is required by undici for request bodies; harmless with a string.
      duplex: 'half',
    };

    upstream = await fetchWithSignal(plan.endpoint, requestInit);
  } catch (cause) {
    clearTimeout(timeoutId);
    const abortedByTimeout = abortCause === 'timeout';

    logUpstream(abortedByTimeout ? 'timeout' : 'network_error', {
      sessionId,
      flow: activeFlow,
      provider: plan.id,
      ms: Date.now() - startedAt,
      cause: cause instanceof Error ? cause.message : String(cause),
    });

    if (abortedByTimeout) {
      return errorResponse(
        504,
        'TIMEOUT',
        `پاسخی از هسته هوشمند دریافت نشد. اتصال شما برقرار است؛ لطفاً دوباره بفرستید یا با ${SUPPORT_HOTLINE} تماس بگیرید.`,
        { hint: 'RETRY', sessionId },
      );
    }

    if (abortCause === 'client-closed') {
      // Nobody is listening anymore — exit quietly with a 499-style body.
      return new Response(null, { status: 499 });
    }

    return errorResponse(
      502,
      'NETWORK',
      `ارتباط با سرویس هوش مصنوعی (${plan.id === 'nvidia' ? 'NVIDIA NIM' : 'Laya'}) برقرار نشد. لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.`,
      { hint: 'RETRY', sessionId },
    );
  }

  /* ── 5.8d Retired-model recovery (404 / 410) ────────────────────────────── */
  // NVIDIA retires models without warning (`410 Gone`, e.g.
  // meta/llama-3.1-8b-instruct on 2026-08-26). Rather than fail the turn we walk
  // the live model chain and re-issue the same request, so a retired default can
  // never take the assistant down.
  if (
    !upstream.ok &&
    (MODEL_UNAVAILABLE_STATUSES as readonly number[]).includes(upstream.status) &&
    plan.id === 'nvidia'
  ) {
    const configured = typeof upstreamPayload.model === 'string' ? upstreamPayload.model : MODEL;
    const remaining = nvidiaModelChain(configured).filter((m) => m !== configured);

    for (const candidate of remaining) {
      logUpstream('model_retired_retry', {
        sessionId,
        from: configured,
        to: candidate,
        status: upstream.status,
      });

      await upstream.text().catch(() => '');

      const retry = await fetchWithSignal(plan.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json;q=0.9',
          ...plan.headers,
          'X-Request-Id': crypto.randomUUID(),
        },
        body: JSON.stringify({ ...upstreamPayload, model: candidate }),
        cache: 'no-store' as RequestCache,
      }).catch(() => null);

      if (retry && retry.ok) {
        upstream = retry;
        upstreamPayload.model = candidate;
        logUpstream('model_retired_retry_ok', { sessionId, model: candidate });
        break;
      }

      if (retry) {
        await retry.text().catch(() => '');
        // Only keep walking while the model itself is the problem.
        if (!(MODEL_UNAVAILABLE_STATUSES as readonly number[]).includes(retry.status)) {
          upstream = retry; // real error (auth, rate limit, …) — surface it
          break;
        }
      }
    }
  }

  /* ── 5.9 SystemOne orchestration → NVIDIA fallback ──────────────────────── */
  // In 'orchestrate' mode SystemOne was called as the model endpoint above.
  // If it is unusable we transparently fall back to NVIDIA so the user still
  // gets an answer; the response headers record which path served the turn.
  let servedBy: 'systemone' | 'nvidia' | 'laya' =
    systemOne.enabled && systemOne.mode === 'orchestrate' && systemOne.endpoint
      ? 'systemone'
      : plan.id === 'laya'
        ? 'laya'
        : 'nvidia';

  if (systemOne.enabled && systemOne.mode === 'orchestrate' && systemOne.endpoint) {
    if (!upstream.ok && hasNvidiaKey()) {
      logUpstream('systemone_fallback', {
        sessionId,
        status: upstream.status,
        ms: Date.now() - startedAt,
      });
      const fallback = resolveProvider({ requested: 'nvidia', sessionId, flow: activeFlow });
      if (fallback.ok) {
        try {
          // Drain the failed SystemOne response first so its socket is released
          // before we open a second upstream connection.
          await upstream.text().catch(() => '');

          const retry = await fetchWithSignal(fallback.plan.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream, application/json;q=0.9',
              ...fallback.plan.headers,
              'X-Request-Id': crypto.randomUUID(),
            },
            body: JSON.stringify({ ...upstreamPayload, ...fallback.plan.bodyExtras }),
            cache: 'no-store' as RequestCache,
          });

          if (retry.ok) {
            upstream = retry;
            servedBy = 'nvidia';
          } else {
            await retry.text().catch(() => '');
            logUpstream('systemone_fallback_failed', { sessionId, status: retry.status });
          }
        } catch (err) {
          logUpstream('systemone_fallback_failed', {
            sessionId,
            cause: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /* ── 5.7 Upstream HTTP error mapping ────────────────────────────────────── */
  if (!upstream.ok) {
    clearTimeout(timeoutId);

    const upstreamStatus = upstream.status;
    const retryAfter = parseRetryAfter(upstream.headers.get('retry-after'));
    // Drain the body (bounded) so the connection can be reused + for logging.
    const upstreamText = await upstream.text().catch(() => '');
    const upstreamDetail = upstreamText.slice(0, 600);

    logUpstream('upstream_error', {
      sessionId,
      flow: activeFlow,
      provider: plan.id,
      servedBy,
      status: upstreamStatus,
      ms: Date.now() - startedAt,
      detail: upstreamDetail,
    });

    // NVIDIA returns `{"type":"...","title":"...","detail":"..."}`; Laya/OpenAI
    // style gateways return `{"error":{"message":"..."}}`. Best-effort extraction
    // so the operator-facing copy can name the real cause.
    const upstreamMessage = extractUpstreamMessage(upstreamDetail);

    switch (upstreamStatus) {
      case 401:
      case 403:
        return errorResponse(
          502,
          'UNAUTHORIZED',
          `کلید دسترسی سرویس هوش مصنوعی پذیرفته نشد (کد ${toFaDigits(upstreamStatus)}).${
            upstreamMessage ? ` جزئیات: ${upstreamMessage}` : ''
          } لطفاً با پشتیبانی فنی ${SUPPORT_HOTLINE} تماس بگیرید.`,
          { hint: 'CONTACT_SUPPORT', upstreamStatus, sessionId },
        );

      case 404:
        return errorResponse(
          502,
          'UPSTREAM_NOT_FOUND',
          'مسیر سرویس هوش مصنوعی یافت نشد. لطفاً بعداً تلاش کنید؛ تیم فنی مطلع شد.',
          { hint: 'CONTACT_SUPPORT', upstreamStatus, sessionId },
        );

      case 408:
      case 504:
        return errorResponse(
          504,
          'TIMEOUT',
          'پاسخ هسته هوشمند دیرتر از حد انتظار رسید. لطفاً دوباره ارسال کنید.',
          { hint: 'RETRY', upstreamStatus, retryAfter, sessionId },
        );

      case 400: {
        // NVIDIA NIM: `Validation: Unsupported parameter(s): ...` / bad model id.
        // Most such 400s mean an unrecognised body key, so retry once with the
        // bare-minimum chat body before failing the turn.
        const nvidiaEndpoint =
          process.env.NVIDIA_API_ENDPOINT?.trim() || NVIDIA_DEFAULT_ENDPOINT;

        if (hasNvidiaKey() && plan.endpoint === nvidiaEndpoint) {
          const slim = await fetchWithSignal(plan.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream, application/json;q=0.9',
              ...plan.headers,
              'X-Request-Id': crypto.randomUUID(),
            },
            body: JSON.stringify(slimPayload(upstreamPayload)),
            cache: 'no-store' as RequestCache,
          }).catch(() => null);

          if (slim && slim.ok) {
            logUpstream('strict_body_retry_ok', {
              sessionId,
              provider: plan.id,
              firstStatus: upstreamStatus,
              ms: Date.now() - startedAt,
            });

            const retryType = slim.headers.get('content-type') ?? '';
            if (retryType.includes('text/event-stream')) {
              return new Response(slim.body, {
                status: 200,
                headers: {
                  'Content-Type': 'text/event-stream; charset=utf-8',
                  'Cache-Control': 'no-cache, no-transform',
                  Connection: 'keep-alive',
                  'X-Accel-Buffering': 'no',
                  'X-Aniyab-Served-By': plan.id,
                  'X-Aniyab-Systemone': systemOneStatus,
                  'X-Aniyab-Retry': 'slim-body',
                },
              });
            }

            const slimJson = (await slim.json().catch(() => null)) as {
              choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
              answer?: string;
            } | null;

            const slimAnswer =
              slimJson?.choices?.[0]?.message?.content ??
              slimJson?.choices?.[0]?.delta?.content ??
              slimJson?.answer ??
              '';

            if (!slimAnswer.trim()) {
              logUpstream('strict_body_retry_empty', { sessionId, provider: plan.id });
            } else {
              return successJson(slimAnswer, sessionId, activeFlow, startedAt, {
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'X-Accel-Buffering': 'no',
                'X-Aniyab-Session': sessionId,
                'X-Aniyab-Flow': activeFlow,
                'X-Aniyab-Served-By': servedBy,
                'X-Aniyab-Systemone': systemOneStatus,
                'X-Aniyab-Retry': 'slim-body',
              }, {
                servedBy,
                model: typeof upstreamPayload.model === 'string' ? upstreamPayload.model : MODEL,
                systemOne: systemOneStatus,
              });
            }
          }

          logUpstream('strict_body_retry_failed', {
            sessionId,
            provider: plan.id,
            firstStatus: upstreamStatus,
            retryStatus: slim?.status ?? 'network',
            reason: upstreamDetail.slice(0, 300),
          });
        }

        return errorResponse(
          502,
          'UPSTREAM_ERROR',
          `درخواست به سرویس هوش مصنوعی پذیرفته نشد (کد ${toFaDigits(400)}).${
            upstreamMessage ? ` پیام سرویس: ${upstreamMessage.replace(/\.$/, '')}.` : ''
          } لطفاً چند لحظه بعد دوباره تلاش کنید یا با ${SUPPORT_HOTLINE} تماس بگیرید.`,
          { hint: 'RETRY', upstreamStatus, sessionId },
        );
      }

      case 402:
      case 429:
        // NVIDIA's free tier returns 429 both for rate limits and exhausted
        // credits, so the upstream message matters for the operator.
        return errorResponse(
          429,
          'RATE_LIMITED',
          `سهمیه یا محدودیت نرخ مصرف سرویس هوش مصنوعی پر شده است.${
            upstreamMessage ? ` پیام سرویس: ${upstreamMessage.replace(/\.$/,'')}.` : ''
          } لطفاً ${retryAfter ? `${toFaDigits(retryAfter)} ثانیه` : 'چند لحظه'} صبر کنید و دوباره بفرستید.`,
          { hint: 'WAIT', retryAfter: retryAfter ?? 20, upstreamStatus, sessionId },
        );

      default:
        if (upstreamStatus >= 500) {
          return errorResponse(
            502,
            'UPSTREAM_UNAVAILABLE',
            'هسته هوشمند موقتاً در دسترس نیست. تلاش ما برای اتصال دوباره ادامه دارد؛ لطفاً یک بار دیگر بفرستید.',
            { hint: 'RETRY', upstreamStatus, sessionId },
          );
        }
        return errorResponse(
          502,
          'UPSTREAM_ERROR',
          'خطای غیرمنتظره‌ای در سرویس هوشمند رخ داد. لطفاً دوباره تلاش کنید.',
          { hint: 'RETRY', upstreamStatus, sessionId },
        );
    }
  }

  /* ── 5.8 Content-Type negotiation ───────────────────────────────────────── */
  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const commonHeaders: Record<string, string> = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'X-Accel-Buffering': 'no', // defeat nginx buffering on the way out
    'X-Aniyab-Session': sessionId,
    'X-Aniyab-Flow': activeFlow,
    // Which upstream actually produced this turn — useful in production logs.
    'X-Aniyab-Served-By': servedBy,
    'X-Aniyab-Systemone': systemOneStatus,
  };

  /* ── 5.8a SSE: pipe the raw stream through unchanged ────────────────────── */
  if (contentType.includes('text/event-stream')) {
    if (!upstream.body) {
      clearTimeout(timeoutId);
      return errorResponse(502, 'UPSTREAM_ERROR', 'جریان پاسخ خالی بود. لطفاً دوباره بفرستید.', {
        hint: 'RETRY',
        sessionId,
      });
    }

    // NOTE: the timeout is intentionally *not* cleared here — it stays armed for
    // the lifetime of the stream, then is cleared when the pipe settles.
    const upstreamBody = upstream.body;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamBody.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          // Surface a final SSE frame so the client can stop its typing state.
          try {
            const reason = abortCause === 'timeout' ? 'timeout' : 'stream_error';
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  error: { code: reason, message: 'جریان پاسخ ناتمام ماند. لطفاً دوباره بفرستید.' },
                })}\n\ndata: [DONE]\n\n`,
              ),
            );
          } catch {
            /* controller already closed */
          }
          controller.close();
          logUpstream('stream_error', {
            sessionId,
            flow: activeFlow,
            ms: Date.now() - startedAt,
            cause: err instanceof Error ? err.message : String(err),
          });
        } finally {
          clearTimeout(timeoutId);
          reader.releaseLock();
        }
      },
      cancel() {
        // Client closed the EventSource / reader → abort upstream generation.
        clearTimeout(timeoutId);
        abortCause = 'client-closed';
        timeoutController.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...commonHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        // Transfer-Encoding is deliberately NOT set — the runtime/CDN frames the
        // response, and a manual value breaks streaming behind some proxies.
      },
    });
  }

  /* ── 5.8b JSON: parse, normalise, return the standard envelope ──────────── */
  if (contentType.includes('application/json') || contentType === '') {
    let data: unknown;
    try {
      data = await upstream.json();
    } catch (err) {
      clearTimeout(timeoutId);
      logUpstream('json_parse_error', {
        sessionId,
        cause: err instanceof Error ? err.message : String(err),
      });
      return errorResponse(502, 'UPSTREAM_ERROR', 'پاسخ سرویس هوشمند قابل خواندن نبود. لطفاً دوباره تلاش کنید.', {
        hint: 'RETRY',
        sessionId,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const parsed = data as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        delta?: { content?: string | null; reasoning_content?: string | null };
      }>;
      answer?: string;
      output?: { text?: string } | string;
      content?: string;
      error?: { message?: string };
    };

    const answer =
      parsed?.choices?.[0]?.message?.content ??
      parsed?.choices?.[0]?.delta?.content ??
      parsed?.answer ??
      (typeof parsed?.output === 'string' ? parsed.output : parsed?.output?.text) ??
      parsed?.content ??
      // Reasoning models answer in `reasoning_content` when the token budget is
      // spent on the thinking pass — better than an empty bubble.
      parsed?.choices?.[0]?.message?.reasoning_content ??
      parsed?.choices?.[0]?.delta?.reasoning_content ??
      '';

    if (!answer.trim()) {
      return errorResponse(502, 'UPSTREAM_ERROR', 'پاسخ خالی از هسته هوشمند دریافت شد. لطفاً دوباره بفرستید.', {
        hint: 'RETRY',
        sessionId,
      });
    }

    return successJson(answer, sessionId, activeFlow, startedAt, commonHeaders, {
      servedBy,
      model: typeof upstreamPayload.model === 'string' ? upstreamPayload.model : MODEL,
      systemOne: systemOneStatus,
    });
  }

  /* ── 5.8c Anything else (text/plain, NDJSON, …) ─────────────────────────── */
  clearTimeout(timeoutId);
  const plain = (await upstream.text().catch(() => '')).trim();
  if (!plain) {
    return errorResponse(502, 'UPSTREAM_ERROR', 'پاسخ سرویس هوشمند قابل خواندن نبود. لطفاً دوباره تلاش کنید.', {
      hint: 'RETRY',
      sessionId,
    });
  }

  return successJson(plain, sessionId, activeFlow, startedAt, commonHeaders, {
    servedBy,
    model: typeof upstreamPayload.model === 'string' ? upstreamPayload.model : MODEL,
    systemOne: systemOneStatus,
  });
}

/** The single success envelope: OpenAI-compatible `choices` + a flat `answer`. */
function successJson(
  answer: string,
  sessionId: string,
  activeFlow: AniyabFlow,
  startedAt: number,
  headers: Record<string, string>,
  meta: { servedBy: string; model: string; systemOne: string },
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      sessionId,
      activeFlow,
      model: meta.model,
      servedBy: meta.servedBy,
      systemOne: meta.systemOne,
      latencyMs: Date.now() - startedAt,
      // OpenAI-compatible shape so the client has exactly one JSON code path…
      choices: [
        { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
      ],
      // …plus the flat convenience field the client also accepts.
      answer,
    },
    { status: 200, headers },
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   6. Method + health helpers
   ════════════════════════════════════════════════════════════════════════════ */

export async function GET(request: Request): Promise<Response> {
  const systemOne = systemOneConfig();
  const ready = hasNvidiaKey() || hasLayaInference();

  // Diagnose the live upstream from inside the deployment itself.
  const probeUrl = new URL(request.url);
  const wantsProbe = probeUrl.searchParams.get('probe') === '1';
  // `?model=<id>` lets an operator vet a specific model id from production.
  const probeModel = probeUrl.searchParams.get('model')?.trim() || null;
  let probe: Record<string, unknown> | undefined;

  if (wantsProbe && ready) {
    const resolvedProbe = resolveProvider({ requested: null, sessionId: 'health-probe', flow: 'general' });
    if (!resolvedProbe.ok) {
      probe = { attempted: false, reason: resolvedProbe.reason };
    } else {
      const startedProbe = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(resolvedProbe.plan.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...resolvedProbe.plan.headers },
          body: JSON.stringify(
            slimPayload({
              ...resolvedProbe.plan.bodyExtras,
              ...(probeModel ? { model: probeModel } : {}),
              stream: false,
              max_tokens: 16,
              temperature: 0,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          ),
          signal: controller.signal,
          cache: 'no-store' as RequestCache,
        });

        const text = await res.text().catch(() => '');
        // Reasoning models return content:null + reasoning_content. Flag it so a
        // candidate can be judged without reading the whole body.
        let reasoningOnly: boolean | undefined;
        try {
          const parsedProbe = JSON.parse(text) as {
            choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
          };
          const msg = parsedProbe.choices?.[0]?.message;
          if (msg) reasoningOnly = !msg.content && Boolean(msg.reasoning_content);
        } catch {
          reasoningOnly = undefined;
        }

        probe = {
          attempted: true,
          provider: resolvedProbe.plan.id,
          model: probeModel ?? resolvedProbe.plan.bodyExtras.model,
          status: res.status,
          ok: res.ok,
          ms: Date.now() - startedProbe,
          ...(reasoningOnly === undefined ? {} : { reasoningOnly }),
          // Bounded: enough to see `Unsupported parameter(s)` / auth errors.
          body: text.slice(0, 400),
        };
      } catch (err) {
        probe = {
          attempted: true,
          provider: resolvedProbe.plan.id,
          status: 'network',
          ms: Date.now() - startedProbe,
          cause: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return NextResponse.json(
    {
      ok: ready,
      service: 'aniyab-smart-assistant',
      runtime,
      providers: {
        inference: {
          default: process.env.LLM_PROVIDER?.trim() || 'nvidia',
          nvidia: {
            configured: hasNvidiaKey(),
            endpoint: process.env.NVIDIA_API_ENDPOINT?.trim() || NVIDIA_DEFAULT_ENDPOINT,
            model: MODEL,
          },
          laya: {
            configured: hasLayaInference(),
            endpoint: process.env.LAYA_API_ENDPOINT?.trim() || null,
          },
        },
        orchestration: {
          systemone: {
            configured: systemOne.enabled,
            mode: systemOne.mode,
            endpoint: systemOne.endpoint,
          },
        },
      },
      flows: VALID_FLOWS,
      // `?probe=1` performs a real (tiny, non-streaming) round-trip so a
      // deployment can be verified end-to-end without leaking any answer text.
      ...(probe ? { probe } : {}),
      hint: ready
        ? 'POST { messages, sessionId, activeFlow } به این مسیر.'
        : 'هیچ ارائه‌دهنده‌ای تنظیم نشده است: NVIDIA_API_KEY یا LAYA_API_ENDPOINT+LAYA_API_KEY را تنظیم کنید.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, OPTIONS',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/* ── Local utility (Edge-safe: no Intl.Persian dependence) ────────────────── */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;
function toFaDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)] ?? d);
}
