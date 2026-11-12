import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';

import { createAgentTurn } from '@/lib/agent/orchestrator';
import { extractMemories } from '@/lib/agent/extract';
import { buildCustomerBrief } from '@/lib/agent/memory';
import { supabaseConfigured } from '@/lib/db/client';
import {
  findOrCreateCustomer,
  getOrCreateConversation,
  recentMessages,
  saveMessage,
  logEvent,
} from '@/lib/db/store';
import { decide, layaConfig, readChoice } from '@/lib/laya';
import { hasLayaInference, hasNvidiaKey, nvidiaModelChain, NVIDIA_DEFAULT_ENDPOINT } from '@/lib/llm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POST /api/chat — the ONLY conversation endpoint
 * ─────────────────────────────────────────────────────────────────────────────
 *  Responsibilities are deliberately thin; the interesting work lives in
 *  lib/agent/*. This file: validate → identify → brief → stream → persist.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(8_000),
        }),
      )
      .min(1)
      .max(40),
    sessionId: z.string().max(120).optional(),
    activeFlow: z.enum(['smart-tag', 'lost-report', 'found-report', 'general']).optional(),
    conversationId: z.string().max(120).optional(),
    /** Anonymous Supabase auth id (device identity), bound server-side. */
    deviceId: z.string().max(120).optional(),
    /** Return X-Ray trace data in the meta frame. */
    xray: z.boolean().optional(),
    /** `?scripted=1` — canned narration instead of the model (demo safety net). */
    scripted: z.boolean().optional(),
  })
  .strict();

function jsonError(status: number, code: string, message: string, hint?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(hint ? { hint } : {}) }, answer: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/* ── GET /api/chat → health (kept from v1, extended) ───────────────────────── */

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const laya = layaConfig();
  const probe = url.searchParams.get('probe') === '1';
  const streamProbe = url.searchParams.get('stream') === '1';
  const probeModel = url.searchParams.get('model')?.trim() || null;

  const ready = hasNvidiaKey() || hasLayaInference();
  const payload: Record<string, unknown> = {
    ok: ready,
    service: 'aniyab-smart-assistant',
    version: 2,
    runtime: 'nodejs',
    providers: {
      inference: {
        default: process.env.LLM_PROVIDER?.trim() || 'nvidia',
        nvidia: {
          configured: hasNvidiaKey(),
          endpoint: process.env.NVIDIA_API_ENDPOINT?.trim() || NVIDIA_DEFAULT_ENDPOINT,
          models: nvidiaModelChain(process.env.NVIDIA_MODEL),
        },
      },
      orchestration: {
        systemone: {
          configured: laya.enabled,
          status: laya.enabled ? 'live' : 'off',
          model: laya.model,
          endpoint: laya.endpoint,
        },
      },
    },
    storage: { supabase: supabaseConfigured(), mode: supabaseConfigured() ? 'supabase' : 'ephemeral' },
    flows: ['smart-tag', 'lost-report', 'found-report', 'general'],
  };

  if (probe && ready) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(process.env.NVIDIA_API_ENDPOINT?.trim() || NVIDIA_DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: streamProbe ? 'text/event-stream' : 'application/json',
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY?.trim() ?? ''}`,
        },
        body: JSON.stringify({
          model: probeModel ?? nvidiaModelChain(process.env.NVIDIA_MODEL)[0],
          messages: [{ role: 'user', content: streamProbe ? 'سلام، یک جمله کوتاه فارسی بنویس.' : 'ping' }],
          stream: streamProbe,
          max_tokens: streamProbe ? 64 : 16,
          temperature: 0,
          // Tool calling is what the whole agent depends on — verify it live.
          ...(url.searchParams.get('tools') === '1'
            ? {
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: 'validate_imei',
                      description: 'Validate a 15-digit IMEI.',
                      parameters: {
                        type: 'object',
                        properties: { imei: { type: 'string' } },
                        required: ['imei'],
                      },
                    },
                  },
                ],
                tool_choice: 'auto',
              }
            : {}),
          ...(url.searchParams.get('tools') === '1'
            ? { messages: [{ role: 'user', content: 'کد IMEI من را بررسی کن: 356938035643809' }] }
            : {}),
        }),
        signal: controller.signal,
        cache: 'no-store' as RequestCache,
      });
      const text = await res.text().catch(() => '');
      let toolCalls = 0;
      let reasoningOnly: boolean | undefined;
      try {
        const j = JSON.parse(text) as {
          choices?: Array<{
            message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: unknown[] };
          }>;
        };
        const msg = j.choices?.[0]?.message;
        toolCalls = msg?.tool_calls?.length ?? 0;
        if (msg) reasoningOnly = !msg.content && Boolean(msg.reasoning_content);
      } catch {
        /* streaming or non-JSON */
      }
      payload.probe = {
        attempted: true,
        status: res.status,
        ok: res.ok,
        ms: Date.now() - started,
        toolCalls,
        ...(reasoningOnly === undefined ? {} : { reasoningOnly }),
        body: streamProbe ? undefined : text.slice(0, 300),
      };
    } catch (err) {
      payload.probe = {
        attempted: true,
        status: 'network',
        ms: Date.now() - started,
        cause: err instanceof Error ? err.message : 'unknown',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `?laya=1` → one real decision round-trip. This is the difference between
   * "the key is present" and "Laya answers our questions": it sends a genuine
   * `{state, questions}` request and reports the probability that comes back.
   */
  /**
   * NOTE: this probe spends credits (1 credit = 1 input token). That is fine for
   * an explicit `?laya=1` from an operator, and wrong for anything periodic — so
   * /api/health never calls Laya. It reports the last real decision instead, and
   * `checks.laya.last` is set by this very probe.
   */
  if (url.searchParams.get('laya') === '1' && laya.enabled) {
    const started = Date.now();
    const { decision, trace } = await decide({
      state: 'کارت ملی‌ام را در مترو گم کردم',
      questions: {
        tool: {
          type: 'choice',
          instructions: 'کدام ابزار باید اول اجرا شود؟',
          criteria: { create_lost_report: 'ثبت مفقودی', none: 'هیچ‌کدام' },
        },
      },
    });
    const top = readChoice(decision?.answers.tool);
    payload.layaProbe = {
      attempted: true,
      status: trace.status,
      ms: Date.now() - started,
      model: trace.model,
      choice: top?.label ?? null,
      probability: top?.probability ?? null,
      creditsCharged: trace.creditsCharged ?? null,
      ...(trace.error ? { error: trace.error, errorStatus: trace.errorStatus } : {}),
    };
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, OPTIONS',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/* ── POST /api/chat ───────────────────────────────────────────────────────── */

export async function POST(request: Request): Promise<Response> {
  /* 1. size guard (never trust Content-Length) */
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', 'متن گفتگو بیش از حد طولانی است.', 'SHORTEN');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'ساختار درخواست قابل خواندن نیست. لطفاً دوباره تلاش کنید.');
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return jsonError(400, 'BAD_REQUEST', 'پیام معتبری برای ارسال پیدا نشد.');
  }

  const { messages, sessionId, activeFlow, conversationId, deviceId, xray, scripted } = parsed.data;
  // Scripted mode can be forced globally by env, which is what the demo build uses.
  const scriptedMode = Boolean(scripted) || process.env.DEMO_SCRIPTED === '1';
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser?.content.trim()) {
    return jsonError(400, 'BAD_REQUEST', 'متن پیام خالی است.');
  }

  /* 2. identity — the server decides who this is, never the model */
  const customer = await findOrCreateCustomer({
    authUserId: deviceId ?? null,
    phone: null,
  });

  const conversation = await getOrCreateConversation({
    customerId: customer.id,
    flow: activeFlow ?? 'general',
    conversationId: conversationId ?? null,
  });

  /* 3. short-term history from the DB when the client did not resend it */
  const persisted = await recentMessages(conversation.id, 12);
  const history =
    persisted.length > 0
      ? persisted
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          .slice(0, -1)
      : messages.slice(0, -1);

  /* 4. long-term memory → customer brief */
  const brief = await buildCustomerBrief({ customer, conversation });

  await saveMessage({ conversationId: conversation.id, role: 'user', content: lastUser.content });

  /* 5. run the agent */
  const { stream, completion } = createAgentTurn({
    flow: activeFlow ?? 'general',
    sessionId: sessionId ?? conversation.id,
    customerId: customer.id,
    conversationId: conversation.id,
    history,
    userText: lastUser.content,
    customerBrief: brief.promptFa,
    // Envelope mode is the deterministic fallback; native tools are the default.
    envelopeMode: process.env.AGENT_MODE === 'envelope',
    xray: Boolean(xray),
    scripted: scriptedMode,
  });

  /* 6. persist + remember after the response has been flushed */
  // Next 14 has no `after()`; `waitUntil` keeps the lambda alive just long
  // enough to persist the turn + extract memories without delaying the stream.
  const backgroundTask = (async () => {
    try {
      const { meta: finalMeta, text: assistantText } = await completion;
      await saveMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: assistantText.slice(0, 8_000) || '(بدون متن)',
        servedBy: finalMeta.servedBy,
        latencyMs: finalMeta.latencyMs,
      });
      await logEvent({
        customerId: customer.id,
        type: 'chat.turn',
        payload: {
          flow: activeFlow ?? 'general',
          servedBy: finalMeta.servedBy,
          model: finalMeta.model,
          hops: finalMeta.hops,
          memorySaved: finalMeta.memory.saved,
        },
      });
      if (customer.consent_memory) {
        await extractMemories({
          customerId: customer.id,
          conversationId: conversation.id,
          userText: lastUser.content,
          assistantText,
          sessionId: sessionId ?? conversation.id,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[aniyab/chat] post-response task failed', (err as Error).message);
    }
  })();
  waitUntil(backgroundTask);

  const greetingHeader = brief.greetingFa ? encodeURIComponent(brief.greetingFa).slice(0, 300) : '';

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Aniyab-Served-By': 'agent',
      'X-Aniyab-Conversation': conversation.id,
      'X-Aniyab-Customer': customer.id,
      'X-Aniyab-Visit': String(customer.visit_count),
      ...(greetingHeader ? { 'X-Aniyab-Greeting': greetingHeader } : {}),
    },
  });
}

