'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  LogOut,
  MessageSquare,
  Radio,
  RefreshCw,
  Ticket,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';

import { jalaliDateTime } from '@/lib/pricing';
import { toFaDigits } from '@/lib/validators';

/**
 * AdminDashboard — "Customer-360 Live".
 * Polls /api/admin/snapshot every 2s (works on Vercel without a websocket) and
 * highlights rows that changed since the previous poll, so a message sent from a
 * phone visibly lands on the projector within ~2s.
 */

interface CustomerRow {
  id: string;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  city: string | null;
  visit_count: number;
  last_seen_at: string;
}

interface MemoryRow {
  id: string;
  customer_id: string;
  kind: string;
  key: string;
  value: string;
  confidence: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  served_by: string | null;
  latency_ms: number | null;
}

interface ConsultationRow {
  id: string;
  customer_id: string;
  object_type: string | null;
  recommended_product: string | null;
  objections: string[];
  stage: string;
  created_at: string;
}

interface LostRow {
  id: string;
  tracking_code: string;
  customer_id: string | null;
  item_type: string;
  status: string;
  created_at: string;
}

interface FoundRow {
  id: string;
  tracking_code: string;
  reporter_customer_id: string | null;
  item_type: string;
  status: string;
  created_at: string;
}

interface EventRow {
  id: string;
  customer_id: string | null;
  type: string;
  created_at: string;
}

interface Kpis {
  activeChats: number;
  ticketsToday: number;
  hotLeads: number;
  returningRate: number;
  avgLatency: number;
  interest: { park: number; pro: number };
  objections: Array<[string, number]>;
  funnel: { chats: number; consultations: number; shopClicks: number };
}

interface Snapshot {
  ok: boolean;
  receivedAt: string;
  realtime: boolean;
  source: 'supabase' | 'memory';
  customers: CustomerRow[];
  memories: MemoryRow[];
  messages: MessageRow[];
  consultations: ConsultationRow[];
  lostReports: LostRow[];
  foundReports: FoundRow[];
  events: EventRow[];
  kpis: Kpis;
}

const KIND_FA: Record<string, string> = {
  fact: 'واقعیت',
  preference: 'ترجیح',
  item: 'شیء',
  event: 'رویداد',
  concern: 'دغدغه',
};

const PRODUCT_FA: Record<string, string> = { 'ani-park': 'آنی پارک', 'ani-pro': 'آنی پرو' };

export function AdminDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const previousIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/snapshot', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error('snapshot failed');
      const data = (await res.json()) as Snapshot;
      setSnapshot(data);
      setError(null);

      // highlight rows that are new since the last poll
      const ids = new Set<string>([
        ...data.messages.map((m) => m.id),
        ...data.lostReports.map((r) => r.id),
        ...data.foundReports.map((r) => r.id),
      ]);
      const added = new Set<string>();
      for (const id of ids) if (!previousIds.current.has(id)) added.add(id);
      previousIds.current = ids;
      if (added.size && previousIds.current.size > added.size) setFresh(added);
      setTimeout(() => setFresh(new Set()), 2600);
    } catch {
      setError('دریافت داده ناموفق بود؛ تلاش مجدد…');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const selectedCustomer = useMemo(
    () => snapshot?.customers.find((c) => c.id === selected) ?? null,
    [selected, snapshot],
  );

  const customerMemories = useMemo(
    () => (snapshot && selected ? snapshot.memories.filter((m) => m.customer_id === selected) : []),
    [selected, snapshot],
  );
  const customerConsult = useMemo(
    () => (snapshot && selected ? snapshot.consultations.filter((c) => c.customer_id === selected) : []),
    [selected, snapshot],
  );
  const customerTickets = useMemo(
    () =>
      snapshot && selected
        ? [
            ...snapshot.lostReports.filter((r) => r.customer_id === selected),
            ...snapshot.foundReports.filter((r) => r.reporter_customer_id === selected),
          ]
        : [],
    [selected, snapshot],
  );

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  }

  return (
    <main dir="rtl" className="min-h-[100dvh] bg-midnight text-slate-100">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-midnight/85 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-[12px] font-extrabold text-white">
            آ
          </span>
          <div>
            <h1 className="text-[13px] font-bold leading-4">داشبورد زندهٔ آنی‌یاب</h1>
            <p className="flex items-center gap-1 text-[9.5px] text-slate-400">
              <Radio className="size-2.5 animate-pulse text-emerald-400" aria-hidden />
              {snapshot ? (snapshot.source === 'supabase' ? 'Supabase Realtime' : 'حافظهٔ موقت (بدون Supabase)') : 'در حال اتصال…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {snapshot ? (
            <span className="hidden text-[10px] text-slate-500 sm:block">
              آخرین به‌روزرسانی: {jalaliDateTime(snapshot.receivedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10.5px] text-slate-300 hover:bg-white/10"
          >
            <RefreshCw className="size-3" aria-hidden /> به‌روزرسانی
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[10.5px] text-slate-400 hover:text-rose-300"
          >
            <LogOut className="size-3" aria-hidden /> خروج
          </button>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          <AlertTriangle className="size-3.5" aria-hidden /> {error}
        </div>
      ) : null}

      {!snapshot ? (
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {/* KPI strip */}
          <section aria-label="شاخص‌ها" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={MessageSquare} labelFa="گفتگوی فعال" value={snapshot.kpis.activeChats} />
            <Kpi icon={Ticket} labelFa="تیکت امروز" value={snapshot.kpis.ticketsToday} />
            <Kpi icon={Zap} labelFa="سرنخ گرم" value={snapshot.kpis.hotLeads} accent />
            <Kpi icon={Users} labelFa="نرخ بازگشت" value={`${toFaDigits(snapshot.kpis.returningRate)}٪`} />
            <Kpi icon={Activity} labelFa="میانگین پاسخ" value={`${toFaDigits(snapshot.kpis.avgLatency)}ms`} />
          </section>

          <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
            {/* live feed */}
            <section
              aria-label="فید زنده"
              className="rounded-xl border border-white/10 bg-deep-900/50 p-3"
            >
              <h2 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-white">
                <Radio className="size-3.5 animate-pulse text-emerald-400" aria-hidden /> فید زنده
              </h2>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {snapshot.messages.slice(0, 9).map((m) => {
                    const customer = snapshot.customers.find((c) =>
                      snapshot.consultations.some((x) => x.customer_id === c.id),
                    );
                    void customer;
                    return (
                      <motion.li
                        key={m.id}
                        initial={fresh.has(m.id) ? { opacity: 0, x: 14, backgroundColor: 'rgba(255,122,0,0.14)' } : false}
                        animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(255,255,255,0.03)' }}
                        transition={{ duration: 0.45 }}
                        className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                      >
                        <span
                          className={[
                            'mt-1 size-1.5 shrink-0 rounded-full',
                            m.role === 'user' ? 'bg-signal' : 'bg-emerald-400',
                          ].join(' ')}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] text-slate-200">
                            <span className="text-slate-500">{m.role === 'user' ? 'کاربر' : 'دستیار'}: </span>
                            {m.content.slice(0, 90)}
                          </p>
                          <p className="text-[9px] text-slate-500">
                            {jalaliDateTime(m.created_at)}
                            {m.served_by ? ` · ${m.served_by}` : ''}
                            {m.latency_ms ? ` · ${toFaDigits(m.latency_ms)}ms` : ''}
                          </p>
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
                {snapshot.messages.length === 0 ? (
                  <li className="py-6 text-center text-[11px] text-slate-500">
                    هنوز پیامی نیست — از موبایل یک پیام بفرستید.
                  </li>
                ) : null}
              </ul>
            </section>

            {/* sales insights */}
            <section aria-label="بینش فروش" className="rounded-xl border border-white/10 bg-deep-900/50 p-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-white">
                <TrendingUp className="size-3.5 text-signal" aria-hidden /> بینش فروش
              </h2>

              <InterestBar park={snapshot.kpis.interest.park} pro={snapshot.kpis.interest.pro} />

              <div className="mt-3">
                <p className="mb-1 text-[10px] text-slate-500">پرتکرارترین تردیدها</p>
                {snapshot.kpis.objections.length ? (
                  <ul className="space-y-1">
                    {snapshot.kpis.objections.map(([id, count]) => (
                      <li key={id} className="flex items-center justify-between text-[10.5px]">
                        <span className="text-slate-300">{objectionFa(id)}</span>
                        <span className="rounded bg-white/5 px-1.5 text-slate-400">{toFaDigits(count)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10.5px] text-slate-500">هنوز تردیدی ثبت نشده.</p>
                )}
              </div>

              <div className="mt-3 border-t border-white/10 pt-2">
                <p className="mb-1 text-[10px] text-slate-500">قیف</p>
                <div className="space-y-1">
                  <FunnelRow labelFa="گفتگو" value={snapshot.kpis.funnel.chats} max={snapshot.kpis.funnel.chats} />
                  <FunnelRow
                    labelFa="مشاوره"
                    value={snapshot.kpis.funnel.consultations}
                    max={snapshot.kpis.funnel.chats}
                  />
                  <FunnelRow labelFa="کلیک خرید" value={snapshot.kpis.funnel.shopClicks} max={snapshot.kpis.funnel.chats} />
                </div>
              </div>
            </section>
          </div>

          {/* customers */}
          <section aria-label="مشتریان" className="rounded-xl border border-white/10 bg-deep-900/50">
            <h2 className="border-b border-white/10 px-3 py-2 text-[11.5px] font-semibold text-white">
              مشتریان ({toFaDigits(snapshot.customers.length)})
            </h2>
            <div className="max-h-[340px] overflow-y-auto">
              <table className="w-full text-start">
                <thead className="sticky top-0 bg-midnight-800/95 text-[9.5px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 text-start font-medium">نام</th>
                    <th className="px-3 py-1.5 text-start font-medium">موبایل</th>
                    <th className="px-3 py-1.5 text-start font-medium">شهر</th>
                    <th className="px-3 py-1.5 text-start font-medium">بازدید</th>
                    <th className="px-3 py-1.5 text-start font-medium">حافظه</th>
                    <th className="px-3 py-1.5 text-start font-medium">آخرین فعالیت</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.customers.slice(0, 40).map((c) => {
                    const memoryCount = snapshot.memories.filter((m) => m.customer_id === c.id).length;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelected(c.id)}
                        className="cursor-pointer border-t border-white/5 text-[11px] transition hover:bg-white/[0.04]"
                      >
                        <td className="px-3 py-1.5 font-medium text-white">
                          {c.preferred_name ?? c.full_name ?? 'مهمان'}
                        </td>
                        <td dir="ltr" className="px-3 py-1.5 text-start font-mono text-slate-400">
                          {c.phone ? toFaDigits(c.phone) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400">{c.city ?? '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{toFaDigits(c.visit_count)}</td>
                        <td className="px-3 py-1.5">
                          {memoryCount > 0 ? (
                            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] text-emerald-300">
                              {toFaDigits(memoryCount)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-slate-500">
                          {jalaliDateTime(c.last_seen_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Customer-360 drawer */}
      <AnimatePresence>
        {selectedCustomer ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setSelected(null)}
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-y-0 start-0 flex w-full max-w-md flex-col overflow-y-auto border-e border-white/10 bg-midnight-800 p-4"
              role="dialog"
              aria-label="پرونده مشتری"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-[14px] font-bold text-white">
                    {selectedCustomer.preferred_name ?? selectedCustomer.full_name ?? 'مهمان'}
                  </p>
                  <p className="text-[10.5px] text-slate-400">
                    {selectedCustomer.city ?? '—'} ·{' '}
                    {selectedCustomer.phone ? toFaDigits(selectedCustomer.phone) : 'بدون شماره'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {toFaDigits(selectedCustomer.visit_count)} بازدید · آخرین:{' '}
                    {jalaliDateTime(selectedCustomer.last_seen_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1 text-slate-400 hover:text-white"
                  aria-label="بستن"
                >
                  <X className="size-4" />
                </button>
              </div>

              <section className="mb-3">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                  <Brain className="size-3 text-signal" aria-hidden /> حافظه
                </h3>
                {customerMemories.length ? (
                  <ul className="space-y-1">
                    {customerMemories.map((m) => (
                      <li key={m.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9.5px] text-slate-500">{KIND_FA[m.kind] ?? m.kind}</span>
                          <span className="text-[9px] text-slate-500">
                            اطمینان {toFaDigits(Math.round(m.confidence * 100))}٪
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-200">{m.value}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10.5px] text-slate-500">حافظه‌ای ثبت نشده.</p>
                )}
              </section>

              {customerConsult.length ? (
                <section className="mb-3">
                  <h3 className="mb-1.5 text-[11px] font-semibold text-slate-300">مشاورهٔ برچسب</h3>
                  {customerConsult.map((c) => (
                    <div key={c.id} className="rounded-lg border border-signal/25 bg-signal/[0.06] px-2 py-1.5">
                      <p className="text-[11px] text-white">
                        {c.object_type ?? '—'} → {PRODUCT_FA[c.recommended_product ?? ''] ?? '—'}
                      </p>
                      <p className="text-[9.5px] text-slate-400">
                        مرحله: {stageFa(c.stage)} · تردیدها: {(c.objections ?? []).map(objectionFa).join('، ') || '—'}
                      </p>
                    </div>
                  ))}
                </section>
              ) : null}

              {customerTickets.length ? (
                <section className="mb-3">
                  <h3 className="mb-1.5 text-[11px] font-semibold text-slate-300">پرونده‌ها</h3>
                  <ul className="space-y-1">
                    {customerTickets.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5"
                      >
                        <span dir="ltr" className="font-mono text-[10.5px] text-slate-200">
                          {toFaDigits(t.tracking_code)}
                        </span>
                        <span className="text-[10px] text-slate-400">{t.item_type}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="mt-auto rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-2.5">
                <p className="text-[10px] font-semibold text-emerald-200">اقدام پیشنهادی بعدی</p>
                <p className="mt-0.5 text-[11px] leading-5 text-emerald-50">{nextBestAction(statusOf(selectedCustomer))}</p>
              </section>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Kpi({
  icon: Icon,
  labelFa,
  value,
  accent,
}: {
  icon: typeof Users;
  labelFa: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-xl border p-2.5',
        accent ? 'border-signal/30 bg-signal/[0.08]' : 'border-white/10 bg-deep-900/50',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{labelFa}</span>
        <Icon className={`size-3.5 ${accent ? 'text-signal' : 'text-slate-500'}`} aria-hidden />
      </div>
      <p className={`mt-1 text-[17px] font-extrabold leading-6 ${accent ? 'text-signal' : 'text-white'}`}>
        {typeof value === 'number' ? toFaDigits(value) : value}
      </p>
    </div>
  );
}

function InterestBar({ park, pro }: { park: number; pro: number }) {
  const total = park + pro;
  const proPct = total ? Math.round((pro / total) * 100) : 50;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="text-slate-300">آنی پارک {toFaDigits(park)}</span>
        <span className="text-signal">آنی پرو {toFaDigits(pro)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`علاقه: پارک ${park}، پرو ${pro}`}>
        <span className="bg-deep-400" style={{ width: `${100 - proPct}%` }} />
        <span className="bg-gradient-to-l from-[#FF7A00] to-[#f05327]" style={{ width: `${proPct}%` }} />
      </div>
    </div>
  );
}

function FunnelRow({ labelFa, value, max }: { labelFa: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] text-slate-400">{labelFa}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
        <span className="block h-full rounded-full bg-gradient-to-l from-[#FF7A00] to-[#f05327]" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-6 shrink-0 text-end text-[10px] text-slate-300">{toFaDigits(value)}</span>
    </div>
  );
}

function objectionFa(id: string): string {
  const map: Record<string, string> = {
    price: 'قیمت',
    privacy: 'حریم خصوصی',
    durability: 'دوام',
    'dishonest-finder': 'یابندهٔ ناراست',
    'secure-call': 'تماس امن',
    'pets-kids': 'حیوان/کودک',
    'other-cities': 'ارسال شهرستان',
    difference: 'تفاوت محصول',
  };
  return map[id] ?? id;
}

function stageFa(stage: string): string {
  const map: Record<string, string> = {
    discovery: 'کشف نیاز',
    recommended: 'پیشنهاد داده شد',
    objection: 'در حال رفع تردید',
    cta_shown: 'CTA نمایش داده شد',
    clicked: 'کلیک خرید',
  };
  return map[stage] ?? stage;
}

function statusOf(customer: CustomerRow): 'prospect' | 'ticketed' | 'returning' {
  if (customer.visit_count > 2) return 'returning';
  if (customer.visit_count > 1) return 'ticketed';
  return 'prospect';
}

function nextBestAction(status: 'prospect' | 'ticketed' | 'returning'): string {
  switch (status) {
    case 'returning':
      return 'پیگیری گرم: تماس شخصی برای بستن مشاورهٔ برچسب و یادآوری تیکت باز.';
    case 'ticketed':
      return 'ارسال وضعیت تیکت + پیشنهاد مشاوره برای شیء دوم.';
    default:
      return 'پیام خوش‌آمدگویی با پیشنهاد مسیر خرید برچسب و بررسی نیاز.';
  }
}
