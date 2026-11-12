import 'server-only';

import { BRAND } from '@/content/brand';
import { buildSystemPrompt, EXTRA_PROMPTS, TOOL_PROGRESS_FA } from '@/lib/agent/prompts';
import { parseUpstreamDelta, type AgentFrame, type MetaFrame } from '@/lib/agent/protocol';
import { executeTool, openAiToolSpecs, type ToolContext, type ToolResult } from '@/lib/agent/tools';
import { routeIntent } from '@/lib/agent/router';
import { scriptedAfterTool, scriptedChitChat } from '@/lib/agent/scripted';
import { applyLayaHints, layaPreflight, type LayaTrace } from '@/lib/laya';
import { MODEL_UNAVAILABLE_STATUSES, nvidiaModelChain, resolveProvider, slimPayload } from '@/lib/llm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/orchestrator.ts — provider-agnostic agent loop
 * ─────────────────────────────────────────────────────────────────────────────
 *  Flow per turn:
 *    1. deterministic router  → may pre-execute one tool (reliable path)
 *    2. Laya preflight        → policy/session hints (optional, non-fatal)
 *    3. model call with tools → native tool_calls if supported, else the JSON
 *                               action envelope, else plain narration
 *    4. loop (≤ MAX_HOPS)     → tool results appended as `role: "tool"`
 *    5. stream text + typed frames to the browser
 *
 *  Determinism is a feature: for a CEO demo the router guarantees that a
 *  validated IMEI always produces a ticket, whatever the model decides.
 */

const MAX_HOPS = 4;
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 45_000);

export interface AgentTurnInput {
  flow: string;
  sessionId: string;
  customerId: string;
  conversationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userText: string;
  customerBrief: string;
  /** Ask the model for the JSON action envelope instead of native tools. */
  envelopeMode: boolean;
  /** Return X-Ray trace data in the meta frame. */
  xray: boolean;
  /** `?scripted=1` — canned narration, deterministic tools still run for real. */
  scripted?: boolean;
}

export interface AgentTurnCompletion {
  meta: MetaFrame;
  /** The exact text the user saw (used by the memory extractor). */
  text: string;
}

export interface AgentTurnResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves once the turn is finished — text + meta, for persistence. */
  completion: Promise<AgentTurnCompletion>;
}

interface TraceStep {
  step: string;
  labelFa: string;
  ms: number;
  detail?: string;
}

const ACTION_ENVELOPE_INSTRUCTION = `
## حالت اقدام ساختاریافته
به‌جای متن آزاد، فقط و فقط یک JSON برگردان با این ساختار:
{"action":{"tool":"<نام ابزار یا null>","args":{...}},"reply_fa":"<پاسخ کوتاه فارسی>","remember":[{"kind":"fact|preference|item|event|concern","key":"...","value":"..."}]}
اگر ابزاری لازم نیست، action را null بگذار. هیچ متنی بیرون از JSON ننویس.
`.trim();

export function createAgentTurn(input: AgentTurnInput): AgentTurnResult {
  const encoder = new TextEncoder();
  const trace: TraceStep[] = [];
  let resolveDone: (c: AgentTurnCompletion) => void = () => {};
  const completion = new Promise<AgentTurnCompletion>((resolve) => {
    resolveDone = resolve;
  });
  /** Text the user actually saw, accumulated for the memory extractor. */
  let visibleText = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const push = (frame: AgentFrame) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          /* client already gone */
        }
      };
      /**
       * One token frame per delta. We deliberately do NOT also emit an
       * OpenAI `choices[].delta` frame: a client that understands both would
       * render every chunk twice. The client's parser handles both shapes, so
       * a `token` frame alone keeps new and legacy clients compatible.
       */
      const pushToken = (text: string) => {
        if (!text) return;
        visibleText += text;
        push({ type: 'token', text });
      };

      const toolCtx: ToolContext = {
        customerId: input.customerId,
        conversationId: input.conversationId,
        flow: input.flow,
      };

      let hops = 0;
      let servedBy = 'nvidia';
      let modelName = '';
      let layaTrace: LayaTrace = {
        mode: 'off',
        configured: false,
        status: 'off',
        latencyMs: 0,
        endpoint: null,
        hintKeys: [],
      };
      let savedMemories = 0;

      try {
        /* ── 1. deterministic router ─────────────────────────────────────── */
        const routed = routeIntent(input.userText);
        const preToolResults: Array<{ name: string; result: ToolResult }> = [];

        if (routed.kind === 'tool' && routed.tool !== '__bind_phone') {
          push({ type: 'tool', name: routed.tool, labelFa: TOOL_PROGRESS_FA[routed.tool] ?? 'در حال انجام…', status: 'start' });
          const t0 = Date.now();
          const result = await executeTool(routed.tool, routed.args, toolCtx);
          trace.push({
            step: `tool:${routed.tool}`,
            labelFa: `ابزار ${routed.tool}`,
            ms: Date.now() - t0,
            detail: routed.reasonFa,
          });
          push({
            type: 'tool',
            name: routed.tool,
            labelFa: TOOL_PROGRESS_FA[routed.tool] ?? routed.tool,
            status: result.ok ? 'ok' : 'error',
            summaryFa: result.summaryFa,
          });
          for (const ui of result.ui ?? []) push({ type: 'ui', card: ui.card, props: ui.props });
          if (result.memory?.length) savedMemories += result.memory.length;
          preToolResults.push({ name: routed.tool, result });
        } else if (routed.kind === 'memory-clear') {
          const result = await executeTool('forget_customer', {}, toolCtx);
          push({ type: 'memory', status: 'cleared', summaryFa: result.summaryFa });
          pushToken('همه‌چیز درباره شما پاک شد. از اینجا یک شروع تازه داریم 🌱');
          push({ type: 'done' } as unknown as AgentFrame);
          controller.close();
          resolveDone({
            meta: {
              type: 'meta',
              servedBy: 'router',
              model: 'deterministic',
              latencyMs: Date.now() - startedAt,
              hops: 0,
              laya: { mode: layaTrace.mode, status: layaTrace.status, latencyMs: 0, hintKeys: [] },
              memory: { recalled: 0, saved: 0 },
            },
            text: visibleText,
          });
          return;
        }

        /* ── 1b. scripted mode: real tools, canned narration ─────────────── */
        if (input.scripted) {
          // No model means no chance for the model to pick recommend_product, so
          // the consultation pillar needs a deterministic path here. This stays
          // out of the router on purpose: with a live model we want discovery
          // questions first, not an instant recommendation.
          if (preToolResults.length === 0 && /(برچسب|آنی\s*پارک|آنی\s*پرو|پیشنهاد|کدام|مناسب)/.test(input.userText)) {
            const objectType = /لپ\s*تاپ/.test(input.userText)
              ? 'کیف لپ‌تاپ'
              : /خودرو|ماشین|پارک/.test(input.userText)
                ? 'خودرو'
                : /کیف|کوله|چمدان/.test(input.userText)
                  ? 'کیف'
                  : /گوشی/.test(input.userText)
                    ? 'گوشی موبایل'
                    : 'شیء همراه';
            const isVehicle = /خودرو|ماشین|پارک/.test(input.userText);
            push({
              type: 'tool',
              name: 'recommend_product',
              labelFa: TOOL_PROGRESS_FA.recommend_product ?? 'در حال انتخاب محصول مناسب…',
              status: 'start',
            });
            const t0 = Date.now();
            const result = await executeTool(
              'recommend_product',
              {
                objectType,
                recommendedProduct: isVehicle ? 'ani-park' : 'ani-pro',
                reasonFa: isVehicle
                  ? 'چون برای خودرو و پارکینگ طراحی شده و چسب آن به شیشه مقاوم است.'
                  : `چون ${objectType} هر روز با شما بیرون می‌رود و آنی پرو QR اختصاصی با صفحهٔ گزارش گم‌شدن دارد.`,
                stage: 'recommended',
              },
              toolCtx,
            );
            trace.push({ step: 'tool:recommend_product', labelFa: 'ابزار recommend_product', ms: Date.now() - t0 });
            push({
              type: 'tool',
              name: 'recommend_product',
              labelFa: TOOL_PROGRESS_FA.recommend_product ?? 'recommend_product',
              status: result.ok ? 'ok' : 'error',
              summaryFa: result.summaryFa,
            });
            for (const ui of result.ui ?? []) push({ type: 'ui', card: ui.card, props: ui.props });
            preToolResults.push({ name: 'recommend_product', result });
            await new Promise((r) => setTimeout(r, 120));
          }

          const narration = preToolResults.length
            ? scriptedAfterTool(preToolResults.map((p) => p.result))
            : scriptedChitChat(input.userText, input.flow);

          trace.push({
            step: 'scripted',
            labelFa: 'حالت نمایشی (بدون مدل)',
            ms: 0,
            detail: `${preToolResults.length} ابزار`,
          });

          // Stream it in small chunks so the UI feels alive, not pasted.
          for (const chunk of narration.match(/[\s\S]{1,12}/g) ?? []) {
            pushToken(chunk);
            await new Promise((r) => setTimeout(r, 16));
          }

          push({
            type: 'meta',
            servedBy: 'scripted',
            model: 'scripted',
            latencyMs: Date.now() - startedAt,
            hops: preToolResults.length ? 1 : 0,
            laya: { mode: layaTrace.mode, status: 'skipped', latencyMs: 0, hintKeys: [] },
            memory: { recalled: 0, saved: savedMemories },
            ...(input.xray ? { trace } : {}),
          });
          push({ type: 'done' } as unknown as AgentFrame);
          controller.close();
          resolveDone({
            meta: {
              type: 'meta',
              servedBy: 'scripted',
              model: 'scripted',
              latencyMs: Date.now() - startedAt,
              hops: preToolResults.length ? 1 : 0,
              laya: { mode: layaTrace.mode, status: 'skipped', latencyMs: 0, hintKeys: [] },
              memory: { recalled: 0, saved: savedMemories },
            },
            text: narration,
          });
          return;
        }

        /* ── 2. Laya preflight ───────────────────────────────────────────── */
        const layaStart = Date.now();
        const { hints, trace: lt } = await layaPreflight({
          sessionId: input.sessionId,
          flow: input.flow,
          messages: input.history.map((h) => ({ role: h.role, content: h.content })),
          customerBrief: input.customerBrief,
        });
        layaTrace = lt;
        trace.push({
          step: 'laya:preflight',
          labelFa: `Laya SystemOne (${lt.mode})`,
          ms: Date.now() - layaStart,
          detail: lt.status,
        });

        /* ── 3. build the prompt ─────────────────────────────────────────── */
        const extras: string[] = [];
        if (/کد ملی|استعلام/.test(input.userText)) extras.push(EXTRA_PROMPTS.lookup);
        if (/روزنامه|آگهی|پست یافته/.test(input.userText)) extras.push(EXTRA_PROMPTS.postNewspaper);

        let systemPrompt = buildSystemPrompt({
          flow: input.flow,
          customerBrief: input.customerBrief,
          extras,
        });
        systemPrompt = applyLayaHints(systemPrompt, hints, '');
        if (input.envelopeMode) systemPrompt += `\n\n${ACTION_ENVELOPE_INSTRUCTION}`;

        /* ── 4. resolve provider ─────────────────────────────────────────── */
        const resolved = resolveProvider({ requested: null, sessionId: input.sessionId, flow: input.flow as never });
        if (!resolved.ok) {
          push({
            type: 'error',
            code: 'NOT_CONFIGURED',
            message: `سرویس هوشمند در دسترس نیست. لطفاً با پشتیبانی ${BRAND.hotlineFa} تماس بگیرید.`,
            hint: 'ENV_MISSING',
          });
          controller.close();
          resolveDone({ meta: emptyMeta(startedAt, layaTrace), text: visibleText });
          return;
        }

        const plan = resolved.plan;
        servedBy = plan.id === 'nvidia' ? 'nvidia' : 'laya';
        const chain = plan.id === 'nvidia' ? nvidiaModelChain(process.env.NVIDIA_MODEL) : [String(plan.bodyExtras.model)];
        let model = chain[0] ?? '';
        modelName = model;

        /* Pre-executed tool results are injected as a tool message so the model
           narrates what really happened instead of inventing a result. */
        const messages: Array<Record<string, unknown>> = [
          { role: 'system', content: systemPrompt },
          ...input.history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: input.userText },
        ];

        for (const pre of preToolResults) {
          messages.push({
            role: 'system',
            content:
              `[نتیجه ابزار ${pre.name} — این نتیجه واقعی است، همان را برای کاربر توضیح بده و از خودت چیزی نساز]\n` +
              JSON.stringify({ ok: pre.result.ok, summaryFa: pre.result.summaryFa, data: pre.result.data }).slice(0, 1200),
          });
        }

        /* ── 5. model loop ───────────────────────────────────────────────── */
        let finalText = '';
        let modelResponded = false;

        for (let hop = 0; hop < MAX_HOPS; hop += 1) {
          hops = hop + 1;

          const body: Record<string, unknown> = {
            ...plan.bodyExtras,
            model,
            messages,
            stream: true,
            temperature: hints.temperature ?? 0.4,
            top_p: 0.9,
            max_tokens: hints.max_tokens ?? 900,
          };
          // Native tool calling only for gateways that accept the field. NVIDIA
          // NIM is strict, but `tools`/`tool_choice` are documented OpenAI keys,
          // so strictBody providers get them too — the mock and the probe verify.
          if (!input.envelopeMode) {
            body.tools = openAiToolSpecs();
            body.tool_choice = 'auto';
          }
          if (input.envelopeMode) {
            body.response_format = { type: 'json_object' };
          }

          const response = await callModel(plan.endpoint, plan.headers, body, model);

          if (!response.ok) {
            // Retired/unavailable model → walk the chain (same logic as v1).
            if ((MODEL_UNAVAILABLE_STATUSES as readonly number[]).includes(response.status) && chain.length > 1) {
              const next = chain.find((m) => m !== model);
              await response.text().catch(() => '');
              if (next) {
                trace.push({ step: 'model:retry', labelFa: 'تعویض مدل', ms: 0, detail: `${model} → ${next}` });
                model = next;
                modelName = next;
                hop -= 1; // this hop did not count
                continue;
              }
            }
            const detail = await response.text().catch(() => '');
            push({
              type: 'error',
              code: response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
              message:
                response.status === 429
                  ? `سهمیه سرویس هوش مصنوعی پر شده است. لطفاً کمی بعد تلاش کنید یا با ${BRAND.hotlineFa} تماس بگیرید.`
                  : `ارتباط با سرویس هوش مصنوعی برقرار نشد. لطفاً دوباره تلاش کنید.`,
              hint: 'RETRY',
            });
            // eslint-disable-next-line no-console
            console.error('[aniyab/agent] upstream error', response.status, detail.slice(0, 200));
            break;
          }

          const parsedStream = await consumeModelStream(response, {
            onToken: (t) => {
              // In envelope mode we must buffer silently until valid JSON arrives.
              if (!input.envelopeMode) pushToken(t);
            },
          });

          modelResponded = true;

          if (parsedStream.envelope) {
            /* JSON action envelope path */
            const env = parsedStream.envelope;
            if (env.reply_fa) {
              finalText = env.reply_fa;
              pushToken(env.reply_fa);
            }
            if (env.action?.tool) {
              const toolName = env.action.tool;
              push({ type: 'tool', name: toolName, labelFa: TOOL_PROGRESS_FA[toolName] ?? 'در حال انجام…', status: 'start' });
              const t0 = Date.now();
              const result = await executeTool(toolName, env.action.args ?? {}, toolCtx);
              trace.push({ step: `tool:${toolName}`, labelFa: `ابزار ${toolName}`, ms: Date.now() - t0 });
              push({
                type: 'tool',
                name: toolName,
                labelFa: TOOL_PROGRESS_FA[toolName] ?? toolName,
                status: result.ok ? 'ok' : 'error',
                summaryFa: result.summaryFa,
              });
              for (const ui of result.ui ?? []) push({ type: 'ui', card: ui.card, props: ui.props });
              if (!env.reply_fa) {
                finalText = result.summaryFa;
                pushToken(result.summaryFa);
              }
              /* persist any model-declared memories */
              for (const m of env.remember ?? []) {
                await executeTool('remember_customer_fact', m, toolCtx);
                savedMemories += 1;
              }
            }
            break;
          }

          if (parsedStream.toolCalls.length) {
            /* native tool-calling path */
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: parsedStream.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            });

            for (const tc of parsedStream.toolCalls) {
              // A pre-executed tool (deterministic router) must not run twice.
              const alreadyRan = preToolResults.find((p) => p.name === tc.name);
              if (alreadyRan) {
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({
                    tool: alreadyRan.name,
                    ok: alreadyRan.result.ok,
                    summaryFa: alreadyRan.result.summaryFa,
                    data: alreadyRan.result.data ?? null,
                    note: 'این ابزار در همین نوبت اجرا شد؛ نتیجه بالا معتبر است.',
                    cardsShown: (alreadyRan.result.ui ?? []).map((u) => u.card),
                  }),
                });
                continue;
              }
              push({ type: 'tool', name: tc.name, labelFa: TOOL_PROGRESS_FA[tc.name] ?? 'در حال انجام…', status: 'start' });
              let args: unknown = {};
              try {
                args = JSON.parse(tc.arguments || '{}');
              } catch {
                args = {};
              }
              const t0 = Date.now();
              const result = await executeTool(tc.name, args, toolCtx);
              trace.push({ step: `tool:${tc.name}`, labelFa: `ابزار ${tc.name}`, ms: Date.now() - t0 });
              push({
                type: 'tool',
                name: tc.name,
                labelFa: TOOL_PROGRESS_FA[tc.name] ?? tc.name,
                status: result.ok ? 'ok' : 'error',
                summaryFa: result.summaryFa,
              });
              for (const ui of result.ui ?? []) push({ type: 'ui', card: ui.card, props: ui.props });
              savedMemories += result.memory?.length ?? 0;

              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({
                  tool: tc.name,
                  ok: result.ok,
                  summaryFa: result.summaryFa,
                  data: result.data ?? null,
                  cardsShown: (result.ui ?? []).map((u) => u.card),
                }),
              });
            }
            continue; // let the model narrate the result
          }

          /* plain text path */
          finalText = parsedStream.text;
          break;
        }

        /* ── 6. fallback narration if the model produced nothing ─────────── */
        if (!finalText.trim()) {
          if (preToolResults.length) {
            finalText = preToolResults.map((p) => p.result.summaryFa).join('\n');
          } else if (modelResponded) {
            finalText = 'متوجه شدم. می‌توانید کمی بیشتر توضیح بدهید تا دقیق‌تر راهنمایی کنم؟';
          } else {
            finalText =
              `در حال حاضر ارتباط با سرویس هوش مصنوعی برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید ` +
              `یا با پشتیبانی ${BRAND.hotlineFa} تماس بگیرید.`;
            push({ type: 'error', code: 'UPSTREAM_UNAVAILABLE', message: finalText, hint: 'RETRY' });
          }
          pushToken(finalText);
        }

        const meta: MetaFrame = {
          type: 'meta',
          servedBy,
          model: modelName,
          latencyMs: Date.now() - startedAt,
          hops,
          laya: {
            mode: layaTrace.mode,
            status: layaTrace.status,
            latencyMs: layaTrace.latencyMs,
            hintKeys: layaTrace.hintKeys,
          },
          memory: { recalled: input.customerBrief ? 1 : 0, saved: savedMemories },
          ...(input.xray ? { trace } : {}),
        };
        push(meta);
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {
          /* closed */
        }
        resolveDone({ meta, text: visibleText });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[aniyab/agent] turn failed', (err as Error).message);
        try {
          push({
            type: 'error',
            code: 'AGENT_ERROR',
            message: `مشکلی پیش آمد. لطفاً دوباره تلاش کنید یا با ${BRAND.hotlineFa} تماس بگیرید.`,
            hint: 'RETRY',
          });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {
          /* closed */
        }
        resolveDone({ meta: emptyMeta(startedAt, layaTrace), text: visibleText });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return { stream, completion };
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function emptyMeta(startedAt: number, laya: LayaTrace): MetaFrame {
  return {
    type: 'meta',
    servedBy: 'nvidia',
    model: '',
    latencyMs: Date.now() - startedAt,
    hops: 0,
    laya: { mode: laya.mode, status: laya.status, latencyMs: laya.latencyMs, hintKeys: laya.hintKeys },
    memory: { recalled: 0, saved: 0 },
  };
}

async function callModel(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  model: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json;q=0.9',
        ...headers,
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(slimPayload({ ...body, model })),
      signal: controller.signal,
      cache: 'no-store' as RequestCache,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface ConsumedStream {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  envelope: {
    action?: { tool?: string; args?: Record<string, unknown> } | null;
    reply_fa?: string;
    remember?: Array<Record<string, unknown>>;
  } | null;
}

/** Consumes an SSE (or JSON) model response, invoking onToken for live text. */
async function consumeModelStream(
  response: Response,
  hooks: { onToken: (t: string) => void },
): Promise<ConsumedStream> {
  const contentType = response.headers.get('content-type') ?? '';
  let text = '';
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

  if (!contentType.includes('text/event-stream')) {
    const json = (await response.json().catch(() => null)) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
      }>;
    } | null;
    const msg = json?.choices?.[0]?.message;
    const content = msg?.content ?? '';
    if (content) {
      text = content;
      hooks.onToken(content);
    }
    for (const [i, tc] of (msg?.tool_calls ?? []).entries()) {
      toolAcc.set(i, {
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '{}',
      });
    }
    return { text, toolCalls: [...toolAcc.values()], envelope: parseEnvelope(text) };
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parseUpstreamDelta(parsed);
          if (!delta) continue;

          if (delta.text) {
            text += delta.text;
            hooks.onToken(delta.text);
          }
          for (const tc of delta.toolCalls) {
            const existing = toolAcc.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: '', arguments: '' };
            if (tc.name) existing.name = tc.name;
            if (tc.argumentsChunk) existing.arguments += tc.argumentsChunk;
            if (tc.id) existing.id = tc.id;
            toolAcc.set(tc.index, existing);
          }
        } catch {
          /* malformed frame */
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  return {
    text,
    toolCalls: [...toolAcc.values()].filter((t) => t.name),
    envelope: parseEnvelope(text),
  };
}

/** Extracts the JSON action envelope if the model produced one. */
function parseEnvelope(text: string): ConsumedStream['envelope'] {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidate = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as {
      action?: { tool?: string; args?: Record<string, unknown> } | null;
      reply_fa?: string;
      remember?: Array<Record<string, unknown>>;
    };
    if (!('action' in parsed) && !('reply_fa' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
