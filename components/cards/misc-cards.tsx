'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BadgeCheck,
  Building2,
  Check,
  Copy,
  Info,
  MapPin,
  PackageCheck,
  PhoneCall,
  QrCode,
  Receipt,
  SearchX,
  ShieldAlert,
} from 'lucide-react';

import { jalaliDate } from '@/lib/pricing';
import { toFaDigits } from '@/lib/validators';

/* ─────────────────────────────────────────────────────────────────────────────
   LookupResultCard — masked registry matches
   ───────────────────────────────────────────────────────────────────────────── */

interface LookupMatch {
  id: string;
  itemType: string;
  descriptionMasked: string;
  heldAt: string;
  receivedAtFa: string;
  status: string;
}

export function LookupResultCard({ matches, empty }: { matches: LookupMatch[]; empty: boolean }) {
  if (empty || matches.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full rounded-2xl border border-white/10 bg-deep-900/60 p-4 text-center backdrop-blur"
        aria-label="نتیجه استعلام"
      >
        <SearchX className="mx-auto mb-2 size-7 text-slate-500" aria-hidden />
        <p className="text-[13px] font-semibold text-white">موردی با این کد ملی در دفاتر نیست</p>
        <p className="mt-1 text-[11.5px] leading-6 text-slate-400">
          می‌توانید همین حالا اعلام مفقودی ثبت کنید تا در صورت تحویل به دفاتر، به شما اطلاع داده شود.
        </p>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 backdrop-blur"
      aria-label="نتیجه استعلام"
    >
      <header className="flex items-center gap-2 border-b border-white/10 bg-emerald-500/10 px-4 py-3">
        <BadgeCheck className="size-4 text-emerald-400" aria-hidden />
        <p className="text-[12.5px] font-semibold text-white">
          {toFaDigits(matches.length)} مورد متعلق به شما پیدا شد
        </p>
      </header>
      <ul className="divide-y divide-white/5">
        {matches.map((m) => (
          <li key={m.id} className="p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-semibold text-white">{m.itemType}</p>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                {m.status === 'held' ? 'در نگهداری' : m.status}
              </span>
            </div>
            <p className="text-[11.5px] leading-6 text-slate-300">{m.descriptionMasked}</p>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px] text-slate-400">
              <span className="flex items-center gap-1">
                <Building2 className="size-3" aria-hidden /> {m.heldAt}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden /> دریافت: {m.receivedAtFa}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <footer className="border-t border-white/10 bg-white/[0.02] px-4 py-2.5">
        <p className="flex items-start gap-1.5 text-[10.5px] leading-5 text-slate-400">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          جزئیات کامل فقط با احراز هویت حضوری و ارائه مدارک مالکیت تحویل داده می‌شود.
        </p>
      </footer>
    </motion.section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   ReceiptCard — found-item receipt with QR
   ───────────────────────────────────────────────────────────────────────────── */

export function ReceiptCard({
  trackingCode,
  itemType,
  area,
  createdAt,
  url,
}: {
  trackingCode: string;
  itemType: string;
  area?: string;
  createdAt: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(
          `${typeof window !== 'undefined' ? window.location.origin : ''}${url}`,
          { margin: 1, width: 220, color: { dark: '#0B1A26', light: '#FFFFFF' } },
        );
        if (!cancelled) setQr(dataUrl);
      } catch {
        if (!cancelled) setQr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* blocked */
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 backdrop-blur"
      aria-label="رسید ثبت شیء پیداشده"
    >
      <header className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <Receipt className="size-4 text-signal" aria-hidden />
        <p className="text-[12.5px] font-semibold text-white">رسید ثبت شیء پیداشده</p>
      </header>

      <div className="flex items-center gap-4 p-4">
        <div className="grid size-[92px] shrink-0 place-items-center rounded-xl bg-white p-1.5">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, no optimisation needed
            <img src={qr} alt={`کد QR پیگیری ${trackingCode}`} className="size-full rounded" />
          ) : (
            <QrCode className="size-8 text-midnight-700" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-slate-400">کد پیگیری</p>
          <button
            type="button"
            onClick={copy}
            className="mt-0.5 flex items-center gap-1.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            aria-label="کپی کد پیگیری"
          >
            <span dir="ltr" className="font-mono text-[15px] font-bold tracking-wider text-white">
              {toFaDigits(trackingCode)}
            </span>
            {copied ? <Check className="size-3.5 text-emerald-400" aria-hidden /> : <Copy className="size-3.5 text-slate-500" aria-hidden />}
          </button>
          <p className="mt-2 text-[11.5px] text-slate-300">{itemType}</p>
          <p className="text-[10.5px] text-slate-500">
            {area ? `${area} · ` : ''}
            {jalaliDate(createdAt)}
          </p>
        </div>
      </div>

      <footer className="border-t border-white/10 px-4 py-2.5">
        <p className="text-[10.5px] leading-5 text-slate-400">
          این QR را روی شیء بچسبانید؛ یابنده با اسکن آن می‌تواند بی‌نام با شما تماس بگیرد.
        </p>
      </footer>
    </motion.section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SecureCallCard — relay number + live countdown
   ───────────────────────────────────────────────────────────────────────────── */

export function SecureCallCard({
  relayNumber,
  expiresAt,
  minutes = 15,
}: {
  relayNumber?: string;
  expiresAt?: string;
  minutes?: number;
}) {
  const deadline = useMemo(
    () => (expiresAt ? new Date(expiresAt).getTime() : Date.now() + minutes * 60_000),
    [expiresAt, minutes],
  );
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const expired = remaining <= 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 p-4 backdrop-blur"
      aria-label="تماس امن"
    >
      <div className="mb-3 flex items-center gap-2">
        <PhoneCall className="size-4 text-emerald-400" aria-hidden />
        <p className="text-[12.5px] font-semibold text-white">تماس امن بی‌نام</p>
      </div>

      <div
        className={[
          'rounded-xl border p-3 text-center',
          expired ? 'border-white/10 bg-white/[0.02]' : 'border-emerald-500/30 bg-emerald-500/[0.07]',
        ].join(' ')}
      >
        <p className="text-[10.5px] text-slate-400">شماره واسط موقت</p>
        <p dir="ltr" className={`mt-1 font-mono text-lg font-bold tracking-widest ${expired ? 'text-slate-500 line-through' : 'text-emerald-300'}`}>
          {relayNumber ? toFaDigits(relayNumber) : 'در حال ساخت…'}
        </p>
        <p className={`mt-1 text-[11px] ${expired ? 'text-rose-300' : 'text-slate-300'}`}>
          {expired
            ? 'اعتبار این شماره تمام شد'
            : `اعتبار باقی‌مانده: ${toFaDigits(String(mm).padStart(2, '0'))}:${toFaDigits(String(ss).padStart(2, '0'))}`}
        </p>
      </div>

      <p className="mt-3 text-[10.5px] leading-5 text-slate-400">
        یابنده و مالک هیچ‌وقت شماره واقعی یکدیگر را نمی‌بینند؛ بعد از پایان اعتبار، شماره باطل می‌شود.
      </p>
    </motion.section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PostShipmentCard
   ───────────────────────────────────────────────────────────────────────────── */

const POST_STEPS = ['requested', 'picked_up', 'in_transit', 'delivered'] as const;
const POST_LABELS: Record<string, string> = {
  requested: 'درخواست ثبت شد',
  picked_up: 'تحویل به پیک',
  in_transit: 'در مسیر',
  delivered: 'تحویل شد',
};

export function PostShipmentCard({
  trackingCode,
  status,
  createdAt,
}: {
  trackingCode: string;
  status: string;
  createdAt: string;
}) {
  const index = Math.max(0, POST_STEPS.indexOf(status as (typeof POST_STEPS)[number]));
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl border border-white/10 bg-deep-900/60 p-4 backdrop-blur"
      aria-label="درخواست پست یافته"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PackageCheck className="size-4 text-signal" aria-hidden />
          <p className="text-[12.5px] font-semibold text-white">پست یافته</p>
        </div>
        <span dir="ltr" className="font-mono text-[11px] tracking-wider text-slate-300">
          {toFaDigits(trackingCode)}
        </span>
      </div>

      <ol className="flex items-center gap-1" aria-label="مراحل ارسال">
        {POST_STEPS.map((step, i) => (
          <li key={step} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={[
                'h-1.5 w-full rounded-full',
                i <= index ? 'bg-gradient-to-l from-[#FF7A00] to-[#f05327]' : 'bg-white/10',
              ].join(' ')}
              aria-hidden
            />
            <span className={`text-center text-[9.5px] ${i <= index ? 'text-slate-200' : 'text-slate-500'}`}>
              {POST_LABELS[step]}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10.5px] text-slate-500">ثبت: {jalaliDate(createdAt)}</p>
    </motion.section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   NewspaperQuoteCard — price breakdown + ad preview
   ───────────────────────────────────────────────────────────────────────────── */

export function NewspaperQuoteCard({
  trackingCode,
  totalFa,
  lines,
  explainFa,
  adText,
  publishDateFa,
  newspaperFa,
}: {
  trackingCode: string;
  totalFa: string;
  lines: Array<{ labelFa: string; amountFa: string }>;
  explainFa: string;
  adText: string;
  publishDateFa: string;
  newspaperFa: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 backdrop-blur"
      aria-label="پیش‌فاکتور آگهی روزنامه"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="text-[12.5px] font-semibold text-white">پیش‌فاکتور آگهی</p>
        <span dir="ltr" className="font-mono text-[11px] tracking-wider text-slate-300">
          {toFaDigits(trackingCode)}
        </span>
      </header>

      <div className="p-4">
        <p className="mb-3 text-[11px] text-slate-400">
          {newspaperFa} · تاریخ انتشار: {publishDateFa}
        </p>

        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li key={line.labelFa} className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="text-slate-300">{line.labelFa}</span>
              <span className="shrink-0 font-medium text-white">{line.amountFa}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
          <span className="text-[12px] font-semibold text-slate-200">مبلغ نهایی (با مالیات)</span>
          <span className="text-base font-extrabold text-signal">{totalFa}</span>
        </div>

        <p className="mt-2 text-[10.5px] leading-5 text-slate-500">{explainFa}</p>

        <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <summary className="cursor-pointer text-[11.5px] font-medium text-slate-200">
            پیش‌نمایش متن آگهی
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-peyda text-[11px] leading-6 text-slate-300">
            {adText}
          </pre>
        </details>
      </div>

      <footer className="border-t border-white/10 px-4 py-2.5">
        <p className="text-[10.5px] text-slate-400">
          این پیش‌فاکتور نمایشی است؛ دستیار پرداخت انجام نمی‌دهد.برای نهایی‌کردن با پشتیبانی تماس بگیرید.
        </p>
      </footer>
    </motion.section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MemoryToast
   ───────────────────────────────────────────────────────────────────────────── */

export function MemoryToast({ text, cleared }: { text: string; cleared?: boolean }) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2"
      aria-live="polite"
    >
      <Info className={`size-3.5 shrink-0 ${cleared ? 'text-rose-300' : 'text-emerald-400'}`} aria-hidden />
      <p className="text-[11px] text-emerald-100">
        {cleared ? text : `برای دفعه بعد یادم می‌مونه: ${text}`}
      </p>
    </motion.aside>
  );
}

/**
 * TriageNote — Laya's priority verdict for a lost report.
 *
 * A card, not a tooltip: the customer is told what happens next, and the same
 * number is what the admin queue sorts on. Shown after `create_lost_report`.
 */
export function TriageNote({ priority, reasonFa }: { priority: number; reasonFa: string }) {
  // priority is 0..25, lower = look first (see triageTicket in laya-decisions).
  const urgent = priority <= 5;
  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        'flex w-full items-start gap-2 rounded-xl border px-3 py-2',
        urgent
          ? 'border-rose-400/30 bg-rose-500/[0.08]'
          : 'border-white/10 bg-white/[0.04]',
      ].join(' ')}
      aria-live="polite"
    >
      <ShieldAlert
        className={`mt-0.5 size-3.5 shrink-0 ${urgent ? 'text-rose-300' : 'text-slate-400'}`}
        aria-hidden
      />
      <div className="space-y-0.5">
        <p className={`text-[11px] font-semibold ${urgent ? 'text-rose-100' : 'text-slate-200'}`}>
          {urgent ? 'پرونده در اولویت بررسی قرار گرفت' : 'پرونده ثبت و اولویت‌بندی شد'}
        </p>
        <p className="text-[10.5px] leading-5 text-slate-400">{reasonFa}</p>
      </div>
    </motion.aside>
  );
}
