'use client';

import { useCallback, useRef, useState } from 'react';

import type { AgentFrame } from '@/lib/agent/protocol';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/client/use-agent-stream.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *  Consumes the typed SSE contract, batching text with requestAnimationFrame so
 *  a fast stream never re-renders per character.
 */

export interface UiCardState {
  id: string;
  card: string;
  props: Record<string, unknown>;
}

export interface ToolState {
  id: string;
  name: string;
  labelFa: string;
  status: 'start' | 'ok' | 'error';
  summaryFa?: string;
}

export interface MetaState {
  servedBy: string;
  model: string;
  latencyMs: number;
  hops: number;
  laya: {
    mode: string;
    status: string;
    latencyMs: number;
    answered: string[];
    model?: string | null;
    router?: {
      tool: string | null;
      probability: number;
      confidence: number;
      confident: boolean;
      needsTools: number | null;
      conflicting?: boolean;
      source: 'laya' | 'fallback' | 'model';
    } | null;
    tier?: string | null;
    error?: string;
    errorStatus?: number;
    creditsCharged?: number;
  };
  memory: { recalled: number; saved: number };
  trace?: Array<{ step: string; labelFa: string; ms: number; detail?: string }>;
}

export interface SendOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeFlow: string;
  deviceId?: string;
  conversationId?: string;
  xray?: boolean;
  /** `?scripted=1` — canned answers, used when the network/model is unavailable. */
  scripted?: boolean;
}

export interface UseAgentStreamResult {
  text: string;
  cards: UiCardState[];
  tools: ToolState[];
  meta: MetaState | null;
  memoryToasts: string[];
  error: string | null;
  streaming: boolean;
  send: (opts: SendOptions) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

let cardSeq = 0;

export function useAgentStream(): UseAgentStreamResult {
  const [text, setText] = useState('');
  const [cards, setCards] = useState<UiCardState[]>([]);
  const [tools, setTools] = useState<ToolState[]>([]);
  const [meta, setMeta] = useState<MetaState | null>(null);
  const [memoryToasts, setMemoryToasts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const chunk = bufferRef.current;
      if (!chunk) return;
      bufferRef.current = '';
      setText((prev) => prev + chunk);
    });
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
    setText('');
    setCards([]);
    setTools([]);
    setMeta(null);
    setMemoryToasts([]);
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const send = useCallback(
    async (opts: SendOptions) => {
      reset();
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            messages: opts.messages,
            activeFlow: opts.activeFlow,
            deviceId: opts.deviceId,
            conversationId: opts.conversationId,
            xray: opts.xray ?? false,
            scripted: opts.scripted ?? false,
          }),
          signal: controller.signal,
        });

        if (!response.ok && !response.body) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setError(body?.error?.message ?? 'ارتباط با سرور برقرار نشد.');
          setStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError('پاسخ سرور قابل خواندن نبود.');
          setStreaming(false);
          return;
        }

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

              let parsed: unknown;
              try {
                parsed = JSON.parse(payload);
              } catch {
                continue;
              }

              const asFrame = parsed as AgentFrame & {
                choices?: Array<{ delta?: { content?: string | null } }>;
              };
              const legacyDelta = (parsed as { choices?: Array<{ delta?: { content?: string | null } }> })
                .choices?.[0]?.delta?.content;

              if (asFrame.type === 'token') {
                bufferRef.current += asFrame.text;
                flush();
              } else if (asFrame.type === 'tool') {
                setTools((prev) => {
                  const next = [...prev];
                  const existing = next.findIndex(
                    (t) => t.name === asFrame.name && t.status === 'start',
                  );
                  const record: ToolState = {
                    id: `${asFrame.name}-${next.length}`,
                    name: asFrame.name,
                    labelFa: asFrame.labelFa,
                    status: asFrame.status,
                    summaryFa: asFrame.summaryFa,
                  };
                  if (asFrame.status === 'start') {
                    next.push(record);
                  } else if (existing >= 0 && next[existing]) {
                    next[existing] = {
                      ...next[existing],
                      status: asFrame.status,
                      summaryFa: asFrame.summaryFa,
                    };
                  } else {
                    next.push(record);
                  }
                  return next;
                });
              } else if (asFrame.type === 'ui') {
                cardSeq += 1;
                setCards((prev) => [
                  ...prev,
                  { id: `card-${cardSeq}`, card: asFrame.card, props: asFrame.props },
                ]);
              } else if (asFrame.type === 'memory') {
                setMemoryToasts((prev) => [...prev, asFrame.summaryFa]);
              } else if (asFrame.type === 'meta') {
                setMeta(asFrame);
              } else if (asFrame.type === 'error') {
                setError(asFrame.message);
              } else if (legacyDelta) {
                // Legacy frame shape (old servers / mocks).
                bufferRef.current += legacyDelta;
                flush();
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('ارتباط قطع شد. لطفاً دوباره تلاش کنید.');
      } finally {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (bufferRef.current) {
          const rest = bufferRef.current;
          bufferRef.current = '';
          setText((prev) => prev + rest);
        }
        setStreaming(false);
      }
    },
    [flush, reset],
  );

  return { text, cards, tools, meta, memoryToasts, error, streaming, send, stop, reset };
}
