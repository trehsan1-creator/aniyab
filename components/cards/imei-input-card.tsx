'use client';

import { useId, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Hash, Loader2, ScanLine } from 'lucide-react';

import { toFaDigits, validateImei } from '@/lib/validators';

/**
 * ImeiInputCard — collects the IMEI with LIVE Luhn validation.
 * UI-driven form: it calls the tool endpoint directly, so the demo does not
 * depend on the model parsing a 15-digit number out of prose.
 */

interface Props {
  onSubmit?: (imei: string) => Promise<void> | void;
  disabled?: boolean;
}

export function ImeiInputCard({ onSubmit, disabled }: Props) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const result = validateImei(value);
  const showError = touched && value.length > 0 && !result.ok;
  const showOk = result.ok;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!result.ok || !onSubmit) return;
    setBusy(true);
    try {
      await onSubmit(result.value!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl border border-white/10 bg-deep-900/60 p-4 backdrop-blur"
      aria-label="ورود کد IMEI"
    >
      <div className="mb-3 flex items-center gap-2">
        <ScanLine className="size-4 text-signal" aria-hidden />
        <h3 className="text-[13px] font-semibold text-white">کد IMEI گوشی</h3>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={inputId} className="mb-1.5 block text-[11.5px] text-slate-300">
          کد ۱۵ رقمی IMEI را وارد کنید
        </label>

        <div
          className={[
            'flex items-center gap-2 rounded-xl border bg-midnight-800/80 px-3 py-2.5 transition',
            showError
              ? 'border-rose-500/60'
              : showOk
                ? 'border-emerald-500/60'
                : 'border-white/12 focus-within:border-signal/60',
          ].join(' ')}
        >
          <Hash className="size-4 shrink-0 text-slate-500" aria-hidden />
          <input
            id={inputId}
            // Numeric keypad on mobile; we normalise Persian digits ourselves.
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            value={value}
            disabled={disabled || busy}
            onChange={(e) => setValue(e.target.value.slice(0, 24))}
            onBlur={() => setTouched(true)}
            placeholder="۳۵۶۹۳۸۰۳۵۶۴۳۸۰۹"
            aria-invalid={showError}
            aria-describedby={`${inputId}-hint`}
            className="w-full bg-transparent text-center font-mono text-[15px] tracking-[0.18em] text-white placeholder:text-slate-600 focus:outline-none"
          />
          {showOk ? <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-hidden /> : null}
        </div>

        <div id={`${inputId}-hint`} className="mt-2 min-h-[1.25rem]">
          {showError ? (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-5 text-rose-300" role="alert">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {result.messageFa}
            </p>
          ) : showOk ? (
            <p className="text-[11.5px] leading-5 text-emerald-300">کد معتبر است ✓</p>
          ) : (
            <p className="text-[11px] leading-5 text-slate-400">
              کد را با شماره‌گیری <span className="font-mono text-signal">*#۰۶#</span> یا روی جعبه دستگاه
              ببینید.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!result.ok || busy || disabled}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-4 py-2.5 text-[13px] font-bold text-white shadow-signal transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'در حال بررسی…' : 'ادامه و ثبت اعلام مفقودی'}
        </button>

        <p className="mt-2 text-center text-[10.5px] text-slate-500">
          {value.length > 0 ? `${toFaDigits(value.replace(/\D/g, '').length)} از ۱۵ رقم` : '۱۵ رقم'}
        </p>
      </form>
    </motion.section>
  );
}
