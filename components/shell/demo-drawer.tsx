'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  FastForward,
  Gauge,
  Loader2,
  RotateCcw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';

import { toFaDigits } from '@/lib/validators';

/**
 * DemoDrawer — the operator's cockpit (`?demo=1`).
 * Visible to the presenter, never part of the customer experience.
 *
 *  • persona switcher (نیلوفر / رضا / سارا) — rebinds the device identity so the
 *    "returning customer" moment can be reproduced in one click
 *  • fast-forward — pushes an existing ticket forward in the timeline
 *  • reset — wipes local state for the next run of the script
 */

export interface DemoPersona {
  key: string;
  labelFa: string;
  hintFa: string;
  /** Device id used as the anonymous identity for this persona. */
  deviceId: string;
  accent: string;
}

export const DEMO_PERSONA_LIST: DemoPersona[] = [
  {
    key: 'niloufar',
    labelFa: 'نیلوفر احمدی',
    hintFa: 'مشتری بازگشتی · تیکت در بررسی · مشاورهٔ کیف لپ‌تاپ',
    deviceId: 'demo-niloufar',
    accent: 'from-[#FF7A00] to-[#f05327]',
  },
  {
    key: 'reza',
    labelFa: 'رضا کریمی',
    hintFa: 'یابنده · کیف چرمی تحویل‌داده‌شده',
    deviceId: 'demo-reza',
    accent: 'from-emerald-500 to-teal-500',
  },
  {
    key: 'sara',
    labelFa: 'سارا محمدی',
    hintFa: 'سرنخ تازه · اولین بازدید',
    deviceId: 'demo-sara',
    accent: 'from-sky-500 to-indigo-500',
  },
];

export function DemoDrawer({
  open,
  onClose,
  activeDeviceId,
  onSwitchPersona,
  onReset,
  onFastForward,
  currentVisit,
  scripted,
  onToggleScripted,
}: {
  open: boolean;
  onClose: () => void;
  activeDeviceId: string;
  onSwitchPersona: (deviceId: string) => void;
  onReset: () => void;
  onFastForward: () => Promise<string>;
  currentVisit: number;
  scripted: boolean;
  onToggleScripted: (next: boolean) => void;
}) {
  const [ffBusy, setFfBusy] = useState(false);
  const [ffNote, setFfNote] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  async function fastForward() {
    setFfBusy(true);
    setFfNote(null);
    try {
      setFfNote(await onFastForward());
    } catch {
      setFfNote('تیکتی برای جلو بردن پیدا نشد.');
    } finally {
      setFfBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="کنسول دمو"
            className="absolute inset-y-0 start-0 flex w-full max-w-sm flex-col gap-3 overflow-y-auto border-e border-white/10 bg-midnight-800 p-4"
          >
            <header className="flex items-start justify-between">
              <div>
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-white">
                  <Gauge className="size-4 text-signal" aria-hidden /> کنسول دمو
                </h2>
                <p className="text-[10px] text-slate-400">
                  نمایش {toFaDigits(currentVisit)} بازدید · مخصوص ارائه‌دهنده
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
                aria-label="بستن"
              >
                <X className="size-4" />
              </button>
            </header>

            {/* personas */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-slate-300">
                <UserRound className="size-3" aria-hidden /> پرسونا
              </h3>
              <ul className="space-y-1.5">
                {DEMO_PERSONA_LIST.map((persona) => {
                  const active = persona.deviceId === activeDeviceId;
                  return (
                    <li key={persona.key}>
                      <button
                        type="button"
                        onClick={() => onSwitchPersona(persona.deviceId)}
                        className={[
                          'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-start transition',
                          active
                            ? 'border-signal/50 bg-signal/[0.1]'
                            : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                        ].join(' ')}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-l ${persona.accent} text-[10px] font-bold text-white`}
                        >
                          {persona.labelFa.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11.5px] font-semibold text-white">{persona.labelFa}</span>
                          <span className="block truncate text-[9.5px] text-slate-400">{persona.hintFa}</span>
                        </span>
                        {active ? <Check className="size-3.5 shrink-0 text-signal" aria-hidden /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* scripted mode */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={scripted}
                  onChange={(e) => onToggleScripted(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-signal"
                />
                <span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                    <Sparkles className="size-3 text-signal" aria-hidden /> حالت نمایشی (scripted)
                  </span>
                  <span className="block text-[9.5px] leading-4 text-slate-500">
                    پاسخ‌های ثابت برای وقتی که شبکه یا سهمیهٔ مدل قطع است.
                  </span>
                </span>
              </label>
            </section>

            {/* actions */}
            <section className="space-y-1.5">
              <button
                type="button"
                onClick={() => void fastForward()}
                disabled={ffBusy}
                className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-slate-200 hover:bg-white/[0.07] disabled:opacity-50"
              >
                {ffBusy ? (
                  <Loader2 className="size-3.5 animate-spin text-signal" aria-hidden />
                ) : (
                  <FastForward className="size-3.5 text-signal" aria-hidden />
                )}
                جلو بردن تایم‌لاین تیکت
              </button>
              {ffNote ? <p className="px-1 text-[9.5px] leading-4 text-emerald-300">{ffNote}</p> : null}

              <button
                type="button"
                onClick={() => {
                  if (!resetArmed) {
                    setResetArmed(true);
                    return;
                  }
                  onReset();
                  setResetArmed(false);
                  setFfNote(null);
                }}
                className={[
                  'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] transition',
                  resetArmed
                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]',
                ].join(' ')}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {resetArmed ? 'برای پاک کردن دوباره بزن' : 'ریست کامل پرسونا'}
              </button>
            </section>

            <footer className="mt-auto rounded-lg border border-white/10 bg-midnight-900/60 p-2 text-[9px] leading-5 text-slate-500">
              همهٔ داده‌ها ساختگی است (<span dir="ltr">is_demo = true</span>). پس از پایان ارائه،
              پرسونا را ریست کنید تا اجرای بعدی از صفر شروع شود.
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
