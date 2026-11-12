'use client';

import { Car, PackageSearch, ScanLine, type LucideIcon } from 'lucide-react';

import { toFaDigits } from '@/lib/validators';

/**
 * FlowRail — the slim right-hand rail (RTL start edge).
 * On mobile it becomes a horizontal chip strip above the composer.
 */

export type FlowKey = 'smart-tag' | 'lost-report' | 'found-report' | 'general';

interface FlowDef {
  key: FlowKey;
  labelFa: string;
  icon: LucideIcon;
  hintFa: string;
}

export const FLOWS: FlowDef[] = [
  { key: 'smart-tag', labelFa: 'خرید برچسب', icon: Car, hintFa: 'مشاوره آنی پارک و آنی پرو' },
  { key: 'lost-report', labelFa: 'اعلام مفقودی', icon: ScanLine, hintFa: 'IMEI و پیگیری پرونده' },
  { key: 'found-report', labelFa: 'پیداشده', icon: PackageSearch, hintFa: 'ثبت شیء پیدا شده' },
];

export function FlowRail({
  active,
  onSelect,
  ticketCount,
}: {
  active: FlowKey;
  onSelect: (flow: FlowKey) => void;
  ticketCount: number;
}) {
  return (
    <nav aria-label="مسیرهای گفتگو" className="flex flex-col gap-1.5">
      {FLOWS.map((flow) => {
        const isActive = active === flow.key;
        const Icon = flow.icon;
        return (
          <button
            key={flow.key}
            type="button"
            onClick={() => onSelect(flow.key)}
            aria-current={isActive ? 'true' : undefined}
            className={[
              'group flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition',
              isActive
                ? 'border-signal/50 bg-signal/10 text-white shadow-signal-sm'
                : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5',
            ].join(' ')}
          >
            <span
              className={[
                'grid size-8 shrink-0 place-items-center rounded-lg transition',
                isActive ? 'bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white' : 'bg-white/5 text-slate-300 group-hover:bg-white/10',
              ].join(' ')}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold leading-5">{flow.labelFa}</span>
              <span className="block truncate text-[9.5px] text-slate-400">{flow.hintFa}</span>
            </span>
          </button>
        );
      })}

      {ticketCount > 0 ? (
        <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] text-slate-400">پرونده‌های باز</p>
          <p className="text-[13px] font-bold text-signal">{toFaDigits(ticketCount)}</p>
        </div>
      ) : null}
    </nav>
  );
}
