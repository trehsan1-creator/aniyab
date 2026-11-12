/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/protocol.ts — the typed SSE contract between server and client
 * ─────────────────────────────────────────────────────────────────────────────
 *  Backward compatible with the old client: `token` frames are ALSO emitted as
 *  OpenAI-style `data: {"choices":[{"delta":{"content":"…"}}]}` and the stream
 *  still ends with `data: [DONE]`.
 *
 *  Typed frames (one JSON object per `data:` line, discriminated by `type`):
 *    token   { text }
 *    tool    { name, labelFa, status: 'start'|'ok'|'error' }
 *    ui      { card, props }
 *    memory  { status: 'saved'|'recalled'|'cleared', summaryFa, text? }
 *    meta    { servedBy, model, latencyMs, hops, laya }
 *    error   { code, message, hint? }
 *    done    { ...meta }
 */

export interface TokenFrame {
  type: 'token';
  text: string;
}

export interface ToolFrame {
  type: 'tool';
  name: string;
  labelFa: string;
  status: 'start' | 'ok' | 'error';
  summaryFa?: string;
}

export interface UiFrame {
  type: 'ui';
  card: string;
  props: Record<string, unknown>;
}

export interface MemoryFrame {
  type: 'memory';
  status: 'saved' | 'recalled' | 'cleared';
  summaryFa: string;
  text?: string;
}

export interface MetaFrame {
  type: 'meta';
  servedBy: string;
  model: string;
  latencyMs: number;
  hops: number;
  laya: {
    mode: string;
    status: string;
    latencyMs: number;
    hintKeys: string[];
  };
  memory: { recalled: number; saved: number };
  /** X-Ray traces, only populated when the client asked for them. */
  trace?: Array<{ step: string; labelFa: string; ms: number; detail?: string }>;
}

export interface ErrorFrame {
  type: 'error';
  code: string;
  message: string;
  hint?: string;
}

export type AgentFrame = TokenFrame | ToolFrame | UiFrame | MemoryFrame | MetaFrame | ErrorFrame;

/** Serialises a typed frame as an SSE `data:` line. */
export function sseFrame(frame: AgentFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/** Legacy-compatible OpenAI content delta (keeps old clients + mocks happy). */
export function tokenFrameCompat(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text } }],
  })}\n\n`;
}

export const DONE_FRAME = 'data: [DONE]\n\n';

/**
 * Parses an upstream OpenAI SSE `data:` payload into either text or tool-call
 * fragments. Returns null for frames we do not care about.
 */
export interface UpstreamDelta {
  text: string;
  toolCalls: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsChunk?: string;
  }>;
  finishReason: string | null;
}

export function parseUpstreamDelta(payload: unknown): UpstreamDelta | null {
  if (!payload || typeof payload !== 'object') return null;
  const choice = (payload as { choices?: Array<Record<string, unknown>> }).choices?.[0];
  if (!choice) return null;

  const delta = (choice.delta ?? choice.message ?? {}) as {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };

  const text = delta.content ?? '';
  const toolCalls = (delta.tool_calls ?? []).map((tc, i) => ({
    index: tc.index ?? i,
    id: tc.id,
    name: tc.function?.name,
    argumentsChunk: tc.function?.arguments,
  }));

  return {
    text,
    toolCalls,
    finishReason: (choice.finish_reason as string | null) ?? null,
  };
}
