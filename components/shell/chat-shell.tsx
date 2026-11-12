'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Bug, Gauge, Loader2, Mic, Phone, RotateCcw, Square, X } from 'lucide-react';

import { BRAND } from '@/content/brand';
import { PRODUCTS } from '@/content/catalog';
import { OBJECTIONS } from '@/content/objections.fa';
import { ImeiInputCard } from '@/components/cards/imei-input-card';
import { ProductComparisonCard } from '@/components/cards/product-comparison-card';
import { ReportTicketCard } from '@/components/cards/report-ticket-card';
import {
  LookupResultCard,
  MemoryToast,
  NewspaperQuoteCard,
  PostShipmentCard,
  ReceiptCard,
  SecureCallCard,
  TriageNote,
} from '@/components/cards/misc-cards';
import { ScannerCard } from '@/components/cards/qr-scanner';
import { ContextPanel, LayaMark } from '@/components/shell/context-panel';
import { DemoDrawer, DEMO_PERSONA_LIST } from '@/components/shell/demo-drawer';
import { FlowRail, FLOWS, type FlowKey } from '@/components/shell/flow-rail';
import { useAgentStream } from '@/lib/client/use-agent-stream';
import { getDeviceId, trackFunnel } from '@/lib/client/track';
import { toFaDigits } from '@/lib/validators';

/**
 * ChatShell — the v2 three-zone layout.
 *   rail (start/right) · chat (centre) · context (end/left)
 * On <lg the rail becomes a chip strip and context moves into a bottom sheet.
 */

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const QUICK_STARTERS = [
  'برای کیف لپ‌تاپ چه برچسبی مناسب است؟',
  'گوشی‌ام گم شده، چه کنم؟',
  'یک کارت ملی پیدا کردم',
  'آگهی مفقودی در روزنامه چقدر است؟',
];

function greetingFor(hour: number): string {
  if (hour < 12) return 'صبح بخیر';
  if (hour < 17) return 'وقت بخیر';
  return 'شب بخیر';
}

export function ChatShell({
  demoMode,
  scriptedDefault,
  initialFlow,
}: {
  demoMode: boolean;
  scriptedDefault: boolean;
  initialFlow?: FlowKey;
}) {
  const [flow, setFlow] = useState<FlowKey>(initialFlow ?? 'smart-tag');
  const [input, setInput] = useState('');
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [chips, setChips] = useState<Array<{ id: string; labelFa: string; tone: 'info' | 'warn' | 'success' }>>([]);
  const [visit, setVisit] = useState<number>(1);
  const [xray, setXray] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scripted, setScripted] = useState(scriptedDefault);
  // A persona switch overrides the anonymous device id for this tab only.
  const [deviceOverride, setDeviceOverride] = useState<string | null>(null);

  const deviceId = useMemo(() => deviceOverride ?? getDeviceId(), [deviceOverride]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { text, cards, tools, meta, memoryToasts, error, streaming, send, stop, reset } =
    useAgentStream();

  /* ── auto-scroll while streaming ─────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [bubbles, text, cards, tools]);

  /* ── welcome: recognise the returning customer ───────────────────────────── */
  useEffect(() => {
    if (!deviceId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/identity?deviceId=${encodeURIComponent(deviceId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          greeting?: string | null;
          chips?: Array<{ id: string; labelFa: string; tone: 'info' | 'warn' | 'success' }>;
          visitCount?: number;
          conversationId?: string;
          name?: string | null;
        };
        setGreeting(data.greeting ?? null);
        setChips(data.chips ?? []);
        setVisit(data.visitCount ?? 1);
        setConversationId(data.conversationId);
      } catch {
        /* offline is fine */
      }
    })();
  }, [deviceId]);

  const submit = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || streaming) return;

      const userBubble: ChatBubble = { id: `u-${Date.now()}`, role: 'user', text: value };
      setBubbles((prev) => [...prev, userBubble]);
      setInput('');
      reset();

      const history = [...bubbles, userBubble]
        .slice(-10)
        .map((b) => ({ role: b.role, content: b.text }));

      await send({
        messages: history,
        activeFlow: flow,
        deviceId,
        conversationId,
        xray,
        scripted,
      });
    },
    [bubbles, conversationId, deviceId, flow, reset, send, streaming, xray, scripted],
  );

  /* commit the streamed answer into a bubble when the turn ends */
  useEffect(() => {
    if (streaming || !text) return;
    setBubbles((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.text === text) return prev;
      return [...prev, { id: `a-${Date.now()}`, role: 'assistant', text }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on completion
  }, [streaming]);

  const hour = new Date().getHours();
  const hasConversation = bubbles.length > 0 || Boolean(text);

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden bg-midnight">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-app-radial" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, #fff 1px, transparent 1px), linear-gradient(to left, #fff 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(60% 60% at 50% 0%, #000 0%, transparent 100%)',
        }}
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-shell gap-3 px-2 py-2 sm:px-4 sm:py-3">
        {/* ── rail (RTL start = right) ─────────────────────────────────────── */}
        <aside className="hidden w-[184px] shrink-0 flex-col lg:flex">
          <div className="mb-3 flex items-center gap-2 px-1">
            <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-[13px] font-extrabold text-white shadow-signal-sm">
              آ
            </span>
            <div>
              <p className="text-[12.5px] font-bold leading-4 text-white">{BRAND.nameFa}</p>
              <p className="text-[9.5px] text-slate-400">دستیار هوشمند</p>
            </div>
          </div>
          <FlowRail active={flow} onSelect={setFlow} ticketCount={cards.filter((c) => c.card === 'ReportTicketCard').length} />
          <div className="mt-auto space-y-2 px-1">
            <a
              href={`tel:${BRAND.hotlineRaw}`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-slate-300 transition hover:bg-white/[0.06]"
            >
              <Phone className="size-3 text-signal" aria-hidden />
              <span dir="ltr">{BRAND.hotlineFa}</span>
            </a>
            <LayaMark />
          </div>
        </aside>

        {/* ── chat column ──────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-midnight-800/60 shadow-card backdrop-blur-xl">
          <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-sm font-extrabold text-white shadow-signal-sm">
                آ
                <span className="absolute -bottom-0.5 -start-0.5 size-2.5 rounded-full border-2 border-midnight-800 bg-emerald-400" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[13.5px] font-bold text-white">{BRAND.assistantNameFa}</h1>
                <p className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                  آنلاین · {BRAND.hotlineHoursFa}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setXray((v) => !v)}
                aria-pressed={xray}
                className={[
                  'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] transition',
                  xray
                    ? 'border-signal/50 bg-signal/15 text-signal'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200',
                ].join(' ')}
                title="نمایش خط لوله Laya (X-Ray)"
              >
                <Bug className="size-3" aria-hidden />
                X-Ray
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-slate-300 lg:hidden"
              >
                وضعیت
              </button>
              {demoMode ? (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-signal/40 bg-signal/10 px-2 py-1.5 text-[10px] text-signal"
                  title="کنسول دمو"
                >
                  <Gauge className="size-3" aria-hidden />
                  دمو
                </button>
              ) : null}
            </div>
          </header>

          {/* messages */}
          <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite" aria-relevant="additions text">
            {!hasConversation ? (
              <WelcomeState
                hour={hour}
                greeting={greeting}
                onPick={(value) => void submit(value)}
              />
            ) : null}

            {flow === 'found-report' && !hasConversation ? (
              <div className="mx-auto max-w-sm pb-2">
                <ScannerCard
                  onDetected={(payload) =>
                    void submit(
                      `شیء پیداشده را اسکن کردم؛ کد ${payload.value}. می‌خواهم ثبتش کنم.`,
                    )
                  }
                  onSimulate={() =>
                    void submit('یک کیف چرمی مشکی پیدا کردم و می‌خواهم ثبتش کنم')
                  }
                />
              </div>
            ) : null}

            {bubbles.map((bubble) => (
              <Bubble key={bubble.id} bubble={bubble} />
            ))}

            {streaming && text ? <Bubble bubble={{ id: 'live', role: 'assistant', text }} streaming /> : null}

            {/* tool progress */}
            {streaming && tools.length > 0 ? (
              <div className="flex flex-col gap-1">
                {tools.map((tool) => (
                  <div key={tool.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                    {tool.status === 'start' ? (
                      <Loader2 className="size-3 animate-spin text-signal" aria-hidden />
                    ) : tool.status === 'ok' ? (
                      <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                    ) : (
                      <span className="size-1.5 rounded-full bg-rose-400" aria-hidden />
                    )}
                    <span>{tool.summaryFa ?? tool.labelFa}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* rich cards */}
            <AnimatePresence initial={false}>
              {cards.map((card) => (
                <div key={card.id} className="pt-1">
                  <CardRenderer card={card.card} props={card.props} onSubmitImei={(imei) => void submit(`کد IMEI من ${imei} است`)} />
                </div>
              ))}
            </AnimatePresence>

            {memoryToasts.map((toast, index) => (
              <MemoryToast key={`mem-${index}`} text={toast} />
            ))}

            {streaming && !text && tools.length === 0 ? (
              <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
                <span className="flex gap-1" aria-hidden>
                  <Dot delay="0ms" />
                  <Dot delay="150ms" />
                  <Dot delay="300ms" />
                </span>
                دستیار در حال آماده‌سازی پاسخ است…
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.08] p-3">
                <p className="text-[11.5px] leading-6 text-rose-100">{error}</p>
                <button
                  type="button"
                  onClick={() => void submit(bubbles.filter((b) => b.role === 'user').at(-1)?.text ?? '')}
                  className="mt-2 flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[10.5px] text-white hover:bg-white/10"
                >
                  <RotateCcw className="size-3" aria-hidden /> تلاش دوباره
                </button>
              </div>
            ) : null}
          </div>

          {/* composer */}
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void submit(input)}
            onStop={stop}
            streaming={streaming}
            disabled={false}
            flow={flow}
            onFlowChange={setFlow}
            textareaRef={textareaRef}
          />

          <footer className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-1.5 text-[9.5px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <a href={`tel:${BRAND.hotlineRaw}`} dir="ltr" className="nv text-slate-400 hover:text-white">
                {BRAND.hotlineFa}
              </a>
              <span aria-hidden>·</span>
              <span>پشتیبانی شبانه‌روزی</span>
            </span>
            <span className="flex items-center gap-2">
              {process.env.NEXT_PUBLIC_DEMO_BADGE !== '0' ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px]">
                  نسخه نمایشی
                </span>
              ) : null}
              {visit > 1 ? <span>بازدید {toFaDigits(visit)}</span> : null}
            </span>
          </footer>
        </main>

        {/* ── context (RTL end = left) ─────────────────────────────────────── */}
        <aside className="hidden w-[248px] shrink-0 lg:block">
          <ContextPanel chips={chips} cards={cards} tools={tools} meta={meta} greeting={greeting} xray={xray} />
        </aside>
      </div>

      {/* mobile context sheet */}
      <AnimatePresence>
        {sheetOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setSheetOpen(false)}
          >
            <motion.aside
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-0 bottom-0 max-h-[76dvh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-midnight-800 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              role="dialog"
              aria-label="وضعیت و جزئیات"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="absolute end-3 top-3 rounded-lg p-1 text-slate-400 hover:text-white"
                aria-label="بستن"
              >
                <X className="size-4" />
              </button>
              <ContextPanel chips={chips} cards={cards} tools={tools} meta={meta} greeting={greeting} xray={xray} />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {demoMode ? <DemoBadge /> : null}

      <DemoDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeDeviceId={deviceId ?? DEMO_PERSONA_LIST[0]!.deviceId}
        onSwitchPersona={(next) => {
          // Persist BEFORE the reload, otherwise the old identity comes back and
          // the presenter silently demos the wrong persona.
          try {
            window.localStorage.setItem('aniyab:device', next);
            window.localStorage.setItem('aniyab:persona', next);
          } catch {
            /* private mode: the in-memory override still applies this session */
          }
          setDeviceOverride(next);
          setDrawerOpen(false);
          window.location.reload();
        }}
        currentVisit={visit}
        scripted={scripted}
        onToggleScripted={(next) => {
          setScripted(next);
          trackFunnel('demo.scripted', { on: next });
        }}
        onReset={() => {
          void fetch('/api/demo/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          })
            .then((r) => r.json())
            .then(() => {
              window.location.reload();
            })
            .catch(() => undefined);
        }}
        onFastForward={async () => {
          const res = await fetch('/api/demo/fast-forward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          });
          const data = (await res.json()) as { messageFa?: string };
          return data.messageFa ?? 'انجام شد.';
        }}
      />
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────────────────── */

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 rounded-full bg-slate-400 animate-typing-dot"
      style={{ animationDelay: delay }}
    />
  );
}

function Bubble({ bubble, streaming }: { bubble: ChatBubble; streaming?: boolean }) {
  const isUser = bubble.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}
    >
      <div
        className={[
          'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-7 sm:max-w-[78%]',
          isUser
            ? 'rounded-bs-sm bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white shadow-signal-sm'
            : 'rounded-be-sm border border-white/[0.07] bg-deep-600/35 text-slate-100',
        ].join(' ')}
      >
        {bubble.text}
        {streaming ? <span className="ms-0.5 inline-block h-3.5 w-0.5 animate-caret-blink bg-signal align-middle" aria-hidden /> : null}
      </div>
    </motion.div>
  );
}

function WelcomeState({
  hour,
  greeting,
  onPick,
}: {
  hour: number;
  greeting: string | null;
  onPick: (value: string) => void;
}) {
  return (
    <div className="mx-auto max-w-chat px-1">
      <div className="mb-5 text-center">
        <p className="text-[19px] font-extrabold leading-9 text-white sm:text-[22px]">
          {greeting ?? `سلام 👋 ${greetingFor(hour)}`}
        </p>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-7 text-slate-400">
          {greeting
            ? 'از همان‌جایی که بودیم ادامه می‌دهیم.'
            : 'گم‌شده یا پیدا‌شده‌ای دارید؟ یکی از مسیرهای زیر را انتخاب کنید تا قدم‌به‌قدم راهنمایی‌تان کنم — در تمام ساعات شبانه‌روز.'}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {FLOWS.map((flow) => {
          const Icon = flow.icon;
          const prompts: Record<string, string> = {
            'smart-tag': 'برای کیف لپ‌تاپ چه برچسبی مناسب است؟',
            'lost-report': 'گوشی‌ام گم شده، چه کنم؟',
            'found-report': 'یک شیء پیدا کردم، چطور ثبت کنم؟',
          };
          return (
            <button
              key={flow.key}
              type="button"
              onClick={() => onPick(prompts[flow.key] ?? flow.labelFa)}
              className="group rounded-xl border border-white/10 bg-white/[0.03] p-3 text-start transition hover:border-signal/40 hover:bg-signal/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            >
              <span className="mb-2 grid size-8 place-items-center rounded-lg bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white shadow-signal-sm transition group-hover:scale-105">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="block text-[12px] font-bold text-white">{flow.labelFa}</span>
              <span className="mt-0.5 block text-[10.5px] leading-5 text-slate-400">{flow.hintFa}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {QUICK_STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] text-slate-300 transition hover:border-signal/40 hover:text-white"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  flow,
  onFlowChange,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  flow: FlowKey;
  onFlowChange: (flow: FlowKey) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const [listening, setListening] = useState(false);
  const supportsVoice =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  function startVoice() {
    type SR = new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start: () => void;
      stop: () => void;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      onerror: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognizer = new Ctor();
    recognizer.lang = 'fa-IR';
    recognizer.continuous = false;
    recognizer.interimResults = false;
    recognizer.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript) onChange(transcript);
    };
    recognizer.onend = () => setListening(false);
    recognizer.onerror = () => setListening(false);
    setListening(true);
    recognizer.start();
  }

  return (
    <div className="border-t border-white/10 bg-midnight-900/50 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 sm:px-3">
      {/* mobile flow chips */}
      <div className="mb-1.5 flex gap-1 overflow-x-auto lg:hidden">
        {FLOWS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFlowChange(f.key)}
            className={[
              'shrink-0 rounded-full px-2.5 py-1 text-[10px] transition',
              flow === f.key
                ? 'bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white'
                : 'border border-white/10 bg-white/[0.04] text-slate-300',
            ].join(' ')}
          >
            {f.labelFa}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-1.5 rounded-2xl border border-white/12 bg-midnight-800/90 p-1.5 focus-within:border-signal/50">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          maxLength={2000}
          disabled={disabled}
          placeholder="پیام خود را بنویسید…"
          aria-label="متن پیام"
          className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[12.5px] leading-6 text-white placeholder:text-slate-500 focus:outline-none"
        />

        {supportsVoice ? (
          <button
            type="button"
            onClick={startVoice}
            aria-label="ورودی صوتی"
            aria-pressed={listening}
            className={[
              'grid size-9 shrink-0 place-items-center rounded-xl transition',
              listening ? 'bg-rose-500/20 text-rose-300' : 'text-slate-400 hover:bg-white/5 hover:text-white',
            ].join(' ')}
          >
            <Mic className="size-4" aria-hidden />
          </button>
        ) : null}

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="توقف پاسخ"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:bg-white/10"
          >
            <Square className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!value.trim() || disabled}
            aria-label="ارسال پیام"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white shadow-signal-sm transition enabled:hover:brightness-110 disabled:opacity-35"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1 flex items-center justify-between px-1 text-[9px] text-slate-500">
        <span>
          <kbd className="rounded bg-white/5 px-1">Enter</kbd> ارسال ·{' '}
          <kbd className="rounded bg-white/5 px-1">Shift+Enter</kbd> خط جدید
        </span>
        <span>{toFaDigits(value.length)} / ۲۰۰۰</span>
      </p>
    </div>
  );
}

function DemoBadge() {
  return (
    <div className="pointer-events-none fixed bottom-2 end-2 z-30 hidden lg:block">
      <span className="rounded-full border border-white/10 bg-midnight-900/80 px-2 py-1 text-[9px] text-slate-500 backdrop-blur">
        DEMO · {PRODUCTS.length} products · {OBJECTIONS.length} objections
      </span>
    </div>
  );
}

/* ── card router ──────────────────────────────────────────────────────────── */

function CardRenderer({
  card,
  props,
  onSubmitImei,
}: {
  card: string;
  props: Record<string, unknown>;
  onSubmitImei: (imei: string) => void;
}) {
  switch (card) {
    case 'ProductComparisonCard':
      return (
        <ProductComparisonCard
          recommended={String(props.recommended ?? 'ani-pro')}
          reasonFa={String(props.reasonFa ?? '')}
          objectType={props.objectType ? String(props.objectType) : undefined}
          products={
            (props.products as Array<{
              id: string;
              nameFa: string;
              subtitleFa: string;
              priceFa: string;
              featuresFa: string[];
              bestForFa: string;
              badgeFa: string;
              accent: 'park' | 'pro';
            }>) ?? []
          }
        />
      );
    case 'ReportTicketCard':
      return (
        <ReportTicketCard
          trackingCode={String(props.trackingCode ?? '')}
          itemType={String(props.itemType ?? '')}
          createdAt={String(props.createdAt ?? new Date().toISOString())}
          status={String(props.status ?? 'submitted')}
          imeiMasked={props.imeiMasked ? String(props.imeiMasked) : null}
        />
      );
    case 'ImeiInputCard':
      return <ImeiInputCard onSubmit={onSubmitImei} />;
    case 'LookupResultCard':
      return (
        <LookupResultCard
          empty={Boolean(props.empty)}
          matches={
            (props.matches as Array<{
              id: string;
              itemType: string;
              descriptionMasked: string;
              heldAt: string;
              receivedAtFa: string;
              status: string;
            }>) ?? []
          }
        />
      );
    case 'ReceiptCard':
      return (
        <ReceiptCard
          trackingCode={String(props.trackingCode ?? '')}
          itemType={String(props.itemType ?? '')}
          area={props.area ? String(props.area) : undefined}
          createdAt={String(props.createdAt ?? new Date().toISOString())}
          url={String(props.url ?? '/')}
        />
      );
    case 'SecureCallCard':
      return (
        <SecureCallCard
          relayNumber={props.relayNumber ? String(props.relayNumber) : undefined}
          expiresAt={props.expiresAt ? String(props.expiresAt) : undefined}
          minutes={Number(props.minutes ?? 15)}
        />
      );
    case 'PostShipmentCard':
      return (
        <PostShipmentCard
          trackingCode={String(props.trackingCode ?? '')}
          status={String(props.status ?? 'requested')}
          createdAt={String(props.createdAt ?? new Date().toISOString())}
        />
      );
    case 'NewspaperQuoteCard':
      return (
        <NewspaperQuoteCard
          trackingCode={String(props.trackingCode ?? '')}
          totalFa={String(props.totalFa ?? '')}
          lines={(props.lines as Array<{ labelFa: string; amountFa: string }>) ?? []}
          explainFa={String(props.explainFa ?? '')}
          adText={String(props.adText ?? '')}
          publishDateFa={String(props.publishDateFa ?? '')}
          newspaperFa={String(props.newspaperFa ?? '')}
        />
      );
    case 'MemoryToast':
      return <MemoryToast text={String(props.text ?? '')} cleared={Boolean(props.cleared)} />;
    case 'TriageNote':
      return <TriageNote priority={Number(props.priority ?? 25)} reasonFa={String(props.reasonFa ?? '')} />;
    default:
      return null;
  }
}
