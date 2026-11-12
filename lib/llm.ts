/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/llm.ts
 *  Model providers — NVIDIA NIM (primary) with optional Laya proxy override
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The chat route only needs three things from a provider:
 *    · where to POST,
 *    · which headers to send,
 *    · how to shape the body.
 *
 *  Providers are pure data (no I/O), so the route keeps full control of
 *  timeouts, aborts, streaming and error mapping.
 *
 *  ┌─────────────────────────────┬────────────────────────────────────────────┐
 *  │ NVIDIA NIM (default)        │ Laya.Studio /v1/chat/completions           │
 *  │ integrate.api.nvidia.com    │ api.laya.studio                            │
 *  │ nvapi-… key                 │ LAYA_API_KEY                               │
 *  └─────────────────────────────┴────────────────────────────────────────────┘
 */

export type ProviderId = 'nvidia' | 'laya';

export interface ProviderPlan {
  id: ProviderId;
  /** Fully-qualified URL the route should POST to. */
  endpoint: string;
  /** Headers to merge into the upstream request (auth + routing hints). */
  headers: Record<string, string>;
  /** Extra top-level fields merged into the chat-completions body. */
  bodyExtras: Record<string, unknown>;
  /** Human-readable label for /api/chat health output. */
  label: string;
  /**
   * NVIDIA NIM validates top-level body keys strictly and answers
   * `400 Validation: Unsupported parameter(s)` for anything it does not know
   * (e.g. `metadata`, `client_metadata`, `stream_options` on some routes).
   * When this is true the route strips every non-OpenAI field before sending.
   */
  strictBody: boolean;
}

/**
 * The exact set of top-level keys the OpenAI chat-completions schema defines.
 * Anything else is dropped for strict providers (NVIDIA NIM).
 */
export const OPENAI_CHAT_FIELDS = [
  'model',
  'messages',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'n',
  'stop',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'user',
  'seed',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
] as const;

/** NVIDIA's hosted NIM gateway (OpenAI-compatible). */
export const NVIDIA_DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Live NVIDIA NIM models, in preference order.
 *
 * `meta/llama-3.1-8b-instruct` — the original default — reached end of life on
 * 2026-08-26 and NVIDIA now answers `410 Gone` for it, which surfaced in the UI
 * as an unexpected error. The route walks this chain, skipping any model that
 * reports 404/410, so a retired model can never take the assistant down again.
 */
export const NVIDIA_MODEL_CHAIN = [
  // Verified live on this account: real `content`, no reasoning detour, ~300ms.
  'nvidia/nemotron-3.5-bolt-e4b',
  // Reasoning models — usable, but they spend the budget on `reasoning_content`.
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
] as const;

/** Models the operator may still name explicitly via `NVIDIA_MODEL`. */
export const NVIDIA_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

/** Models NVIDIA has retired; never spend a request on them. */
export const NVIDIA_RETIRED_MODELS = ['meta/llama-3.1-8b-instruct'] as const;

/**
 * Builds the ordered list of models to try: the operator's choice first (when
 * it is not retired), then the live chain, de-duplicated.
 */
export function nvidiaModelChain(configured?: string | null): string[] {
  const out: string[] = [];
  const push = (m?: string | null) => {
    const v = m?.trim();
    if (v && !out.includes(v) && !(NVIDIA_RETIRED_MODELS as readonly string[]).includes(v)) {
      out.push(v);
    }
  };
  push(configured);
  for (const m of NVIDIA_MODEL_CHAIN) push(m);
  return out;
}

/** Status codes NVIDIA uses for "this model id is not usable". */
export const MODEL_UNAVAILABLE_STATUSES = [404, 410] as const;

export interface ResolveProviderInput {
  /** Per-request override coming from the browser (`provider` in the body). */
  requested?: string | null;
  /** Session id, forwarded for tracing on both providers. */
  sessionId: string;
  /** Active business flow, forwarded as a routing hint. */
  flow: string;
}

export type ResolveProviderResult =
  | { ok: true; plan: ProviderPlan }
  | { ok: false; reason: string };

/** True when NVIDIA credentials are present. */
export function hasNvidiaKey(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY?.trim());
}

/** True when the optional Laya inference proxy is configured. */
export function hasLayaInference(): boolean {
  return Boolean(process.env.LAYA_API_ENDPOINT?.trim() && process.env.LAYA_API_KEY?.trim());
}

/**
 * Which provider will serve a request if nothing is overridden.
 * `LLM_PROVIDER=nvidia|auto` (default) → NVIDIA. `LLM_PROVIDER=laya` → Laya.
 */
export function defaultProvider(): ProviderId {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'laya') return 'laya';
  return 'nvidia';
}

export function resolveProvider(input: ResolveProviderInput): ResolveProviderResult {
  const wanted =
    (input.requested === 'nvidia' || input.requested === 'laya' ? input.requested : null) ??
    defaultProvider();

  if (wanted === 'nvidia') {
    const key = process.env.NVIDIA_API_KEY?.trim();
    if (!key) {
      return {
        ok: false,
        reason:
          'NVIDIA_API_KEY is not set. Add an nvapi-… key from build.nvidia.com, or switch LLM_PROVIDER to laya.',
      };
    }

    const endpoint = process.env.NVIDIA_API_ENDPOINT?.trim() || NVIDIA_DEFAULT_ENDPOINT;
    const model = nvidiaModelChain(process.env.NVIDIA_MODEL)[0];

    return {
      ok: true,
      plan: {
        id: 'nvidia',
        label: `NVIDIA NIM · ${model}`,
        endpoint,
        headers: {
          Authorization: `Bearer ${key}`,
          // Recommended by NVIDIA for hosted NIM traffic.
          Accept: 'text/event-stream, application/json;q=0.9',
          'X-Aniyab-Flow': input.flow,
          'X-Aniyab-Session': input.sessionId,
        },
        // Deliberately minimal: NIM rejects keys it does not recognise, so no
        // `metadata`, no `stream_options` — only the documented chat fields.
        bodyExtras: { model },
        strictBody: true,
      },
    };
  }

  const endpoint = process.env.LAYA_API_ENDPOINT?.trim();
  const key = process.env.LAYA_API_KEY?.trim();
  if (!endpoint || !key) {
    return {
      ok: false,
      reason: 'LAYA_API_ENDPOINT / LAYA_API_KEY are not set.',
    };
  }

  const model = process.env.LAYA_MODEL?.trim() || 'meta/llama-3.1-8b-instruct';

  return {
    ok: true,
    plan: {
      id: 'laya',
      label: `Laya.Studio · ${model}`,
      endpoint,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'text/event-stream, application/json;q=0.9',
        'X-Laya-Gateway': 'systemone',
        'X-Aniyab-Flow': input.flow,
        'X-Aniyab-Session': input.sessionId,
      },
      bodyExtras: { model },
      // Laya/OpenAI-style gateways tolerate extra routing metadata.
      strictBody: !endpoint.includes('nvidia'),
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   Laya SystemOne — orchestration layer
   ════════════════════════════════════════════════════════════════════════════

   SystemOne is *not* the inference endpoint: it owns session/flow orchestration,
   compliance and routing, and can call the model on our behalf.

   Two supported topologies:

   A) SystemOne orchestrates the model itself (recommended)
      LAYA_SYSTEMONE_ENDPOINT = https://api.laya.studio/v1/systemone
      Route → SystemOne (streams or returns JSON). NVIDIA is only used as a
      fallback when SystemOne is unreachable and NVIDIA_API_KEY exists.

   B) SystemOne issues a ticket/session and we call NVIDIA ourselves
      LAYA_SYSTEMONE_ENDPOINT + LAYA_SYSTEMONE_MODE=preflight
      Route → SystemOne (JSON preflight) → merge hints → NVIDIA chat/completions.
      This keeps inference latency low and lets SystemOne apply policy.
*/

export type SystemOneMode = 'off' | 'orchestrate' | 'preflight';

export interface SystemOneConfig {
  enabled: boolean;
  endpoint: string | null;
  mode: SystemOneMode;
  apiKey: string | null;
}

export function systemOneConfig(): SystemOneConfig {
  const endpoint = process.env.LAYA_SYSTEMONE_ENDPOINT?.trim() || null;
  const apiKey = process.env.LAYA_API_KEY?.trim() || null;

  // Unknown/absent mode defaults to 'off' so a half-configured gateway can
  // never break the chat; 'orchestrate' is opt-in.
  const rawMode = process.env.LAYA_SYSTEMONE_MODE?.trim().toLowerCase();
  const mode: SystemOneMode =
    rawMode === 'orchestrate' || rawMode === 'preflight' ? rawMode : 'off';

  return {
    enabled: Boolean(endpoint && apiKey && mode !== 'off'),
    endpoint,
    mode,
    apiKey,
  };
}

/** Payload sent to SystemOne in `preflight` mode. */
export interface SystemOnePreflightBody {
  session_id: string;
  flow: string;
  locale: 'fa-IR';
  channel: 'aniyab-web';
  messages: Array<{ role: string; content: string }>;
}

/** Optional hints SystemOne may return; all are best-effort and namespaced. */
export interface SystemOneHints {
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Read hints from a SystemOne preflight response without trusting its shape.
 * Accepts `{ hints: {...} }`, `{ data: { hints|... } }` or a flat object.
 */
export function readSystemOneHints(payload: unknown): SystemOneHints {
  if (typeof payload !== 'object' || payload === null) return {};
  const root = payload as Record<string, unknown>;

  const nested =
    (typeof root.hints === 'object' && root.hints !== null ? (root.hints as Record<string, unknown>) : null) ??
    (typeof root.data === 'object' && root.data !== null ? (root.data as Record<string, unknown>) : null) ??
    root;

  const hints: SystemOneHints = {};

  if (typeof nested.system_prompt === 'string' && nested.system_prompt.trim()) {
    hints.system_prompt = nested.system_prompt.trim().slice(0, 12_000);
  }
  if (typeof nested.model === 'string' && nested.model.trim()) hints.model = nested.model.trim();
  if (typeof nested.temperature === 'number' && Number.isFinite(nested.temperature)) {
    hints.temperature = Math.min(1.5, Math.max(0, nested.temperature));
  }
  if (typeof nested.max_tokens === 'number' && Number.isFinite(nested.max_tokens)) {
    hints.max_tokens = Math.min(4_096, Math.max(64, Math.round(nested.max_tokens)));
  }
  if (typeof nested.metadata === 'object' && nested.metadata !== null) {
    hints.metadata = nested.metadata as Record<string, unknown>;
  }

  return hints;
}

/**
 * The absolute minimum chat-completions body: only fields every
 * OpenAI-compatible gateway (including strict NVIDIA NIM validation) accepts.
 */
export const SLIM_CHAT_FIELDS = [
  'model',
  'messages',
  'stream',
  'temperature',
  'top_p',
  'max_tokens',
] as const;

/**
 * Reduces a chat-completions payload to the documented fields only.
 * Used as the automatic retry body when a strict gateway answers
 * `400 Validation: Unsupported parameter(s)`.
 */
export function slimPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SLIM_CHAT_FIELDS) {
    const value = payload[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
