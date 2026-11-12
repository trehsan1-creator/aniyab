'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, Copy, FileCheck, Loader2 } from 'lucide-react';

import { deriveStatusIndex, REPORT_STEPS, STEP_ORDER, statusFa } from '@/lib/status';
import { jalaliDateTime } from '@/lib/pricing';
import { toFaDigits } from '@/lib/validators';

/**
 * ReportTicketCard — the artefact that makes a simulated report feel real.
 * The timeline advances on read (derived from created_at), so no cron is used.
 * This is a client component; REPORT_STEPS is a plain const, safe to import.
 */

interface Props {
  trackingCode: string;
  itemType: string;
  createdAt: string;
  status: string;
  imeiMasked?: string | null;
}

export function ReportTicketCard({ trackingCode, itemType, createdAt, status, imeiMasked }: Props) {
  const [copied, setCopied] = useState(false);
  const [liveStatus, setLiveStatus] = useState(status);

  // Re-derive on the client so a ticket visibly "moves" while the demo runs.
  useEffect(() => {
    const compute = () => {
      const index = deriveStatusIndex(createdAt, status);
      setLiveStatus(STEP_ORDER[index] ?? status);
    };
    compute();
    const timer = setInterval(compute, 20_000);
    return () => clearInterval(timer);
  }, [createdAt, status]);

  const activeIndex = Math.max(0, STEP_ORDER.indexOf(liveStatus as never));

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(trackingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 backdrop-blur"
      aria-label={`تیکت پیگیری ${trackingCode}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center gap-2">
          <FileCheck className="size-4 text-emerald-400" aria-hidden />
          <div>
            <p className="text-[12.5px] font-semibold text-white">اعلام مفقودی ثبت شد</p>
            <p className="text-[11px] text-slate-400">{itemType}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
          aria-label="کپی کد پیگیری"
        >
          <span dir="ltr" className="font-mono tracking-wider">
            {toFaDigits(trackingCode)}
          </span>
          {copied ? <Check className="size-3 text-emerald-400" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        </button>
      </header>

      <div className="p-4">
        <ol className="relative space-y-3 ps-5" aria-label="مراحل پیگیری">
          {/* vertical rail */}
          <span className="absolute inset-y-1 start-1.5 w-px bg-white/10" aria-hidden />
          {REPORT_STEPS.map((step, index) => {
            const done = index < activeIndex;
            const current = index === activeIndex;
            return (
              <li key={step.key} className="relative">
                <span
                  className={[
                    'absolute -start-[1.125rem] top-0.5 grid size-3.5 place-items-center rounded-full ring-2',
                    done
                      ? 'bg-emerald-400 ring-emerald-400/25'
                      : current
                        ? 'bg-signal ring-signal/30'
                        : 'bg-slate-600 ring-transparent',
                  ].join(' ')}
                  aria-hidden
                >
                  {done ? <Check className="size-2 text-midnight-900" /> : null}
                  {current ? <span className="absolute size-3.5 animate-pulse-ring rounded-full bg-signal/40" /> : null}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={[
                      'text-[12px]',
                      done ? 'text-slate-300' : current ? 'font-semibold text-white' : 'text-slate-500',
                    ].join(' ')}
                  >
                    {step.labelFa}
                  </p>
                  {current ? (
                    <span className="flex items-center gap-1 rounded-full bg-signal/15 px-1.5 py-0.5 text-[10px] text-signal">
                      <Loader2 className="size-2.5 animate-spin" aria-hidden />
                      جاری
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 text-[11px]">
          <div>
            <dt className="text-slate-500">تاریخ ثبت</dt>
            <dd className="text-slate-200">{jalaliDateTime(createdAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">وضعیت</dt>
            <dd className="font-semibold text-signal">{statusFa(liveStatus)}</dd>
          </div>
          {imeiMasked ? (
            <div>
              <dt className="text-slate-500">IMEI</dt>
              <dd dir="ltr" className="font-mono text-slate-200">{imeiMasked}</dd>
            </div>
          ) : null}
        </dl>

        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-white/[0.03] p-2 text-[10.5px] leading-5 text-slate-400">
          <Clock className="mt-0.5 size-3 shrink-0 text-slate-500" aria-hidden />
          آنی‌یاب موقعیت زنده را نمایش نمی‌دهد؛ استعلام فقط از طریق مراجع مجاز و با مدارک مالکیت انجام
          می‌شود.
        </p>
      </div>
    </motion.section>
  );
}
