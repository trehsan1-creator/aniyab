import Link from 'next/link';
import { WifiOff } from 'lucide-react';

import { BRAND } from '@/content/brand';

export const metadata = { title: 'بدون ارتباط' };

/** Offline fallback served by the service worker. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-midnight p-6" dir="rtl">
      <div className="max-w-sm rounded-2xl border border-white/10 bg-deep-900/60 p-6 text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white">
          <WifiOff className="size-5" aria-hidden />
        </span>
        <h1 className="text-[15px] font-bold text-white">ارتباط اینترنت قطع است</h1>
        <p className="mt-2 text-[11.5px] leading-6 text-slate-400">
          برای گفتگو با دستیار به اینترنت نیاز است. اگر کار فوری دارید، پشتیبانی{' '}
          {BRAND.hotlineHoursFa} روی {BRAND.hotlineFa} پاسخ می‌دهد.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-4 py-2 text-[12px] font-bold text-white shadow-signal"
        >
          تلاش دوباره
        </Link>
      </div>
    </main>
  );
}
