'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  components/AniyabChatInterface.tsx
 *  دستیار هوشمند آنی‌یاب — Client Component
 * ─────────────────────────────────────────────────────────────────────────────
 *  · Strict RTL Persian UI, Peyda typeface, Persian numerals (۰-۹)
 *  · Header: brand, live Laya + NVIDIA NIM status, session reset
 *  · 3 business-flow tabs (smart tag / lost & IMEI / found reporting)
 *  · Dual-mode fetch engine: SSE streaming + JSON fallback
 *  · Rich answer rendering (headings, ordered lists, bullets, bold, inline code)
 *  · Auto-scroll, typing indicator, copy-to-clipboard, persistent hotline footer
 *
 *  Deliberately dependency-free beyond React + lucide-react so it can be lifted
 *  into any Aniyab surface (web app, PWA shell, embedded widget).
 */

import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  Headphones,
  Phone,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Siren,
  Sparkles,
  Tag,
  Trash2,
  UserRound,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/* ════════════════════════════════════════════════════════════════════════════
   0. Types & design constants
   ════════════════════════════════════════════════════════════════════════════ */

type FlowId = 'smart-tag' | 'lost-report' | 'found-report';
type Role = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** true while tokens are still arriving */
  streaming?: boolean;
  /** true when this bubble is an error notice */
  error?: boolean;
  /** the user turn that produced this error bubble, for retry */
  retryPrompt?: string;
}

interface FlowDefinition {
  id: FlowId;
  emoji: string;
  title: string;
  shortTitle: string;
  description: string;
  starter: string;
  icon: typeof Tag;
  /** active-state classes for the tab */
  activeClass: string;
  glowClass: string;
}

const HOTLINE_FA = '۰۲۱-۶۲۸۰۱';
const HOTLINE_TEL = '+982162801';
const HOTLINE_TEL_FULL = '+98216280100';
const BRAND_FULL = 'مرکز ملی گمشده‌ها و پیداشده‌های آنی‌یاب';

const FLOWS: readonly FlowDefinition[] = [
  {
    id: 'smart-tag',
    emoji: '🏷️',
    title: 'خرید برچسب هوشمند',
    shortTitle: 'برچسب هوشمند',
    description: 'آنی پارک و آنی پرو؛ قفل هوشمند روی اشیای باارزش',
    icon: Tag,
    activeClass: 'border-signal/60 bg-signal/15 text-white',
    glowClass: 'shadow-[0_0_0_1px_rgba(255,122,0,0.45),0_10px_30px_-16px_rgba(255,122,0,0.9)]',
    starter:
      'سلام! می‌خواهم برچسب هوشمند آنی‌یاب بخرم. لطفاً تفاوت «آنی پارک» (۳۴۹ هزار تومان) و «آنی پرو» (۶۹۴ هزار تومان) را بگویید و مناسب‌ترین گزینه را برای [شیء من] پیشنهاد کنید.',
  },
  {
    id: 'lost-report',
    emoji: '🚨',
    title: 'اعلام مفقودی و ردیابی IMEI',
    shortTitle: 'مفقودی و ردیابی',
    description: 'استعلام با کد ملی یا IMEI ۱۵ رقمی، پست یافته، آگهی روزنامه',
    icon: Siren,
    activeClass: 'border-ember/60 bg-ember/15 text-white',
    glowClass: 'shadow-[0_0_0_1px_rgba(240,83,39,0.45),0_10px_30px_-16px_rgba(240,83,39,0.9)]',
    starter:
      'فوری! گوشی من گم شده است. می‌خواهم اعلام مفقودی ثبت کنم و با کد ۱۵ رقمی IMEI ردیابی را شروع کنم. مراحل را قدم‌به‌قدم بگویید.',
  },
  {
    id: 'found-report',
    emoji: '🤝',
    title: 'ثبت اشیا و مدارک پیداشده',
    shortTitle: 'ثبت پیداشده',
    description: 'ثبت با QR یا کد سریال و تماس امن و بی‌نام با مالک',
    icon: QrCode,
    activeClass: 'border-sky-400/60 bg-sky-400/15 text-white',
    glowClass: 'shadow-[0_0_0_1px_rgba(56,189,248,0.45),0_10px_30px_-16px_rgba(56,189,248,0.85)]',
    starter:
      'یک کیف پیدا کرده‌ام و می‌خواهم آن را در آنی‌یاب ثبت کنم. کد QR ندارد؛ چطور با کد سریال ثبت کنم و «تماس امن» با مالک چطور کار می‌کند؟',
  },
] as const;

const WELCOME_SUGGESTIONS: readonly { label: string; prompt: string }[] = [
  { label: 'IMEI گوشی‌ام را کجا پیدا کنم؟', prompt: 'کد ۱۵ رقمی IMEI گوشی را از کجا پیدا کنم؟' },
  { label: 'آگهی مفقودی در روزنامه', prompt: 'برای کارت ملی و شناسنامه‌ام آگهی مفقودی در روزنامه می‌خواهم ثبت کنم. هزینه و مراحلش چیست؟' },
  { label: '«پست یافته» چه زمانی استفاده می‌شود؟', prompt: 'سرویس «پست یافته» آنی‌یاب دقیقاً چه کاری انجام می‌دهد و چه زمانی از آن استفاده می‌شود؟' },
] as const;

/* ════════════════════════════════════════════════════════════════════════════
   1. Persian text utilities
   ════════════════════════════════════════════════════════════════════════════ */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** 1404 → ۱۴۰۴ (applied to every digit the model emits). */
function toFaDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

function toEnDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tehran',
});

function formatClock(ts: number): string {
  try {
    return toFaDigits(timeFormatter.format(new Date(ts)));
  } catch {
    return '';
  }
}

/**
 * `false` until the component has mounted. Timestamps and the session id are
 * wall-clock / random values, so they must not take part in the SSR pass.
 */
function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Persian numerals + separators: 349000 → ۳۴۹٬۰۰۰   ·   1.5 → ۱٫۵ */
function formatFaNumber(n: number): string {
  return toFaDigits(new Intl.NumberFormat('en-US').format(n))
    .replace(/,/g, '٬')
    .replace(/\./g, '٫');
}

function uid(): string {
  // crypto.randomUUID needs a secure context; fall back for http/file previews.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ════════════════════════════════════════════════════════════════════════════
   2. Rich-text renderer (no dangerouslySetInnerHTML, no markdown dependency)
   ════════════════════════════════════════════════════════════════════════════ */

const ORDERED_RE = /^\s*(?:[۰-۹0-9]{1,2})\s*[.)\-–]\s+/;
const BULLET_RE = /^\s*[-•*–—]\s+/;
const HEADING_RE = /^\s*(#{1,4})\s+/;
const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

interface Block {
  kind: 'p' | 'ul' | 'ol' | 'h';
  lines: string[];
}

/** Split a plain-text answer into paragraphs / lists / headings. */
function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      // Blank line closes the current block.
      if (blocks.length > 0 && blocks[blocks.length - 1]!.lines.length > 0) {
        blocks.push({ kind: 'p', lines: [] });
      }
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({ kind: 'h', lines: [trimmed.replace(HEADING_RE, '')] });
      continue;
    }

    const isOrdered = ORDERED_RE.test(trimmed);
    const isBullet = BULLET_RE.test(trimmed);
    const kind: Block['kind'] = isOrdered ? 'ol' : isBullet ? 'ul' : 'p';

    const previous = blocks[blocks.length - 1];

    if (previous && previous.kind === kind && (kind === 'ol' || kind === 'ul')) {
      previous.lines.push(trimmed.replace(kind === 'ol' ? ORDERED_RE : BULLET_RE, ''));
      continue;
    }

    if (previous && previous.kind === 'p' && kind === 'p' && previous.lines.length > 0) {
      previous.lines.push(trimmed);
      continue;
    }

    blocks.push({
      kind,
      lines: [kind === 'p' ? trimmed : trimmed.replace(kind === 'ol' ? ORDERED_RE : BULLET_RE, '')],
    });
  }

  return blocks.filter((b) => b.lines.length > 0);
}

/** Inline **bold**, `code`, [link](href) → React nodes (never raw HTML). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE).filter((p) => p !== '' && p !== undefined);
  const nodes: ReactNode[] = [];

  parts.forEach((part, index) => {
    const key = `${keyPrefix}-i${index}`;

    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      nodes.push(
        <strong key={key} className="font-bold text-white">
          {toFaDigits(part.slice(2, -2))}
        </strong>,
      );
      return;
    }

    if (/^`[^`]+`$/.test(part)) {
      nodes.push(
        <code
          key={key}
          dir="ltr"
          className="bidi-isolate mx-0.5 inline-block rounded-md border border-white/15 bg-midnight-900/70 px-1.5 py-0.5 font-mono text-[0.85em] text-signal-200"
        >
          {toFaDigits(part.slice(1, -1))}
        </code>,
      );
      return;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      nodes.push(
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-signal-200 underline decoration-signal/40 underline-offset-4 transition hover:text-signal-100"
        >
          {toFaDigits(link[1] ?? '')}
        </a>,
      );
      return;
    }

    nodes.push(<span key={key}>{toFaDigits(part)}</span>);
  });

  return nodes;
}

const RichAnswer = memo(function RichAnswer({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-3 text-[0.95rem] leading-peyda text-slate-100">
      {blocks.map((block, bi) => {
        const key = `b${bi}`;

        if (block.kind === 'h') {
          return (
            <h4 key={key} className="pt-0.5 text-[0.98rem] font-bold text-white">
              {renderInline(block.lines[0] ?? '', key)}
            </h4>
          );
        }

        if (block.kind === 'ol') {
          return (
            <ol key={key} className="space-y-1.5">
              {block.lines.map((line, li) => (
                <li key={`${key}-l${li}`} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-signal/20 text-[0.7rem] font-bold text-signal-200 ring-1 ring-inset ring-signal/25"
                  >
                    {toFaDigits(li + 1)}
                  </span>
                  <span className="min-w-0 flex-1">{renderInline(line, `${key}-l${li}`)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.kind === 'ul') {
          return (
            <ul key={key} className="space-y-1.5">
              {block.lines.map((line, li) => (
                <li key={`${key}-l${li}`} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-signal shadow-[0_0_0_3px_rgba(255,122,0,0.16)]"
                  />
                  <span className="min-w-0 flex-1">{renderInline(line, `${key}-l${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key}>
            {block.lines.map((line, li) => (
              <span key={`${key}-l${li}`}>
                {renderInline(line, `${key}-l${li}`)}
                {li < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
});

/* ════════════════════════════════════════════════════════════════════════════
   3. Small presentational atoms
   ════════════════════════════════════════════════════════════════════════════ */

function TypingDots({ label = 'دستیار در حال نوشتن است' }: { label?: string }) {
  return (
    <div className="flex items-center gap-1.5" role="status" aria-live="polite" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-2 animate-typing-dot rounded-full bg-[#FF7A00] shadow-[0_0_10px_rgba(255,122,0,0.55)]"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
      <span className="ms-1 text-xs text-slate-300/80">{label}</span>
    </div>
  );
}

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (id: string, text: string) => {
    /** Legacy path — required on plain HTTP or when the Clipboard API is blocked. */
    const legacyCopy = (): boolean => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, area.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch {
        return false;
      }
    };

    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) ok = legacyCopy();

    if (!ok) return;
    setCopiedId(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedId(null), 1800);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { copiedId, copy };
}

/* ════════════════════════════════════════════════════════════════════════════
   4. Message bubble
   ════════════════════════════════════════════════════════════════════════════ */

interface BubbleProps {
  message: ChatMessage;
  copied: boolean;
  onCopy: (message: ChatMessage) => void;
  onRetry?: (prompt: string) => void;
  isLast: boolean;
  /** timestamps are client-only, so they render after hydration */
  mounted: boolean;
}

const MessageBubble = memo(function MessageBubble({
  message,
  copied,
  onCopy,
  onRetry,
  isLast,
  mounted,
}: BubbleProps) {
  const isUser = message.role === 'user';

  if (message.error) {
    return (
      <div className="flex animate-fade-up justify-start">
        <div className="max-w-[min(46rem,92%)] rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-red-200">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>مشکلی پیش آمد</span>
          </div>
          <p className="leading-peyda-tight text-red-50/90">{message.content}</p>
          {message.retryPrompt ? (
            <button
              type="button"
              onClick={() => onRetry?.(message.retryPrompt!)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-red-300/25 bg-red-400/10 px-2.5 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-400/20"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              تلاش دوباره
            </button>
          ) : null}
          {mounted ? (
            <div className="mt-2 flex items-center gap-1.5 text-[0.68rem] text-red-200/70">
              <Clock3 className="size-3" aria-hidden="true" />
              <span className="font-peyda">{formatClock(message.createdAt)}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex animate-fade-up ${isUser ? 'justify-end' : 'justify-start'}`}
      dir="rtl"
    >
      <div className="flex max-w-[min(46rem,94%)] items-end gap-2.5">
        {/* Avatar */}
        <div
          aria-hidden="true"
          className={`mb-1 flex size-9 shrink-0 items-center justify-center rounded-xl border ${
            isUser
              ? 'border-signal/30 bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white shadow-signal-sm'
              : 'border-white/10 bg-deep-600/90 text-signal-200 shadow-inner-hairline'
          }`}
        >
          {isUser ? <UserRound className="size-4" /> : <Bot className="size-[1.15rem]" />}
        </div>

        <div className={`flex min-w-0 flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div
            className={`relative rounded-bubble px-4 py-3 text-right shadow-card ${
              isUser
                ? 'bubble-user rounded-br-md border border-white/10 bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white'
                : 'bubble-assistant rounded-bl-md border border-white/10 bg-[#1E3A72]/80 backdrop-blur-md'
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-peyda">
                {toFaDigits(message.content)}
              </p>
            ) : message.content ? (
              <RichAnswer content={message.content} />
            ) : (
              <TypingDots />
            )}

            {/* live caret while tokens stream in */}
            {message.streaming && message.content ? (
              <span
                aria-hidden="true"
                className="ms-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-caret-blink rounded-full bg-[#FF7A00] align-middle"
              />
            ) : null}
          </div>

          {/* Meta row: timestamp + copy (assistant only) */}
          <div
            className={`mt-1.5 flex items-center gap-2 px-1 text-[0.68rem] text-slate-300/75 ${
              isUser ? 'justify-start' : 'justify-end'
            }`}
          >
            {mounted ? (
              <span className="inline-flex items-center gap-1 font-peyda">
                <Clock3 className="size-3 opacity-70" aria-hidden="true" />
                {formatClock(message.createdAt)}
              </span>
            ) : null}

            {!isUser && !message.streaming && message.content ? (
              <button
                type="button"
                onClick={() => onCopy(message)}
                aria-label={copied ? 'متن کپی شد' : 'کپی پاسخ دستیار'}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition ${
                  copied
                    ? 'text-emerald-300'
                    : 'text-slate-300/70 hover:bg-white/10 hover:text-white'
                } ${isLast ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'}`}
              >
                {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                <span>{copied ? 'کپی شد' : 'کپی'}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ════════════════════════════════════════════════════════════════════════════
   5. Main component
   ════════════════════════════════════════════════════════════════════════════ */

export function AniyabChatInterface() {
  // Minted in an effect, never during SSR — otherwise the server/client markup diverges.
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeFlow, setActiveFlow] = useState<FlowId>('smart-tag');
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const { copiedId, copy } = useCopyToClipboard();
  const isMounted = useIsMounted();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pinnedRef = useRef(true);
  const mountedRef = useRef(true);

  /* ── 5.1 Streaming flush plumbing ───────────────────────────────────────────────────────────────────
     Tokens arrive far faster than React should re-render (30-90/s), so they are
     accumulated in a ref and painted at most once per animation frame. The ref is
     the single source of truth for the in-flight answer: it is never reset until
     the stream settles, which is what keeps earlier tokens on screen.          */
  const streamRef = useRef<{ id: string; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushStream = useCallback(() => {
    rafRef.current = null;
    const pending = streamRef.current;
    if (!pending) return;

    const { id, text } = pending;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null || typeof window === 'undefined') return;
    rafRef.current = window.requestAnimationFrame(() => flushStream());
  }, [flushStream]);

  const pushToken = useCallback(
    (id: string, chunk: string) => {
      const current = streamRef.current;
      streamRef.current =
        current && current.id === id ? { id, text: current.text + chunk } : { id, text: chunk };
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const resetStreamBuffer = useCallback(() => {
    if (rafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current = null;
  }, []);

  const settleStream = useCallback(
    (id: string, fallbackText?: string) => {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const pending = streamRef.current;
      streamRef.current = null;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const buffered = pending && pending.id === id ? pending.text : '';
          const finalText = (buffered || fallbackText || m.content || '').trim();
          return {
            ...m,
            streaming: false,
            content:
              finalText ||
              'پاسخی دریافت نشد. لطفاً دوباره بفرستید یا با پشتیبانی ۲۴ ساعته تماس بگیرید.',
          };
        }),
      );
    },
    [],
  );

  /* ── 5.2 Auto-scroll ───────────────────────────────────────────────────── */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    pinnedRef.current = true;
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  useLayoutEffect(() => {
    if (!pinnedRef.current) {
      setShowJump(true);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 1 ? 'smooth' : 'auto', block: 'end' });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distance < 96;
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  }, []);

  /* ── 5.3 Textarea autosize ─────────────────────────────────────────────── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  /* ── 5.4 Mount / unmount hygiene ───────────────────────────────────────── */
  useEffect(() => {
    setSessionId((current) => current || newSessionId());

    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ── 5.5 Session controls ──────────────────────────────────────────────── */
  const resetSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetStreamBuffer();

    setMessages([]);
    setInput('');
    setIsSending(false);
    setLatencyMs(null);
    setConnectionLost(false);
    setSessionId(newSessionId());
    pinnedRef.current = true;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [resetStreamBuffer]);

  const selectFlow = useCallback((flow: FlowDefinition) => {
    setActiveFlow(flow.id);
    setInput(flow.starter);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(flow.starter.length, flow.starter.length);
    });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════════
     5.6 DUAL-MODE FETCH ENGINE  (SSE streaming + JSON fallback)
     ══════════════════════════════════════════════════════════════════════════ */
  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isSending) return;

      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      const assistantId = uid();

      const history = [...messages, userMessage]
        .filter((m) => !m.error && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

      resetStreamBuffer();
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
      ]);
      setInput('');
      setIsSending(true);
      setLatencyMs(null);
      pinnedRef.current = true;

      const startedAt = performance.now();
      const controller = new AbortController();
      abortRef.current = controller;
      const clientTimeout = setTimeout(() => controller.abort('client-timeout'), 90_000);

      /** Replace the assistant bubble with a Persian error notice. */
      const fail = (message: string, retry: string | null = text) => {
        if (!mountedRef.current) return;
        setConnectionLost(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  error: true,
                  content: message,
                  retryPrompt: retry ?? undefined,
                }
              : m,
          ),
        );
      };

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
          body: JSON.stringify({ messages: history, sessionId, activeFlow }),
          signal: controller.signal,
          cache: 'no-store',
        });

        setConnectionLost(false);
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

        /* ── Error branch ─────────────────────────────────────────────────── */
        if (!response.ok) {
          let message = 'ارتباط با هسته هوشمند برقرار نشد. لطفاً دوباره تلاش کنید.';
          let retryAfterHint: string | null = null;
          try {
            const errBody = (await response.json()) as {
              error?: { message?: string; retryAfter?: number };
              answer?: string;
            };
            message = errBody.error?.message || errBody.answer || message;
            if (errBody.error?.retryAfter) {
              retryAfterHint = `حدود ${toFaDigits(errBody.error.retryAfter)} ثانیه صبر کنید.`;
            }
          } catch {
            /* non-JSON error body — keep the generic copy */
          }
          fail(retryAfterHint ? `${message} ${retryAfterHint}` : message);
          return;
        }

        /* ── Mode A: server-sent events ───────────────────────────────────── */
        if (contentType.includes('text/event-stream') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let received = '';
          let done = false;

          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by a blank line; keep the tail buffered.
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              for (const line of frame.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue; // comment / heartbeat
                if (!trimmed.startsWith('data:')) continue;

                const payload = trimmed.slice(5).trim();
                if (!payload) continue;
                if (payload === '[DONE]') {
                  done = true;
                  break;
                }

                try {
                  const json = JSON.parse(payload) as {
                    choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>;
                    delta?: { content?: string };
                    answer?: string;
                    content?: string;
                    error?: { message?: string; code?: string };
                  };

                  if (json.error?.message) {
                    fail(json.error.message);
                    try {
                      await reader.cancel();
                    } catch {
                      /* already closed */
                    }
                    return;
                  }

                  const delta =
                    json.choices?.[0]?.delta?.content ??
                    json.choices?.[0]?.message?.content ??
                    json.delta?.content ??
                    '';

                  const piece = typeof delta === 'string' ? delta : '';

                  if (piece) {
                    received += piece;
                    pushToken(assistantId, piece);
                  } else if (!received && (json.answer || json.content)) {
                    // Some gateways send one non-delta JSON frame.
                    const whole = json.answer ?? json.content ?? '';
                    received += whole;
                    pushToken(assistantId, whole);
                  }
                } catch {
                  /* malformed frame — skip it and keep consuming */
                }
              }

              if (done) break;
              boundary = buffer.indexOf('\n\n');
            }
          }

          settleStream(assistantId);
          if (mountedRef.current) setLatencyMs(Math.round(performance.now() - startedAt));
          return;
        }

        /* ── Mode B: standard JSON ────────────────────────────────────────── */
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
          answer?: string;
          content?: string;
          error?: { message?: string };
        };

        if (data.error?.message) {
          fail(data.error.message);
          return;
        }

        const answer =
          data.choices?.[0]?.message?.content ??
          data.choices?.[0]?.delta?.content ??
          data.answer ??
          data.content ??
          '';

        if (!answer.trim()) {
          fail('پاسخ خالی از هسته هوشمند دریافت شد. لطفاً دوباره بفرستید.');
          return;
        }

        // Reveal the JSON answer progressively so both modes feel identical.
        await new Promise<void>((resolve) => {
          let cursor = 0;
          const step = Math.max(3, Math.ceil(answer.length / 90));
          const tick = () => {
            if (!mountedRef.current) {
              resolve();
              return;
            }
            cursor = Math.min(answer.length, cursor + step);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: answer.slice(0, cursor) } : m)),
            );
            if (cursor < answer.length) {
              window.setTimeout(tick, 16);
            } else {
              resolve();
            }
          };
          window.setTimeout(tick, 16);
        });

        settleStream(assistantId, answer);
        if (mountedRef.current) setLatencyMs(Math.round(performance.now() - startedAt));
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        if (aborted) {
          settleStream(assistantId, 'ارسال درخواست لغو شد.');
          return;
        }
        fail(
          'ارتباط با سرور آنی‌یاب برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.',
        );
      } finally {
        clearTimeout(clientTimeout);
        if (mountedRef.current) setIsSending(false);
        abortRef.current = null;
      }
    },
    [activeFlow, isSending, messages, pushToken, resetStreamBuffer, sessionId, settleStream],
  );

  /* ── 5.7 Composer handlers ─────────────────────────────────────────────── */
  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      if (isSending) return;
      void sendMessage(input);
    },
    [input, isSending, sendMessage],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (!isSending) void sendMessage(input);
      }
    },
    [input, isSending, sendMessage],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsSending(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  const handleCopy = useCallback(
    (message: ChatMessage) => {
      void copy(message.id, message.content);
    },
    [copy],
  );

  const flow = useMemo(() => FLOWS.find((f) => f.id === activeFlow) ?? FLOWS[0]!, [activeFlow]);
  const isEmpty = messages.length === 0;
  const charCount = toEnDigits(input).length;

  /* ══════════════════════════════════════════════════════════════════════════
     6. Render
     ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-midnight bg-app-radial">
      {/* ambient texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-fade bg-[length:44px_44px] opacity-[0.16] [mask-image:radial-gradient(75%_60%_at_50%_0%,#000_20%,transparent_100%)]"
      />

      {/* ═══════════════ HEADER BAR ═══════════════ */}
      <header className="relative z-20 shrink-0 border-b border-white/10 bg-[#1E3A72]/80 shadow-card backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-shell items-center gap-3 px-4 py-3 sm:px-6">
          {/* Brand mark */}
          <div className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-l from-[#FF7A00] to-[#f05327] shadow-signal-sm sm:size-12">
            <ScanLine className="size-5 text-white sm:size-6" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="absolute -inset-px rounded-2xl ring-1 ring-inset ring-white/25"
            />
          </div>

          {/* Brand identity */}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.95rem] font-bold leading-tight text-white sm:text-base">
              دستیار هوشمند آنی‌یاب
            </h1>
            <p className="mt-0.5 truncate text-[0.68rem] font-medium text-slate-300 sm:text-xs">
              {BRAND_FULL}
            </p>
          </div>

          {/* Live status badge */}
          <div className="hidden items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 md:flex">
            <span className="relative flex size-2">
              <span
                aria-hidden="true"
                className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-emerald-400"
              />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            </span>
            <span className="text-[0.7rem] font-medium text-emerald-100">
              متصل به هسته هوشمند <span className="bidi-isolate font-semibold">Laya + NVIDIA NIM</span>
            </span>
          </div>

          {/* Compact status dot for small screens */}
          <span
            className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 md:hidden"
            aria-label="متصل به هسته هوشمند Laya و NVIDIA NIM"
          >
            <span className="relative flex size-1.5">
              <span
                aria-hidden="true"
                className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-emerald-400"
              />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[0.62rem] text-emerald-100">متصل</span>
          </span>

          {/* Reset session */}
          <button
            type="button"
            onClick={resetSession}
            title="شروع گفتگوی جدید"
            aria-label="شروع گفتگوی جدید و بازنشانی نشست"
            className="group inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition-all duration-200 ease-peyda hover:border-signal/40 hover:bg-signal/15 hover:text-white active:scale-95"
          >
            <RotateCcw className="size-[1.05rem] transition-transform duration-500 group-hover:-rotate-180" aria-hidden="true" />
          </button>
        </div>

        {/* ── FLOW SELECTOR TABS ── */}
        <div className="mx-auto w-full max-w-shell px-4 pb-3 sm:px-6">
          <div
            role="tablist"
            aria-label="انتخاب جریان خدمت"
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-1 px-1 pb-0.5 [mask-image:linear-gradient(to_left,transparent_0,#000_18px,#000_calc(100%-18px),transparent_100%)]"
          >
            {FLOWS.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeFlow;
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectFlow(item)}
                  className={`group relative flex shrink-0 snap-start items-center gap-2 rounded-xl border px-3 py-2 text-[0.78rem] font-medium transition-all duration-300 ease-peyda active:scale-[0.98] ${
                    active
                      ? `${item.activeClass} ${item.glowClass}`
                      : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span aria-hidden="true" className="emoji text-[0.95rem] leading-none">
                    {item.emoji}
                  </span>
                  <Icon
                    className={`size-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}
                    aria-hidden="true"
                  />
                  <span className="whitespace-nowrap">{item.shortTitle}</span>
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-gradient-to-l from-[#FF7A00] to-[#f05327]"
                    />
                  ) : null}
                </button>
              );
            })}

            <div className="ms-auto hidden shrink-0 items-center gap-1.5 px-1 text-[0.68rem] text-slate-400 sm:flex">
              <Zap className="size-3 text-signal-300" aria-hidden="true" />
              <span className="bidi-isolate">Laya Orchestrator</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═══════════════ MESSAGE SCROLL AREA ═══════════════ */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth"
        role="log"
        aria-live="off"
        aria-busy={isSending}
        aria-label="تاریخچه گفتگو با دستیار آنی‌یاب"
      >
        <div className="mx-auto flex w-full max-w-chat flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
          {isEmpty ? (
            /* ── WELCOME / EMPTY STATE ── */
            <div className="flex flex-col gap-6 animate-fade-in">
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-4 rounded-full bg-signal/20 blur-2xl"
                  />
                  <div className="relative flex size-16 animate-float-slow items-center justify-center rounded-3xl border border-white/15 bg-[#1E3A72]/80 shadow-card backdrop-blur-md">
                    <Sparkles className="size-7 text-signal" aria-hidden="true" />
                  </div>
                </div>

                <h2 className="text-lg font-bold text-white sm:text-xl">
                  سلام <span className="emoji">👋</span> من دستیار هوشمند آنی‌یاب هستم
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-peyda text-slate-300">
                  گم‌شده یا پیدا‌شده‌ای دارید؟ یکی از سه مسیر زیر را انتخاب کنید تا قدم‌به‌قدم
                  راهنمایی‌تان کنم — در تمام ساعات شبانه‌روز.
                </p>
              </div>

              {/* Flow cards */}
              <div className="grid gap-3 sm:grid-cols-3">
                {FLOWS.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveFlow(item.id);
                        void sendMessage(item.starter);
                      }}
                      style={{ animationDelay: `${index * 70}ms` }}
                      className="group animate-fade-up rounded-2xl border border-white/10 bg-[#1E3A72]/60 p-4 text-right backdrop-blur-md transition-all duration-300 ease-peyda hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#1E3A72]/85 hover:shadow-card-hover active:scale-[0.99]"
                    >
                      <div className="mb-2.5 flex items-center justify-between">
                        <span className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] transition-colors group-hover:border-signal/35 group-hover:bg-signal/15">
                          <Icon className="size-[1.05rem] text-signal-200 transition-colors group-hover:text-signal-100" aria-hidden="true" />
                        </span>
                        <span
                          aria-hidden="true"
                          className="emoji text-base opacity-80"
                        >
                          {item.emoji}
                        </span>
                      </div>
                      <h3 className="text-[0.86rem] font-semibold leading-snug text-white">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-[0.72rem] leading-relaxed text-slate-300/85">
                        {item.description}
                      </p>
                      <span className="mt-3 inline-flex items-center gap-1 text-[0.7rem] font-medium text-signal-200 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        شروع گفتگو
                        <ArrowUp className="size-3 -rotate-45" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Quick suggestions */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[0.68rem] font-medium text-slate-400">پرسش‌های پرتکرار</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {WELCOME_SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => void sendMessage(s.prompt)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.72rem] text-slate-200 transition-all duration-200 hover:border-signal/40 hover:bg-signal/15 hover:text-white active:scale-95"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Trust row */}
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.68rem] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-emerald-400/80" aria-hidden="true" />
                  احراز هویت مالک پیش از تحویل
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Headphones className="size-3.5 text-signal-300" aria-hidden="true" />
                  پشتیبانی شبانه‌روزی {HOTLINE_FA}
                </span>
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                copied={copiedId === message.id}
                onCopy={handleCopy}
                onRetry={(prompt) => void sendMessage(prompt)}
                isLast={index === messages.length - 1}
                mounted={isMounted}
              />
            ))
          )}

          {/* Offline / connection notice */}
          {connectionLost && !isSending ? (
            <div className="flex items-center justify-center gap-2 text-[0.72rem] text-amber-200/80">
              <WifiOff className="size-3.5" aria-hidden="true" />
              اتصال با هسته هوشمند ناپایدار است — پاسخ‌ها ممکن است با تأخیر برسند.
            </div>
          ) : null}

          <div ref={bottomRef} className="h-px w-full" aria-hidden="true" />
        </div>
      </div>

      {/* Jump-to-latest */}
      {showJump ? (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          aria-label="رفتن به آخرین پیام"
          className="absolute bottom-36 start-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-[#1E3A72]/90 px-3.5 py-2 text-[0.72rem] font-medium text-white shadow-card backdrop-blur-md transition hover:bg-[#1E3A72] rtl:translate-x-1/2"
        >
          <ArrowDown className="size-3.5" aria-hidden="true" />
          آخرین پیام
        </button>
      ) : null}

      {/* ═══════════════ COMPOSER ═══════════════ */}
      <div className="relative z-20 shrink-0 border-t border-white/10 bg-gradient-to-t from-[#0B1A26] via-[#0B1A26]/95 to-[#0B1A26]/70 backdrop-blur-md">
        <div className="mx-auto w-full max-w-chat px-4 pt-3 sm:px-6">
          {/* active flow context strip */}
          <div className="mb-2 flex items-center gap-2 text-[0.68rem] text-slate-400">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
              <span aria-hidden="true" className="emoji">
                {flow.emoji}
              </span>
              <span className="text-slate-200">{flow.title}</span>
            </span>
            {latencyMs !== null ? (
              <span className="inline-flex items-center gap-1 font-peyda text-slate-400">
                <Clock3 className="size-3 opacity-70" aria-hidden="true" />
                <span>پاسخ در</span>
                <span dir="ltr" className="bidi-isolate">
                  {formatFaNumber(Number((latencyMs / 1000).toFixed(1)))}
                </span>
                <span>ثانیه</span>
              </span>
            ) : null}
            {isMounted && sessionId ? (
              <span className="ms-auto hidden items-center gap-1 font-peyda text-[0.62rem] text-slate-500 sm:flex">
                <span className="opacity-70">نشست</span>
                <span className="bidi-isolate rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-slate-400" dir="ltr">
                  {sessionId.slice(0, 8)}
                </span>
              </span>
            ) : null}
          </div>

          {/* the input bar */}
          <form onSubmit={handleSubmit} className="relative">
            <div
              className={`group relative flex items-end gap-2 rounded-2xl border bg-[#1E3A72]/80 p-2 backdrop-blur-md transition-all duration-300 ease-peyda ${
                isSending
                  ? 'border-signal/30 shadow-[0_0_0_1px_rgba(255,122,0,0.16),0_16px_40px_-24px_rgba(255,122,0,0.7)]'
                  : 'border-white/10 focus-within:border-signal/45 focus-within:shadow-[0_0_0_1px_rgba(255,122,0,0.22)]'
              }`}
            >
              {/* quick attach-style affordance */}
              <button
                type="button"
                onClick={() => selectFlow(flow)}
                title="درج پیشنهاد شروع این جریان"
                aria-label="درج پیشنهاد شروع برای جریان فعال"
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-signal-200 active:scale-95"
              >
                <Sparkles className="size-4" aria-hidden="true" />
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                dir="rtl"
                maxLength={2000}
                enterKeyHint="send"
                aria-label="متن پیام به دستیار آنی‌یاب"
                placeholder={
                  isEmpty
                    ? 'چه کمکی می‌توانم بکنم؟'
                    : 'پاسخ خود را بنویسید…'
                }
                disabled={isSending}
                className="max-h-[168px] min-h-[40px] flex-1 resize-none rounded-lg bg-transparent px-1 py-2.5 text-base leading-relaxed text-white outline-none placeholder:text-slate-400/70 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 sm:text-[0.92rem]"
              />

              {/* send / stop */}
              {isSending ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  aria-label="توقف تولید پاسخ"
                  className="mb-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
                >
                  <span className="block size-3 rounded-[3px] bg-signal" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="ارسال پیام"
                  className="cta-signal mb-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  <ArrowUp className="size-[1.15rem]" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* helper row */}
            <div className="mt-1.5 flex items-center justify-between px-1 text-[0.62rem] text-slate-500">
              <span className="hidden sm:inline">
                <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-peyda text-[0.6rem] text-slate-400">
                  Enter
                </kbd>{' '}
                ارسال ·{' '}
                <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-peyda text-[0.6rem] text-slate-400">
                  Shift + Enter
                </kbd>{' '}
                خط جدید
              </span>
              <span
                dir="ltr"
                className={`bidi-isolate font-peyda transition-colors ${
                  charCount > 1800 ? 'text-signal-300' : 'text-slate-500'
                }`}
              >
                {`${formatFaNumber(charCount)} / ۲۰۰۰`}
              </span>
            </div>
          </form>

          {/* ═══════════════ FOOTER — persistent hotline ═══════════════ */}
          <footer className="safe-bottom mt-2 border-t border-white/[0.07] pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[0.68rem]">
              <a
                href={`tel:${HOTLINE_TEL_FULL}`}
                className="group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300 transition hover:border-signal/40 hover:bg-signal/10 hover:text-white"
                aria-label={`تماس با پشتیبانی ۲۴ ساعته آنی‌یاب ${HOTLINE_FA}`}
              >
                <span className="relative flex size-1.5">
                  <span aria-hidden="true" className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-emerald-400" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                <Phone className="size-3 text-signal-300" aria-hidden="true" />
                <span>پشتیبانی ۲۴ ساعته</span>
                <span dir="ltr" className="bidi-isolate font-peyda font-semibold text-white">
                  {HOTLINE_FA}
                </span>
              </a>

              <div className="flex items-center gap-3 text-slate-500">
                <span className="hidden items-center gap-1 sm:inline-flex">
                  <ShieldCheck className="size-3 text-slate-500" aria-hidden="true" />
                  گفتگو محرمانه است
                </span>
                {!isEmpty ? (
                  <button
                    type="button"
                    onClick={resetSession}
                    className="inline-flex items-center gap-1 rounded px-1 text-slate-400 transition hover:text-white"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                    پاک کردن گفتگو
                  </button>
                ) : null}
                <span className="bidi-isolate hidden text-[0.62rem] opacity-70 md:inline">
                  Laya + NVIDIA NIM
                </span>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {/* Screen-reader announcements */}
      <p className="sr-only" aria-live="assertive">
        {isSending ? 'دستیار در حال آماده‌سازی پاسخ است.' : ''}
      </p>
    </div>
  );
}

export default AniyabChatInterface;
