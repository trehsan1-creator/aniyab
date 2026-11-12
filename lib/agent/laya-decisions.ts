import { answerConfidence, decide, layaConfig, readChoice, readNoul, readScore, type LayaAnswer, type LayaQuestion, type LayaTrace } from '@/lib/laya';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/laya-decisions.ts — the three decisions Laya makes for us
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the professional use of a decision model: the expensive generative
 *  model stops making cheap, high-volume choices.
 *
 *  1. routeTurn()      which tool to call first  → replaces keyword matching
 *                      when Laya is confident, falls back to it when not.
 *  2. tierForTurn()    which NVIDIA model to run  → greetings stop costing a
 *                      120B-parameter call.
 *  3. triageTicket()   how urgent / how risky a lost report is → the admin queue
 *                      becomes a real priority list instead of a chart.
 *
 *  All three are "threshold, not prompt": above the threshold we act
 *  automatically, below it we either defer to the model or to a human.
 */

/* ── thresholds ───────────────────────────────────────────────────────────── */

/**
 * All three gate on **`confidence`**, not on the top probability — Laya's model
 * card is explicit that confidence (1 − normalised entropy for choice/score,
 * `max(p,1-p)` for noul) is the calibrated signal, while
 * `action.act_probability` is not usable yet.
 *
 * Values are asymmetric on purpose: an error in either direction has a
 * different price.
 *  • tool  — sending a wrong tool card to a customer is expensive, so the bar
 *            is high and anything uncertain falls through to the model.
 *  • tier  — "small tier" is strict: a hard request answered by a cheap model
 *            reads as a bad product, while an easy request on a big model only
 *            costs money. Mistakes must fail toward quality.
 *  • urgency — a false "urgent" only means a human looks sooner: cheap.
 */
export const LAYA_THRESHOLDS = {
  tool: Number(process.env.LAYA_TOOL_THRESHOLD ?? 0.6),
  tier: Number(process.env.LAYA_TIER_THRESHOLD ?? 0.5),
  urgency: Number(process.env.LAYA_URGENCY_THRESHOLD ?? 0.6),
} as const;

/* ── 1. tool routing ──────────────────────────────────────────────────────── */

/**
 * The tool surface, described by **what data each tool reaches** — Laya's own
 * guidance for router questions, because that is what distinguishes tools from
 * each other. Kept terse: options share a ~256-token budget on the multilingual
 * checkpoint, and accuracy falls off as the list grows. With 12 options we are
 * comfortably inside it; above ~20 the docs say to route hierarchically.
 *
 * This list must stay in sync with `lib/agent/tools.ts`; `tests/laya-decisions`
 * asserts that every tool name here exists in the registry and vice versa.
 */
const TOOL_CRITERIA: Record<string, string> = {
  recommend_product: 'خرید یا انتخاب برچسب هوشمند، مقایسه آنی پارک و آنی پرو، مشاورهٔ خرید',
  validate_imei: 'بررسی صحت کد IMEI گوشی، کد ۱۵ رقمی',
  create_lost_report: 'ثبت اعلام مفقودی یک وسیله یا مدرک گم‌شده',
  get_report_status: 'پیگیری وضعیت پرونده، کد رهگیری، «پرونده‌ام چه شد»',
  lookup_registry: 'استعلام کد ملی در دفاتر یافته‌ها برای پیدا کردن مدرک تحویل‌شده',
  register_found_item: 'ثبت شیئی که کاربر پیدا کرده و می‌خواهد تحویل بدهد',
  open_secure_call: 'درخواست تماس بی‌نام و امن بین یابنده و صاحب شیء',
  request_found_post: 'درخواست ارسال شیء از طریق پست',
  quote_newspaper_ad: 'قیمت یا صدور پیش‌فاکتور آگهی مفقودی در روزنامه',
  get_objection_answer: 'پاسخ به تردید خرید: گرانی، حریم خصوصی، دوام، تفاوت دو محصول',
  remember_customer_fact: 'ذخیرهٔ یک نکته یا ترجیح که کاربر می‌خواهد دفعهٔ بعد به یاد بماند',
  forget_customer: 'درخواست پاک کردن حافظه و اطلاعات شخصی',
  none: 'سلام و احوال‌پرسی، سؤال عمومی، یا گفتگویی که به هیچ ابزاری نیاز ندارد',
};

/** Option ids offered to Laya for the `tool` question (registry + `none`). */
export const LAYA_TOOL_OPTIONS: readonly string[] = [...Object.keys(TOOL_CRITERIA)];

export interface RoutedByLaya {
  tool: string | null;
  probability: number;
  /** Laya's calibrated confidence for the tool answer (the gating signal). */
  confidence: number;
  confident: boolean;
  /**
   * The answers disagree: Laya named no tool while also saying the turn needs
   * tools (`needs_tools` ≥ 0.5). The docs call this out as an escalation
   * signal — we treat it as "don't act, let the model decide".
   */
  conflicting: boolean;
  needsTools: number | null;
  /** 'intent' | 'sentiment' | 'smalltalk' | 'lookup' | 'support' */
  category: string | null;
  /**
   * Laya's own calibrated objection label (see `detectObjection`). This is the
   * label that *becomes* the `topic` argument of `get_objection_answer` — the
   * decision is the argument, so the model never has to guess a keyword.
   */
  objection: string | null;
  objectionProbability: number;
  answer: LayaAnswer | undefined;
}

/**
 * Asks Laya which tool should handle this turn.
 * Returns null when Laya is off/unavailable so the caller keeps the keyword
 * router — the demo must never depend on a network call.
 */
export async function routeTurn(params: {
  message: string;
  flow: string;
  recentUserTurns?: string[];
}): Promise<{ routed: RoutedByLaya | null; trace: LayaTrace }> {
  const questions: Record<string, LayaQuestion> = {
    tool: {
      type: 'choice',
      instructions: 'کدام ابزار باید اول برای پاسخ به پیام کاربر اجرا شود؟',
      criteria: TOOL_CRITERIA,
    },
    needs_tools: {
      type: 'noul',
      instructions: 'آیا پاسخ دادن به این پیام به ابزار، پایگاه داده یا اطلاعات خصوصی نیاز دارد؟',
    },
    category: {
      type: 'choice',
      instructions: 'این پیام در کدام دسته قرار می‌گیرد؟',
      criteria: {
        support: 'مشکل، شکایت، پیگیری یا درخواست کمک عملیاتی',
        intent: 'قصد خرید، مقایسه محصول یا پرسش قیمت',
        lookup: 'استعلام مدرک یا کد شناسه',
        smalltalk: 'سلام، تشکر، خداحافظی، گفتگوی اجتماعی',
        sentiment: 'ابراز نگرانی، عجله، ناراحتی یا ناامیدی',
      },
    },
    objection: {
      type: 'choice',
      instructions: 'کاربر در حال بیان کدام تردید یا مقاومت دربارهٔ خرید است؟',
      criteria: {
        price: 'گران است، بودجه ندارم، صرفه ندارد',
        privacy: 'نگران حریم خصوصی، نمایش شماره یا ردیابی',
        durability: 'دوام ندارد، زود خراب می‌شود، چسب یا کیفیت',
        'secure-call': 'تماس امن چطور کار می‌کند، شماره‌ام دیده می‌شود؟',
        'dishonest-finder': 'اگر یابنده شیء را برنگرداند چه می‌شود؟',
        'pets-kids': 'برای حیوان خانگی یا کودک می‌خواهم',
        'other-cities': 'شهرستان هستم، ارسال می‌کنید؟',
        difference: 'تفاوت آنی پارک و آنی پرو چیست؟',
        none: 'تردیدی بیان نشده؛ کاربر فقط سؤال اطلاعاتی دارد',
      },
    },
  };

  const { decision, trace } = await decide({
    // A short state keeps us inside the 1024-token window and gives the model
    // the flow as context — Laya reads JSON states natively.
    state: {
      message: params.message,
      flow: params.flow,
      recent: (params.recentUserTurns ?? []).slice(-2),
    },
    questions,
  });

  if (!decision) return { routed: null, trace };

  const toolAnswer = decision.answers.tool;
  const top = readChoice(toolAnswer);
  if (!top) return { routed: null, trace };

  const objection = readChoice(decision.answers.objection);
  const needsTools = readNoul(decision.answers.needs_tools);
  const confidence = answerConfidence(toolAnswer);
  const namedNone = top.label === 'none';
  const conflicting = namedNone && (needsTools ?? 0) >= 0.5;

  return {
    routed: {
      tool: namedNone ? null : top.label,
      probability: top.probability,
      confidence,
      confident: !namedNone && !conflicting && confidence >= LAYA_THRESHOLDS.tool,
      conflicting,
      needsTools,
      category: readChoice(decision.answers.category)?.label ?? null,
      objection: objection && objection.label !== 'none' ? objection.label : null,
      objectionProbability: objection && objection.label !== 'none' ? objection.probability : 0,
      answer: toolAnswer,
    },
    trace,
  };
}

/* ── 2. model tier ────────────────────────────────────────────────────────── */

export interface ModelTier {
  tier: 'fast' | 'standard' | 'deep';
  /** Laya's 0..1 difficulty for this turn. */
  difficulty: number;
  confident: boolean;
}

/**
 * Difficulty → which model runs it. A greeting does not need a 120B model:
 * Laya scores the turn in ~100 ms and we pick the tier.
 *
 * The env override `NVIDIA_MODEL_FAST` / `NVIDIA_MODEL` keeps this honest: if
 * the operator pinned a single model, the tier only reorders the chain.
 */
export async function tierForTurn(params: {
  message: string;
  flow: string;
  hasTools: boolean;
}): Promise<{ tier: ModelTier | null; trace: LayaTrace }> {
  const { decision, trace } = await decide({
    state: { message: params.message, flow: params.flow, tools_available: params.hasTools },
    questions: {
      difficulty: {
        type: 'score',
        instructions: 'پاسخ دادن به این پیام برای یک مدل زبانی چقدر سخت است؟',
        criteria: [
          'trivial: فقط سلام و احوال‌پرسی یا تشکر',
          'easy: یک پاسخ کوتاه و مشخص، بدون استدلال',
          'moderate: چند مرحله، نیاز به ابزار یا اطلاعات مشتری',
          'hard: استدلال طولانی، چند ابزار، یا شرایط پیچیده',
        ],
      },
    },
  });

  if (!decision) return { tier: null, trace };

  const score = readScore(decision.answers.difficulty, 4);
  if (!score) return { tier: null, trace };

  /**
   * Asymmetric and strict, per Laya's own routing policy: the cheap tier is
   * only used when the turn is easy *and* Laya is sure. Everything uncertain
   * falls through to the stronger path, so a misroute costs tokens, not quality.
   */
  const confidence = answerConfidence(decision.answers.difficulty);
  const sure = confidence >= LAYA_THRESHOLDS.tier;

  const tier: ModelTier['tier'] =
    score.value >= 2 ? 'deep' : score.value < 1 && sure ? 'fast' : 'standard';

  return {
    tier: { tier, difficulty: score.normalised, confident: sure },
    trace,
  };
}

/* ── 3. ticket triage ─────────────────────────────────────────────────────── */

export interface TicketTriage {
  urgency: number;
  isIdentityDocument: boolean;
  fraudRisk: number;
  /** Suggested queue position: 0 = look first. */
  priority: number;
  reasonFa: string;
}

/**
 * Triages a lost report for the admin queue. Identity documents jump the queue
 * because a national ID in the wrong hands is a different kind of problem from
 * a lost umbrella.
 */
export async function triageTicket(params: {
  itemType: string;
  place?: string | null;
  description?: string | null;
}): Promise<{ triage: TicketTriage | null; trace: LayaTrace }> {
  const { decision, trace } = await decide({
    state: {
      item: params.itemType,
      last_seen: params.place ?? null,
      details: params.description ?? null,
    },
    questions: {
      urgency: {
        type: 'noul',
        instructions: 'آیا این پرونده باید سریع بررسی شود چون مدرک هویتی یا مالی ارزشمندی است؟',
      },
      is_identity_document: {
        type: 'noul',
        instructions: 'آیا شیء گم‌شده یک مدرک شناسایی است (کارت ملی، گذرنامه، کارت بانکی)؟',
      },
      fraud_risk: {
        type: 'noul',
        instructions: 'آیا احتمال سوءاستفاده یا ادعای دروغین مالکیت وجود دارد؟',
      },
    },
  });

  if (!decision) return { triage: null, trace };

  const urgency = readNoul(decision.answers.urgency) ?? 0;
  const identity = (readNoul(decision.answers.is_identity_document) ?? 0) >= 0.5;
  const fraud = readNoul(decision.answers.fraud_risk) ?? 0;

  const priority = Math.round(
    (identity ? 0 : 1) * 10 + (1 - urgency) * 10 + (1 - fraud) * 5,
  );

  const reasonFa = identity
    ? 'مدرک شناسایی است؛ ریسک سوءاستفاده دارد و باید اول بررسی شود.'
    : urgency >= LAYA_THRESHOLDS.urgency
      ? 'ارزشمند یا فوری تشخیص داده شد؛ بررسی زودتر توصیه می‌شود.'
      : 'پروندهٔ عادی؛ در نوبت استاندارد بررسی می‌شود.';

  return {
    triage: { urgency, isIdentityDocument: identity, fraudRisk: fraud, priority, reasonFa },
    trace,
  };
}

/* ── 4. found-item matching ───────────────────────────────────────────────── */

export interface FoundMatch {
  isSameItem: number;
  /** true when the probability clears the auto-match bar */
  autoMatch: boolean;
  reasoningHint: string | null;
}

/**
 * "Is this the same object?" — the decision that makes a lost-and-found registry
 * useful. Two free-text descriptions go in, a calibrated probability comes out.
 * Above the bar we can notify automatically; below it a human compares.
 */
export async function matchFoundItem(params: {
  lostDescription: string;
  foundDescriptionPrivate: string;
  itemType: string;
}): Promise<{ match: FoundMatch | null; trace: LayaTrace }> {
  const { decision, trace } = await decide({
    state: {
      item_type: params.itemType,
      lost: params.lostDescription.slice(0, 600),
      found: params.foundDescriptionPrivate.slice(0, 600),
    },
    questions: {
      same_item: {
        type: 'noul',
        instructions: 'آیا این دو توضیح به یک شیء واحد اشاره دارند؟',
      },
      distinguishing_feature: {
        type: 'choice',
        instructions: 'کدام ویژگی برای تأیید مالکیت قابل استناد است؟',
        criteria: {
          serial: 'شماره سریال، IMEI یا کد روی شیء',
          mark: 'خراش، لکه، شکستگی یا نشانهٔ فیزیکی خاص',
          contents: 'محتوای داخل شیء (کارت، ویزیت، لوازم)',
          none: 'هیچ ویژگی متمایزکننده‌ای ذکر نشده',
        },
      },
    },
  });

  if (!decision) return { match: null, trace };

  const probability = readNoul(decision.answers.same_item) ?? 0;
  return {
    match: {
      isSameItem: probability,
      autoMatch: probability >= 0.85,
      reasoningHint: readChoice(decision.answers.distinguishing_feature)?.label ?? null,
    },
    trace,
  };
}

/* ── 5. sales objection detection ─────────────────────────────────────────── */

export interface ObjectionSignal {
  objection: string | null;
  probability: number;
  /** The user is hesitating in a way the objection library can answer. */
  actionable: boolean;
}

/**
 * Detects which approved objection answer applies. Replaces the
 * `get_objection_answer(topic)` guesswork with a calibrated label, and feeds the
 * admin funnel with real counts instead of regex hits.
 */
export async function detectObjection(message: string): Promise<{
  signal: ObjectionSignal | null;
  trace: LayaTrace;
}> {
  const { decision, trace } = await decide({
    state: message,
    questions: {
      objection: {
        type: 'choice',
        instructions: 'کاربر در حال بیان کدام تردید یا مقاومت دربارهٔ خرید است؟',
        criteria: {
          price: 'گران است، بودجه ندارم، صرفه ندارد',
          privacy: 'نگران حریم خصوصی، نمایش شماره یا ردیابی هستم',
          durability: 'دوام ندارد، زود خراب می‌شود، چسب یا کیفیت',
          'secure-call': 'تماس امن چطور کار می‌کند، شماره‌ام دیده می‌شود؟',
          'dishonest-finder': 'اگر یابنده شیء را برنگرداند چه می‌شود؟',
          'pets-kids': 'برای حیوان خانگی یا کودک می‌خواهم',
          'other-cities': 'شهرستان هستم، ارسال می‌کنید؟',
          difference: 'تفاوت آنی پارک و آنی پرو چیست؟',
          none: 'تردیدی بیان نشده؛ کاربر فقط سؤال اطلاعاتی دارد',
        },
      },
    },
  });

  if (!decision) return { signal: null, trace };

  const top = readChoice(decision.answers.objection);
  if (!top) return { signal: null, trace };

  return {
    signal: {
      objection: top.label === 'none' ? null : top.label,
      probability: top.probability,
      actionable: top.label !== 'none' && top.probability >= 0.6,
    },
    trace,
  };
}

/* ── safe local copy (used when Laya is unavailable) ──────────────────────── */

/** Zero-network fallback so the UI still shows something honest. */
export function describeLayaOff(): string {
  const cfg = layaConfig();
  return cfg.enabled
    ? 'Laya در دسترس نیست؛ مسیر جایگزین استفاده شد.'
    : 'Laya تنظیم نشده است؛ مسیر جایگزین استفاده شد.';
}
