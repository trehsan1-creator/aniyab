import type { Metadata } from 'next';
import Link from 'next/link';

import { BRAND } from '@/content/brand';
import { getFoundReportByCode } from '@/lib/db/store';
import { toFaDigits } from '@/lib/validators';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  app/f/[code]/page.tsx — the public page behind a found report's QR code
 * ─────────────────────────────────────────────────────────────────────────────
 *  The receipt card has always printed `/f/AN-F-…` and encoded it in a QR code,
 *  but this route did not exist, so every receipt pointed at a 404. That is the
 *  worst kind of bug in a lost-and-found product: the finder scans the code,
 *  gets nothing, and the owner never hears about the item.
 *
 *  What this page may show: the item kind, where it was found, when, and its
 *  status. What it must never show: `description_private` — those marks are the
 *  only thing separating a real owner from anyone who picked up the object.
 *  They stay on the server and are compared against a claim instead.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { code: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return {
    title: `شیء پیداشده ${params.code}`,
    // A found report must not end up in search results: it names a place and a
    // time, which is enough for someone to show up and claim the object.
    robots: { index: false, follow: false },
  };
}

const STATUS_FA: Record<string, string> = {
  registered: 'ثبت شده — در انتظار ادعای مالکیت',
  matched: 'مالک شناسایی شد',
  claimed: 'به مالک تحویل شد',
  archived: 'بایگانی شده',
};

export default async function FoundItemPage({ params }: PageProps) {
  const report = await getFoundReportByCode(decodeURIComponent(params.code));

  if (!report) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold text-slate-100">این کد پیدا نشد</h1>
        <p className="text-sm leading-6 text-slate-400">
          کد رهگیری را دوباره بررسی کن. اگر شیء را پیدا کرده‌ای و هنوز ثبتش نکرده‌ای، می‌توانی همین
          حالا در گفتگو با دستیار آنی‌یاب ثبتش کنی تا رسید و کد رهگیری بگیری.
        </p>
        <Related />
        <p className="text-xs text-slate-500">پشتیبانی {BRAND.hotlineFa}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6 py-10">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/80">
          مرکز ملی گمشده‌ها و پیدا‌شده‌های آنی‌یاب
        </p>
        <h1 className="text-xl font-semibold text-slate-50">این شیء پیدا شده است</h1>
        <p className="text-[13px] leading-6 text-slate-400">
          اگر این شیء مال شماست، پیش از هر اقدامی مشخصاتش را برای پشتیبانی بگو تا مالکیت تأیید شود.
          مشخصات خصوصی این شیء روی این صفحه نمایش داده نمی‌شود.
        </p>
      </header>

      <dl className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.03] px-4">
        <Row label="کد رهگیری" value={report.tracking_code} mono />
        <Row label="نوع شیء" value={report.item_type} />
        <Row label="محل پیدا شدن" value={report.area ?? 'اعلام نشده'} />
        <Row label="وضعیت" value={STATUS_FA[report.status] ?? report.status} />
        <Row
          label="ویژگی‌های تأییدکننده"
          value={
            report.hasPrivateMarks
              ? 'ثبت شده — برای تأیید مالکیت با پشتیبانی تماس بگیر'
              : 'ثبت نشده — تأیید مالکیت با پرسش حضوری انجام می‌شود'
          }
        />
      </dl>

      <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
        <p className="text-[12.5px] leading-6 text-emerald-100">
          این شیء تحویل دفتر آنی‌یاب شده است. برای دریافت، کد رهگیری{' '}
          <span dir="ltr" className="font-mono">
            {report.tracking_code}
          </span>{' '}
          را به پشتیبانی بگو.
        </p>
      </section>

      <Related />
      <p className="text-center text-xs text-slate-500">پشتیبانی {toFaDigits(BRAND.hotlineFa ?? '')}</p>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[12px] text-slate-400">{label}</dt>
      <dd className={`text-[12.5px] text-slate-100 ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

function Related() {
  return (
    <Link
      href="/"
      className="rounded-lg border border-white/15 px-4 py-2 text-center text-[12.5px] text-slate-200 transition hover:bg-white/5"
    >
      گفتگو با دستیار آنی‌یاب
    </Link>
  );
}
