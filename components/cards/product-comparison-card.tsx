'use client';

import { motion } from 'framer-motion';
import { Check, ShoppingBag, Sparkles } from 'lucide-react';

import { BRAND } from '@/content/brand';
import { trackFunnel } from '@/lib/client/track';

/**
 * ProductComparisonCard — the consultation deliverable.
 * Side-by-side, recommended one highlighted with «برای شما مناسب‌تر».
 * The ONLY purchase path is the CTA to the shop; no order is taken here.
 */

interface ProductView {
  id: string;
  nameFa: string;
  subtitleFa: string;
  priceFa: string;
  featuresFa: string[];
  bestForFa: string;
  badgeFa: string;
  accent: 'park' | 'pro';
}

interface Props {
  recommended: string;
  reasonFa: string;
  objectType?: string;
  products: ProductView[];
}

export function ProductComparisonCard({ recommended, reasonFa, objectType, products }: Props) {
  const shopUrl = BRAND.shopUrl;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-deep-900/60 backdrop-blur"
      aria-label="مقایسه محصولات آنی‌یاب"
    >
      <header className="flex items-start gap-2 border-b border-white/10 bg-gradient-to-l from-signal/15 to-transparent px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white">پیشنهاد مشاور آنی‌یاب</p>
          <p className="mt-0.5 text-[12px] leading-6 text-slate-300">{reasonFa}</p>
          {objectType ? (
            <p className="mt-1 text-[11px] text-slate-400">برای: {objectType}</p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {products.map((product) => {
          const isRecommended = product.id === recommended;
          return (
            <article
              key={product.id}
              className={[
                'relative flex flex-col rounded-xl border p-3 transition',
                isRecommended
                  ? 'border-signal/60 bg-signal/[0.07] shadow-signal-sm'
                  : 'border-white/10 bg-white/[0.03]',
              ].join(' ')}
            >
              {isRecommended ? (
                <span className="absolute -top-2 start-3 rounded-full bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-2 py-0.5 text-[10px] font-bold text-white shadow-signal-sm">
                  برای شما مناسب‌تر
                </span>
              ) : null}

              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-white">{product.nameFa}</h3>
                <span className="text-[11px] text-slate-400">{product.badgeFa}</span>
              </div>
              <p className="mb-2 text-[11px] leading-5 text-slate-400">{product.subtitleFa}</p>
              <p className="mb-3 text-base font-extrabold text-signal">{product.priceFa}</p>

              <ul className="mb-3 space-y-1.5">
                {product.featuresFa.map((feature) => (
                  <li key={feature} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-slate-300">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-auto border-t border-white/5 pt-2 text-[11px] text-slate-400">
                مناسب برای: {product.bestForFa}
              </p>
            </article>
          );
        })}
      </div>

      <footer className="border-t border-white/10 p-3">
        <a
          href={shopUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackFunnel('shop_cta_click', { recommended })}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-4 py-2.5 text-[13px] font-bold text-white shadow-signal transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.99]"
        >
          <ShoppingBag className="size-4" aria-hidden />
          مشاهده و خرید در سایت آنی‌یاب
        </a>
        <p className="mt-2 text-center text-[10.5px] leading-5 text-slate-500">
          خرید و پرداخت فقط در سایت آنی‌یاب انجام می‌شود؛ دستیار سفارش ثبت نمی‌کند.
        </p>
      </footer>
    </motion.section>
  );
}
