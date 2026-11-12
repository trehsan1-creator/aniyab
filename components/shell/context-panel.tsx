'use client';

import { Brain, ChevronLeft, Cpu, Sparkles, Ticket } from 'lucide-react';

import type { MetaState, ToolState, UiCardState } from '@/lib/client/use-agent-stream';
import { toFaDigits } from '@/lib/validators';

/**
 * ContextPanel — the left column (RTL end edge).
 * Shows what the system knows and what it just did: memory chips, active
 * tickets, the consultation recommendation, and the Laya pipeline (X-Ray).
 */

export interface ContextChip {
  id: string;
  labelFa: string;
  tone: 'info' | 'warn' | 'success';
}

export function ContextPanel({
  chips,
  cards,
  tools,
  meta,
  greeting,
  xray,
}: {
  chips: ContextChip[];
  cards: UiCardState[];
  tools: ToolState[];
  meta: MetaState | null;
  greeting: string | null;
  xray: boolean;
}) {
  const ticketCard = cards.find((c) => c.card === 'ReportTicketCard');
  const productCard = cards.find((c) => c.card === 'ProductComparisonCard');

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pe-1">
      {greeting ? (
        <section className="rounded-xl border border-signal/25 bg-signal/[0.07] p-3">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-signal">
            <Sparkles className="size-3" aria-hidden />
            خوش برگشتی
          </p>
          <p className="mt-1 text-[11.5px] leading-6 text-slate-200">{greeting}</p>
        </section>
      ) : null}

      {chips.length > 0 ? (
        <section aria-label="وضعیت پرونده‌ها" className="space-y-1.5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">وضعیت شما</h2>
          {chips.map((chip) => (
            <div
              key={chip.id}
              className={[
                'flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-5',
                chip.tone === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-100'
                  : chip.tone === 'warn'
                    ? 'border-signal/30 bg-signal/[0.08] text-amber-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-200',
              ].join(' ')}
            >
              <Ticket className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden />
              <span>{chip.labelFa}</span>
            </div>
          ))}
        </section>
      ) : null}

      {ticketCard ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] text-slate-500">آخرین پرونده</p>
          <p dir="ltr" className="mt-0.5 font-mono text-[12px] tracking-wider text-white">
            {toFaDigits(String(ticketCard.props.trackingCode ?? ''))}
          </p>
          <p className="mt-1 text-[11px] text-slate-300">{String(ticketCard.props.itemType ?? '')}</p>
        </section>
      ) : null}

      {productCard ? (
        <section className="rounded-xl border border-signal/25 bg-signal/[0.06] p-3">
          <p className="text-[10px] text-slate-400">پیشنهاد مشاور</p>
          <p className="mt-0.5 text-[12.5px] font-bold text-white">
            {productCard.props.recommended === 'ani-pro' ? 'آنی پرو' : 'آنی پارک'}
          </p>
          <p className="mt-1 text-[10.5px] leading-5 text-slate-300">{String(productCard.props.reasonFa ?? '')}</p>
        </section>
      ) : null}

      {tools.length > 0 ? (
        <section aria-label="ابزارهای اجراشده" className="space-y-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">اقدام‌ها</h2>
          {tools.map((tool) => (
            <div key={tool.id} className="flex items-start gap-1.5 text-[10.5px] leading-5">
              <span
                className={[
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  tool.status === 'ok' ? 'bg-emerald-400' : tool.status === 'error' ? 'bg-rose-400' : 'bg-signal animate-pulse',
                ].join(' ')}
                aria-hidden
              />
              <span className={tool.status === 'error' ? 'text-rose-200' : 'text-slate-300'}>
                {tool.summaryFa ?? tool.labelFa}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {meta?.memory.saved ? (
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-2.5">
          <p className="flex items-center gap-1.5 text-[10.5px] text-emerald-100">
            <Brain className="size-3" aria-hidden />
            {toFaDigits(meta.memory.saved)} نکته جدید به حافظه اضافه شد
          </p>
        </section>
      ) : null}

      {xray && meta ? (
        <section aria-label="X-Ray" className="rounded-xl border border-white/10 bg-midnight-900/70 p-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
            <Cpu className="size-3" aria-hidden /> X-Ray
          </p>
          <dl className="mt-1.5 space-y-1 text-[10px]">
            <Row label="Laya" value={`${meta.laya.mode} · ${meta.laya.status}`} />
            <Row label="ارائه‌دهنده" value={meta.servedBy} />
            <Row label="مدل" value={meta.model.split('/').slice(-1)[0] ?? meta.model} />
            <Row label="گام‌ها" value={toFaDigits(meta.hops)} />
            <Row label="زمان" value={`${toFaDigits(meta.latencyMs)}ms`} />
          </dl>
          {meta.trace?.length ? (
            <ul className="mt-2 space-y-0.5 border-t border-white/10 pt-1.5">
              {meta.trace.map((step) => (
                <li key={step.step} className="flex items-center justify-between gap-1 text-[9.5px] text-slate-400">
                  <span className="truncate">{step.labelFa}</span>
                  <span className="shrink-0 font-mono">{toFaDigits(step.ms)}ms</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-mono text-slate-200">{value}</dd>
    </div>
  );
}

export function LayaMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[9.5px] text-slate-500">
      <ChevronLeft className="size-2.5" aria-hidden />
      Powered by Laya.Studio
    </span>
  );
}
