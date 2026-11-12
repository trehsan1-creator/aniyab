/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  content/catalog.ts — SINGLE SOURCE OF TRUTH for products & pricing
 * ─────────────────────────────────────────────────────────────────────────────
 *  The model may quote ONLY these facts. `CLAIM-REVIEW:` marks specs a human
 *  must verify before this goes public.
 */

export interface Product {
  id: 'ani-park' | 'ani-pro';
  nameFa: string;
  subtitleFa: string;
  priceToman: number;
  /** Persian-digit price, ready for the UI. */
  priceFa: string;
  /** CLAIM-REVIEW: every bullet below must be confirmed by the product team. */
  featuresFa: string[];
  bestForFa: string;
  badgeFa: string;
  accent: 'park' | 'pro';
}

export const PRODUCTS: readonly Product[] = [
  {
    id: 'ani-park',
    nameFa: 'آنی پارک',
    subtitleFa: 'برچسب هوشمند خودرو و پارکینگ',
    priceToman: 349_000,
    priceFa: '۳۴۹٬۰۰۰ تومان',
    featuresFa: [
      'چسب مخصوص شیشه خودرو، مقاوم به حرارت',
      'اسکن QR بدون نیاز به اپلیکیشن',
      'تماس بی‌نام و امن با صاحب خودرو',
      'اعلان لحظه‌ای اسکن در صفحه شخصی',
    ],
    bestForFa: 'خودرو، پارکینگ عمومی، برچسب پشت شیشه',
    badgeFa: 'مقرون‌به‌صرفه',
    accent: 'park',
  },
  {
    id: 'ani-pro',
    nameFa: 'آنی پرو',
    subtitleFa: 'برچسب همه‌کاره برای کیف، لپ‌تاپ، چمدان و حیوان خانگی',
    priceToman: 694_000,
    priceFa: '۶۹۴٬۰۰۰ تومان',
    featuresFa: [
      'QR اختصاصی با صفحه گزارش گم‌شدن',
      'تماس امن بی‌نام برای یابنده',
      'اعلان اسکن با موقعیت تقریبی منطقه',
      'بدنه مقاوم به آب‌پاش و ضربه روزمره',
      'مناسب کیف لپ‌تاپ، ساک ورزشی، چمدان و قلاده',
    ],
    bestForFa: 'کیف لپ‌تاپ، چمدان، ساک باشگاه، قلاده حیوان خانگی',
    badgeFa: 'پیشنهاد مشاور',
    accent: 'pro',
  },
];

/** Product ids the assistant is allowed to recommend. */
export type ProductId = Product['id'];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Deterministic lookup text the model can quote verbatim. */
export function catalogForPrompt(): string {
  return PRODUCTS.map(
    (p) =>
      `• ${p.nameFa} (${p.id}) — ${p.priceFa}\n  برای: ${p.bestForFa}\n  ویژگی‌ها: ${p.featuresFa.join('؛ ')}`,
  ).join('\n');
}
