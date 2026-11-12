/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  app/api/chat/route.ts
 *  Aniyab Smart Assistant — orchestrator gateway (Edge Runtime)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  POST /api/chat
 *  body: { messages: ChatMessage[], sessionId: string, activeFlow: AniyabFlow }
 *
 *  This handler is a *transparent proxy with guardrails* in front of the
 *  Laya.Studio Orchestrator (a.k.a. the SystemOne gateway) which fans out to
 *  NVIDIA NIM `meta/llama-3.1-8b-instruct`.
 *
 *  Responsibilities
 *  ────────────────
 *  1. Validate & normalise the inbound payload (never trust the browser).
 *  2. Inject the system prompt for the active Aniyab business flow and the
 *     Laya `Authorization: Bearer <LAYA_API_KEY>` header.
 *  3. Forward the request upstream with a hard timeout + abort propagation.
 *  4. Inspect the upstream `Content-Type`:
 *       • `text/event-stream`  → pipe the ReadableStream straight back to the
 *                                browser (zero buffering, zero re-encoding).
 *       • `application/json`   → parse, normalise to the OpenAI-compatible
 *                                envelope and return it.
 *  5. Map upstream failures to a stable, Persian-language JSON error contract
 *     (403 / 404 / 429 / 5xx / timeout / network).
 *
 *  Runtime: Edge. It keeps the streaming pipe allocation-free and gives us
 *  zero-cold-start behaviour for the first token. If your Laya deployment needs
 *  Node-only APIs (custom CA, mTLS, `zlib`), swap the two exports below for:
 *      export const runtime = 'nodejs';
 *      export const dynamic = 'force-dynamic';
 */

import { NextResponse } from 'next/server';

/* ════════════════════════════════════════════════════════════════════════════
   0. Runtime & contract types
   ════════════════════════════════════════════════════════════════════════════ */

export const runtime = 'edge';
/** Never let the CDN cache a conversation turn. */
export const dynamic = 'force-dynamic';

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

const UPSTREAM_TIMEOUT_MS = Number(process.env.LAYA_TIMEOUT_MS ?? 45_000);
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8_000;
const MAX_BODY_BYTES = 256 * 1024; // 256 KiB is plenty for 40 turns of text.

const SUPPORT_HOTLINE = '۰۲۱-۶۲۸۰۱';

const MODEL = process.env.LAYA_MODEL ?? 'meta/llama-3.1-8b-instruct';

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

  /* ── 5.1 Env guard ──────────────────────────────────────────────────────── */
  const endpoint = process.env.LAYA_API_ENDPOINT?.trim();
  const apiKey = process.env.LAYA_API_KEY?.trim();

  if (!endpoint || !apiKey) {
    logUpstream('missing_config', {
      hasEndpoint: Boolean(endpoint),
      hasKey: Boolean(apiKey),
    });
    return errorResponse(
      503,
      'NOT_CONFIGURED',
      `سرویس هوشمند آنی‌یاب در حال حاضر در دسترس نیست. لطفاً چند لحظه بعد تلاش کنید یا با پشتیبانی ۲۴ ساعته ${SUPPORT_HOTLINE} تماس بگیرید.`,
      { hint: 'ENV_MISSING' },
    );
  }

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

  /* ── 5.4 Build the upstream payload ─────────────────────────────────────── */
  // Strip any client-supplied system prompt: the server owns the persona.
  const conversation = messages.filter((m) => m.role !== 'system');

  const upstreamPayload = {
    model: MODEL,
    stream: true,
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: FLOW_PROMPTS[activeFlow] },
      ...conversation,
    ],
    // Laya.Studio Orchestrator routing hints (ignored by plain OpenAI gateways).
    metadata: {
      gateway: 'systemone',
      provider: 'nvidia-nim',
      model: MODEL,
      flow: activeFlow,
      session_id: sessionId,
      locale: 'fa-IR',
      channel: 'aniyab-web',
      app: 'aniyab-smart-assistant',
    },
  };

  /* ── 5.5 Abort plumbing: client disconnect + hard timeout ───────────────── */
  // A plain flag is used instead of `abort(reason)` — some fetch implementations
  // reject non-standard reason values, and this stays readable across runtimes.
  let abortCause: 'timeout' | 'client-closed' | null = null;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortCause = 'timeout';
    timeoutController.abort();
  }, UPSTREAM_TIMEOUT_MS);

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

  /* ── 5.6 Call upstream ──────────────────────────────────────────────────── */
  let upstream: Response;
  try {
    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json;q=0.9',
        Authorization: `Bearer ${apiKey}`,
        'X-Laya-Gateway': 'systemone',
        'X-Aniyab-Flow': activeFlow,
        'X-Aniyab-Session': sessionId,
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(upstreamPayload),
      signal: timeoutController.signal,
      // Edge runtime: cache is a no-op but explicit is better than implicit.
      cache: 'no-store' as RequestCache,
      // `duplex` is required by undici for request bodies; harmless with a string.
      duplex: 'half',
    };

    upstream = await fetch(endpoint, requestInit);
  } catch (cause) {
    clearTimeout(timeoutId);
    const abortedByTimeout = abortCause === 'timeout';

    logUpstream(abortedByTimeout ? 'timeout' : 'network_error', {
      sessionId,
      flow: activeFlow,
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
      'ارتباط با هسته هوشمند Laya برقرار نشد. لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.',
      { hint: 'RETRY', sessionId },
    );
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
      status: upstreamStatus,
      ms: Date.now() - startedAt,
      detail: upstreamDetail,
    });

    switch (upstreamStatus) {
      case 401:
      case 403:
        return errorResponse(
          502,
          'UNAUTHORIZED',
          `هسته هوشمند درخواست این مرکز را نپذیرفت (کد ۴۰۳). لطفاً با پشتیبانی فنی ${SUPPORT_HOTLINE} تماس بگیرید.`,
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

      case 429:
        return errorResponse(
          429,
          'RATE_LIMITED',
          `تعداد درخواست‌ها زیاد است (محدودیت نرخ مصرف). لطفاً ${retryAfter ? `${toFaDigits(retryAfter)} ثانیه` : 'چند لحظه'} صبر کنید و سپس دوباره بفرستید.`,
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
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
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
      choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
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
      '';

    if (!answer.trim()) {
      return errorResponse(502, 'UPSTREAM_ERROR', 'پاسخ خالی از هسته هوشمند دریافت شد. لطفاً دوباره بفرستید.', {
        hint: 'RETRY',
        sessionId,
      });
    }

    return successJson(answer, sessionId, activeFlow, startedAt, commonHeaders);
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

  return successJson(plain, sessionId, activeFlow, startedAt, commonHeaders);
}

/** The single success envelope: OpenAI-compatible `choices` + a flat `answer`. */
function successJson(
  answer: string,
  sessionId: string,
  activeFlow: AniyabFlow,
  startedAt: number,
  headers: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      sessionId,
      activeFlow,
      model: MODEL,
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

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      ok: true,
      service: 'aniyab-smart-assistant',
      orchestrator: process.env.LAYA_API_ENDPOINT ? 'configured' : 'missing',
      model: MODEL,
      runtime,
      flows: VALID_FLOWS,
      hint: 'POST { messages, sessionId, activeFlow } به این مسیر.',
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
