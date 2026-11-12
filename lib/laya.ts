/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/laya.ts — Laya.Studio decision API (SystemOne)
 * ─────────────────────────────────────────────────────────────────────────────
 *  What Laya actually is (read from https://laya.studio/docs/api, not guessed):
 *
 *    POST /v1/systemone   { state, questions }  →  { answers: {<id>: …}, usage }
 *
 *  It is a *decision* model, not a chat model. One non-autoregressive forward
 *  pass answers up to 32 typed questions about a single state and returns a
 *  calibrated probability per option. It cannot generate text, so it can never
 *  produce a malformed tool call — and it tells us when it is unsure.
 *
 *  The three question types:
 *    { type: 'choice',  criteria: { label: 'plain-words description', … } }
 *    { type: 'score',   criteria: ['level 1: …', 'level 2: …', …] }
 *    { type: 'noul',    instructions: 'yes/no question' }        → P(yes)
 *
 *  Constraints we must respect:
 *    • `model: 'multilingual'` for Persian — `english` and `typed-decisions`
 *      only read English. Omit `model` and Laya routes by script, which is fine
 *      too, but pinning is deterministic and that is what a demo needs.
 *    • 1024-token context ⇒ we send the latest user turn plus a short brief,
 *      never the whole conversation.
 *    • 32 questions / 512 KB body max. We ask five.
 *    • Errors are typed: 400 malformed, 401 bad key, 402 out of credits,
 *      422 invalid question, 429 rate limited, 503 unavailable.
 *
 *  Everything here is non-fatal by design: if Laya is down, `decide()` returns
 *  null and the caller falls back to the deterministic keyword router. A dead
 *  decision layer must never take the conversation down.
 */

export type LayaQuestionType = 'choice' | 'score' | 'noul';

export interface LayaChoiceQuestion {
  type: 'choice';
  instructions?: string;
  /**
   * Two accepted forms, both documented:
   *   • `string[]` — bare option ids, the cheapest in prompt budget;
   *   • `Record<id, description>` — ids plus a short gloss.
   * Options share a fixed budget (~256 tokens on multilingual), so keep the
   * list short: Laya's own guidance is to route hierarchically above ~20 tools.
   */
  criteria: Record<string, string> | string[];
}

export interface LayaScoreQuestion {
  type: 'score';
  instructions?: string;
  criteria: string[];
}

export interface LayaNoulQuestion {
  type: 'noul';
  instructions: string;
}

export type LayaQuestion = LayaChoiceQuestion | LayaScoreQuestion | LayaNoulQuestion;

export interface LayaAnswer {
  type: LayaQuestionType | string;
  /**
   * 1 − normalised entropy for choice/score, `max(p, 1-p)` for noul. This is
   * the field to gate on: the docs are explicit that a split between two
   * options shows up here as low confidence even when one leads, whereas
   * `action.act_probability` carries no usable signal (issue #185).
   */
  confidence?: number;
  /** choice answers */
  choice?: string;
  /** noul answers: P(yes) */
  noul?: number;
  /** score answers: a point on the scale + which level it lands in */
  score?: number;
  /** all answers */
  probabilities?: Record<string, number>;
}

export interface LayaDecision {
  answers: Record<string, LayaAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  /** Which checkpoint actually served the request. */
  model: string | null;
  /** From the x-credits-charged header. */
  creditsCharged: number | null;
  latencyMs: number;
  requestId: string | null;
}

export interface LayaTrace {
  mode: 'off' | 'live';
  configured: boolean;
  /** 'ok' | 'skipped' | 'failed' | 'off' */
  status: 'ok' | 'skipped' | 'failed' | 'off';
  latencyMs: number;
  endpoint: string | null;
  model: string | null;
  error?: string;
  errorStatus?: number;
  creditsCharged?: number;
  /** Question ids that came back answered. */
  answered: string[];
}

/* ── config ───────────────────────────────────────────────────────────────── */

export interface LayaConfig {
  enabled: boolean;
  endpoint: string | null;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

const DEFAULT_ENDPOINT = 'https://api.laya.studio/v1/systemone';

/**
 * Env naming: the running deployment uses LAYA_SYSTEMONE_*. The older
 * LAYA_API_ENDPOINT naming still works so we never break an existing setup.
 * Everything is inert unless BOTH the endpoint and the key exist.
 */
export function layaConfig(): LayaConfig {
  const endpoint =
    process.env.LAYA_SYSTEMONE_ENDPOINT?.trim() ||
    process.env.LAYA_API_ENDPOINT?.trim() ||
    null;
  const apiKey = process.env.LAYA_API_KEY?.trim() || null;
  const mode = (process.env.LAYA_SYSTEMONE_MODE ?? process.env.LAYA_MODE ?? '')
    .trim()
    .toLowerCase();
  const disabled = mode === 'off' || mode === '0' || mode === 'false';

  return {
    enabled: Boolean(endpoint && apiKey) && !disabled,
    endpoint,
    apiKey,
    // Persian is the product language, so the multilingual checkpoint is not
    // optional. LAYA_MODEL may still override for an English-only test.
    model: process.env.LAYA_MODEL?.trim() || 'multilingual',
    timeoutMs: Number(process.env.LAYA_SYSTEMONE_TIMEOUT_MS ?? 4_000),
  };
}

export function traceOf(cfg: LayaConfig, patch: Partial<LayaTrace> = {}): LayaTrace {
  return {
    mode: cfg.enabled ? 'live' : 'off',
    configured: Boolean(cfg.endpoint && cfg.apiKey),
    status: cfg.enabled ? 'skipped' : 'off',
    latencyMs: 0,
    endpoint: cfg.endpoint,
    model: cfg.model,
    answered: [],
    ...patch,
  };
}

/* ── the decision call ────────────────────────────────────────────────────── */

export interface DecideInput {
  /** The thing to decide about: usually the latest user turn. */
  state: string | Record<string, unknown> | Array<{ role: string; content: string }>;
  questions: Record<string, LayaQuestion>;
  lang?: string;
}

export interface DecideResult {
  decision: LayaDecision | null;
  trace: LayaTrace;
}

/* ── last-decision record (for /api/health and the X-Ray panel) ───────────── */

export interface LayaLastDecision {
  at: string;
  status: LayaTrace['status'];
  latencyMs: number;
  model: string | null;
  answered: string[];
  error?: string;
  errorStatus?: number;
  creditsCharged?: number;
}

let lastDecision: LayaLastDecision | null = null;

/**
 * The most recent real call to Laya in this process, or null if nothing has
 * been asked yet. `/api/health` reports this so "configured" can never again be
 * mistaken for "working".
 */
export function layaLastDecision(): LayaLastDecision | null {
  return lastDecision;
}

function remember(trace: LayaTrace): void {
  lastDecision = {
    at: new Date().toISOString(),
    status: trace.status,
    latencyMs: trace.latencyMs,
    model: trace.model,
    answered: trace.answered,
    ...(trace.error ? { error: trace.error } : {}),
    ...(trace.errorStatus ? { errorStatus: trace.errorStatus } : {}),
    ...(typeof trace.creditsCharged === 'number' ? { creditsCharged: trace.creditsCharged } : {}),
  };
}

/**
 * One forward pass, up to 32 questions. NEVER throws.
 * `decision` is null for every failure mode, with the reason in `trace.error`.
 */
export async function decide(input: DecideInput, cfgOverride?: LayaConfig): Promise<DecideResult> {
  const cfg = cfgOverride ?? layaConfig();

  if (!cfg.enabled || !cfg.endpoint) {
    const trace = traceOf(cfg);
    remember(trace);
    return { decision: null, trace };
  }

  const questionIds = Object.keys(input.questions).slice(0, 32);
  if (questionIds.length === 0) {
    const trace = traceOf(cfg, { status: 'skipped', error: 'no_questions' });
    remember(trace);
    return { decision: null, trace };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'X-Aniyab-App': 'aniyab-smart-assistant',
      },
      body: JSON.stringify({
        // The documented request shape. Anything else is rejected with 400/422.
        state: typeof input.state === 'string' ? input.state.slice(0, 4_000) : input.state,
        questions: Object.fromEntries(
          questionIds.map((id) => [id, input.questions[id]]),
        ),
        model: cfg.model,
        lang: input.lang ?? 'fa',
      }),
      signal: controller.signal,
      cache: 'no-store' as RequestCache,
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const trace = traceOf(cfg, {
        status: 'failed',
        latencyMs,
        error: errorLabel(res.status),
        errorStatus: res.status,
      });
      remember(trace);
      return { decision: null, trace };
    }

    const payload = (await res.json().catch(() => null)) as
      | {
          id?: string;
          model?: string;
          answers?: Record<string, LayaAnswer>;
          usage?: { input_tokens?: number; output_tokens?: number };
        }
      | null;

    if (!payload?.answers) {
      const trace = traceOf(cfg, { status: 'failed', latencyMs, error: 'no_answers' });
      remember(trace);
      return { decision: null, trace };
    }

    const credits = Number(res.headers.get('x-credits-charged'));
    const okTrace = traceOf(cfg, {
      status: 'ok',
      latencyMs,
      model: payload.model ?? cfg.model,
      answered: Object.keys(payload.answers),
      creditsCharged: Number.isFinite(credits) ? credits : undefined,
    });
    remember(okTrace);

    return {
      decision: {
        answers: payload.answers,
        usage: {
          input_tokens: payload.usage?.input_tokens ?? 0,
          output_tokens: payload.usage?.output_tokens ?? 0,
        },
        model: payload.model ?? cfg.model,
        creditsCharged: Number.isFinite(credits) ? credits : null,
        latencyMs,
        requestId: payload.id ?? null,
      },
      trace: okTrace,
    };
  } catch (err) {
    const trace = traceOf(cfg, {
      status: 'failed',
      latencyMs: Date.now() - started,
      error:
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'timeout'
            : err.message.slice(0, 120)
          : 'unknown',
    });
    remember(trace);
    return { decision: null, trace };
  } finally {
    clearTimeout(timer);
  }
}

function errorLabel(status: number): string {
  switch (status) {
    case 400:
      return 'http_400_malformed';
    case 401:
      return 'http_401_bad_key';
    case 402:
      return 'http_402_no_credits';
    case 422:
      return 'http_422_invalid_question';
    case 429:
      return 'http_429_rate_limited';
    case 503:
      return 'http_503_unavailable';
    default:
      return `http_${status}`;
  }
}

/* ── reading answers safely ───────────────────────────────────────────────── */

/** Highest-probability label for a `choice` answer, or null. */
export function readChoice(answer: LayaAnswer | undefined): { label: string; probability: number } | null {
  if (!answer) return null;

  const probabilities = answer.probabilities ?? {};
  const entries = Object.entries(probabilities).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

  if (entries.length) {
    const [label, probability] = entries.reduce((best, current) =>
      current[1] > best[1] ? current : best,
    );
    return { label, probability };
  }

  if (typeof answer.choice === 'string') {
    // No probability map (a minimal payload): the documented `confidence` is
    // the best stand-in for "how strongly this option was chosen".
    return { label: answer.choice, probability: answer.confidence ?? 0 };
  }
  return null;
}

/** P(yes) for a `noul` answer, or null. */
export function readNoul(answer: LayaAnswer | undefined): number | null {
  if (!answer) return null;
  if (typeof answer.noul === 'number') return answer.noul;
  const yes = answer.probabilities?.yes ?? answer.probabilities?.true;
  return typeof yes === 'number' ? yes : null;
}

/**
 * A score answer.
 *
 * `score` is documented as a point on a continuous scale, not an index — a
 * 4-level question can come back as `1.37`. `value` is the raw number,
 * `normalised` maps the documented 0..(levels-1) range onto 0..1, and `label`
 * is the nearest option when probabilities are present.
 */
export function readScore(
  answer: LayaAnswer | undefined,
  levels: number,
): { value: number; normalised: number; label: string | null } | null {
  if (!answer || typeof answer.score !== 'number' || !Number.isFinite(answer.score)) return null;
  const span = Math.max(1, levels - 1);
  const normalised = Math.min(1, Math.max(0, answer.score / span));
  return { value: answer.score, normalised, label: readChoice(answer)?.label ?? null };
}

/**
 * How much to trust a decision — **the field to gate on.**
 *
 * Uses Laya's `confidence` whenever it is present: for choice/score it is
 * 1 − normalised entropy (a two-way split reads low even when one option leads),
 * for noul it is `max(p, 1-p)`. Deliberately does NOT use `action.act_probability`,
 * which the model card says carries no usable signal yet (issue #185).
 */
export function answerConfidence(answer: LayaAnswer | undefined): number {
  if (!answer) return 0;
  if (typeof answer.confidence === 'number') return answer.confidence;
  // Fallbacks for a partial payload: for noul, max(p, 1-p) is exactly the
  // documented definition; for choice, the top probability is the best proxy.
  const yes = readNoul(answer);
  if (yes !== null) return Math.max(yes, 1 - yes);
  return readChoice(answer)?.probability ?? 0;
}

/**
 * Shallow, tolerant hint reader for the old "preflight" idea. Kept only so a
 * gateway that does return prose policy does not break us; Laya itself never
 * returns these keys. Prefer `decide()`.
 */
export function readSystemOneHints(payload: unknown): {
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
} {
  if (typeof payload !== 'object' || payload === null) return {};
  const root = payload as Record<string, unknown>;
  const nested =
    (typeof root.hints === 'object' && root.hints !== null ? (root.hints as Record<string, unknown>) : null) ??
    root;
  const out: { system_prompt?: string; temperature?: number; max_tokens?: number } = {};
  if (typeof nested.system_prompt === 'string' && nested.system_prompt.trim()) {
    out.system_prompt = nested.system_prompt.trim().slice(0, 4_000);
  }
  if (typeof nested.temperature === 'number') out.temperature = nested.temperature;
  if (typeof nested.max_tokens === 'number') out.max_tokens = nested.max_tokens;
  return out;
}
