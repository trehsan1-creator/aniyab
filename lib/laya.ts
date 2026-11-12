import 'server-only';

import { readSystemOneHints, systemOneConfig, type SystemOneHints } from '@/lib/llm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/laya.ts — EVERY Laya.Studio / SystemOne touchpoint lives here
 * ─────────────────────────────────────────────────────────────────────────────
 *  Why one file: the team believes Laya is the strongest part of the stack, so
 *  we want the surface area to be obvious and extendable. Anything we call on
 *  Laya is declared here with its failure mode. See docs/LAYA_INTEGRATION.md.
 *
 *  Wired today (all optional, all non-fatal):
 *   1. preflight  → POST {endpoint} with session/flow/messages ⇒ hints
 *                   (system_prompt, model, temperature, max_tokens, metadata)
 *   2. orchestrate → the same endpoint becomes the *model* endpoint
 *   3. policy     → hints are merged into the prompt, never allowed to loosen
 *                   SAFETY_RULES_FA
 *
 *  NOT assumed (ask the Laya team): tool-call passthrough, streaming tool
 *  deltas, vector memory, cost/usage reporting. We degrade gracefully without
 *  them.
 */

export type SystemOneMode = 'off' | 'preflight' | 'orchestrate';

export interface LayaTrace {
  mode: SystemOneMode;
  configured: boolean;
  /** 'ok' | 'skipped' | 'failed' | 'off' */
  status: 'ok' | 'skipped' | 'failed' | 'off';
  latencyMs: number;
  endpoint: string | null;
  /** Which hint fields actually arrived — useful in X-Ray mode. */
  hintKeys: string[];
  error?: string;
}

export function layaConfig() {
  const cfg = systemOneConfig();
  // Prefer orchestrate when a real endpoint exists: the team wants Laya visible.
  const mode: SystemOneMode = cfg.enabled
    ? cfg.mode === 'off'
      ? (process.env.LAYA_DEFAULT_ORCHESTRATE === '0' ? 'off' : 'orchestrate')
      : cfg.mode
    : 'off';
  return { ...cfg, mode };
}

export interface LayaPreflightInput {
  sessionId: string;
  flow: string;
  messages: Array<{ role: 'string' | string; content: string }>;
  customerBrief?: string;
}

export interface LayaPreflightOutput {
  hints: SystemOneHints;
  trace: LayaTrace;
}

const TIMEOUT_MS = Number(process.env.LAYA_SYSTEMONE_TIMEOUT_MS ?? 6_000);

/**
 * Asks Laya for policy/session hints. NEVER throws: a dead Laya must not take
 * the conversation down, it just means "no extra hints".
 */
export async function layaPreflight(input: LayaPreflightInput): Promise<LayaPreflightOutput> {
  const cfg = layaConfig();
  const base: LayaTrace = {
    mode: cfg.mode,
    configured: cfg.enabled,
    status: 'off',
    latencyMs: 0,
    endpoint: cfg.endpoint,
    hintKeys: [],
  };

  if (!cfg.enabled || !cfg.endpoint || cfg.mode === 'off') {
    return { hints: {}, trace: { ...base, status: cfg.enabled ? 'skipped' : 'off' } };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'X-Laya-Gateway': 'systemone',
        'X-Aniyab-Flow': input.flow,
        'X-Aniyab-Session': input.sessionId,
      },
      body: JSON.stringify({
        session_id: input.sessionId,
        flow: input.flow,
        locale: 'fa-IR',
        channel: 'aniyab-web',
        ...(input.customerBrief ? { context: input.customerBrief.slice(0, 1500) } : {}),
        messages: input.messages.slice(-12),
      }),
      signal: controller.signal,
      cache: 'no-store' as RequestCache,
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        hints: {},
        trace: { ...base, status: 'failed', latencyMs, error: `http_${res.status}` },
      };
    }

    const payload: unknown = await res.json().catch(() => null);
    const hints = readSystemOneHints(payload);
    return {
      hints,
      trace: {
        ...base,
        status: 'ok',
        latencyMs,
        hintKeys: Object.keys(hints).filter((k) => hints[k as keyof SystemOneHints] !== undefined),
      },
    };
  } catch (err) {
    return {
      hints: {},
      trace: {
        ...base,
        status: 'failed',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merges Laya hints into a system prompt without ever weakening our guardrails.
 * Safety rules always come last.
 */
export function applyLayaHints(basePrompt: string, hints: SystemOneHints, safetyRules: string): string {
  const parts = [basePrompt];
  if (hints.system_prompt?.trim()) {
    parts.push(`\n[دستور تکمیلی Laya SystemOne]\n${hints.system_prompt.trim()}`);
  }
  parts.push(`\n${safetyRules}`);
  return parts.join('\n');
}
