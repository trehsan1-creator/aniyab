/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/pricing.ts — deterministic, fake-but-plausible newspaper ad pricing
 * ─────────────────────────────────────────────────────────────────────────────
 *  All numbers are demo values. Deterministic so a quote can be re-derived
 *  from the same inputs (needed for tests and for showing «چرا این عدد؟»).
 */

import { toFaDigits } from '@/lib/validators';

export const NEWSPAPERS = [
  { id: 'hamshahri', nameFa: 'همشهری', baseToman: 420_000, factor: 1 },
  { id: 'iran', nameFa: 'ایران', baseToman: 380_000, factor: 0.92 },
  { id: 'jamejam', nameFa: 'جام‌جم', baseToman: 350_000, factor: 0.86 },
  { id: 'kayhan', nameFa: 'کیهان', baseToman: 400_000, factor: 0.96 },
  { id: 'shargh', nameFa: 'شرق', baseToman: 360_000, factor: 0.88 },
] as const;

export type NewspaperId = (typeof NEWSPAPERS)[number]['id'];

export const DOC_TYPES = [
  { id: 'national-id', nameFa: 'کارت ملی', surcharge: 0 },
  { id: 'bank-card', nameFa: 'کارت بانکی', surcharge: 0 },
  { id: 'passport', nameFa: 'گذرنامه', surcharge: 60_000 },
  { id: 'phone', nameFa: 'گوشی موبایل', surcharge: 40_000 },
  { id: 'bag', nameFa: 'کیف / کوله', surcharge: 0 },
  { id: 'other', nameFa: 'سایر مدارک', surcharge: 0 },
] as const;

export type DocTypeId = (typeof DOC_TYPES)[number]['id'];

export const AD_SIZES = [
  { id: 'small', nameFa: 'تک‌ستون (۳ سانت)', units: 1, areaFactor: 1 },
  { id: 'medium', nameFa: 'دو ستون (۳ سانت)', units: 2, areaFactor: 1.8 },
  { id: 'large', nameFa: 'دو ستون (۶ سانت)', units: 2, areaFactor: 3.2 },
] as const;

export type AdSizeId = (typeof AD_SIZES)[number]['id'];

export interface PricingInput {
  newspaperId: NewspaperId;
  docTypeId: DocTypeId;
  sizeId: AdSizeId;
  /** 1–7 publication days. */
  days: number;
  /** Boost the ad with a highlighted box. */
  highlighted: boolean;
}

export interface PriceLine {
  labelFa: string;
  amountToman: number;
  amountFa: string;
}

export interface PriceQuote {
  lines: PriceLine[];
  subtotalToman: number;
  vatToman: number;
  totalToman: number;
  totalFa: string;
  /** Human-readable explanation of how the total was derived. */
  explainFa: string;
}

const VAT_RATE = 0.09;
const HIGHLIGHT_SURCHARGE = 120_000;

function faAmount(n: number): string {
  // Persian thousands separator «٬» (U+066C), matching the brand copy.
  return `${toFaDigits(Math.round(n).toLocaleString('en-US')).replace(/,/g, '٬')} تومان`;
}

/**
 * Computes a quote. Pure + deterministic: same input ⇒ same output, no Date,
 * no randomness.
 */
export function quoteNewspaperAd(input: PricingInput): PriceQuote {
  const newspaper = NEWSPAPERS.find((n) => n.id === input.newspaperId) ?? NEWSPAPERS[0];
  const doc = DOC_TYPES.find((d) => d.id === input.docTypeId) ?? DOC_TYPES[0];
  const size = AD_SIZES.find((s) => s.id === input.sizeId) ?? AD_SIZES[0];
  const days = Math.min(7, Math.max(1, Math.round(input.days)));

  const base = Math.round(newspaper.baseToman * newspaper.factor * size.areaFactor);
  const lines: PriceLine[] = [
    {
      labelFa: `آگهی ${size.nameFa} در ${newspaper.nameFa}`,
      amountToman: base,
      amountFa: faAmount(base),
    },
  ];

  if (doc.surcharge > 0) {
    lines.push({
      labelFa: `تعرفه ویژه ${doc.nameFa}`,
      amountToman: doc.surcharge,
      amountFa: faAmount(doc.surcharge),
    });
  }
  if (input.highlighted) {
    lines.push({
      labelFa: 'کادر برجسته (هایلایت)',
      amountToman: HIGHLIGHT_SURCHARGE,
      amountFa: faAmount(HIGHLIGHT_SURCHARGE),
    });
  }
  if (days > 1) {
    // Repeated days are cheaper per day: 85% for each extra day.
    let extra = 0;
    for (let d = 2; d <= days; d += 1) extra += Math.round(base * Math.pow(0.85, d - 1));
    lines.push({
      labelFa: `${toFaDigits(days - 1)} روز تکرار (هر روز ۸۵٪ روز قبل)`,
      amountToman: extra,
      amountFa: faAmount(extra),
    });
  }

  const subtotalToman = lines.reduce((sum, l) => sum + l.amountToman, 0);
  const vatToman = Math.round(subtotalToman * VAT_RATE);
  const totalToman = subtotalToman + vatToman;

  return {
    lines,
    subtotalToman,
    vatToman,
    totalToman,
    totalFa: faAmount(totalToman),
    explainFa:
      `مبلغ پایه ${newspaper.nameFa} برای ${size.nameFa}، ` +
      `به‌همراه ${toFaDigits(days)} روز انتشار و مالیات بر ارزش افزوده ${toFaDigits(9)}٪. ` +
      'این پیش‌فاکتور نمایشی است و پرداخت آنلاین ندارد.',
  };
}

/** Builds the ad text preview shown to the user before publishing. */
export function buildAdText(params: {
  docTypeId: DocTypeId;
  itemName: string;
  placeFa: string;
  contactFa?: string;
}): string {
  const doc = DOC_TYPES.find((d) => d.id === params.docTypeId) ?? DOC_TYPES[0];
  const contact = params.contactFa ?? 'از طریق آنی‌یاب';
  return [
    `اعلام مفقودی ${doc.nameFa}`,
    `شرح: ${params.itemName}`,
    `محل گم شدن: ${params.placeFa}`,
    `تحویل مدارک: دفاتر آنی‌یاب — تماس: ${contact}`,
    'در صورت یافتن، لطفاً به نزدیک‌ترین دفتر آنی‌یاب تحویل دهید.',
  ].join('\n');
}

/** Persian (Jalali) date, formatted for UI. */
const JALALI_DATE = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const JALALI_DATE_TIME = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Normalises anything date-ish into a valid Date.
 * Jalali strings such as «۱۴۰۴/۰۸/۲۵» are parsed by hand (Intl would throw a
 * RangeError on them) and converted with a day-count approximation.
 */
function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  const raw = value.trim();

  // Jalali: ۱۴۰۴/۰۸/۲۵ or 1404-08-25
  const jalali = raw
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .match(/^(1[34]\d{2})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (jalali) {
    const [, y, m, d] = jalali;
    return new Date(fromJalali(Number(y), Number(m), Number(d)));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Gregorian epoch ms for a Jalali date (no external dependency). */
function fromJalali(year: number, month: number, day: number): number {
  // Algorithm by Kazimierz M. Borkowski, valid for 1178–1633 Jalali.
  let jy = year + 1595;
  let days =
    -355668 +
    365 * jy +
    ~~(jy / 33) * 8 +
    ~~(((jy % 33) + 3) / 4) +
    day +
    (month < 7 ? (month - 1) * 31 : (month - 7) * 30 + 186);

  let gy = 400 * ~~(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * ~~(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += ~~((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  for (gm = 1; gm <= 12; gm += 1) {
    if (gd <= monthDays[gm]!) break;
    gd -= monthDays[gm]!;
  }
  return Date.UTC(gy, gm - 1, gd);
}

export function jalaliDate(d: Date | string | number): string {
  return JALALI_DATE.format(toDate(d));
}

/** Persian date + time. */
export function jalaliDateTime(d: Date | string | number): string {
  return JALALI_DATE_TIME.format(toDate(d));
}

/** Persian date is complete — pure month/Day display stays Persian for the UI. */
export function isoNow(): string {
  return new Date().toISOString();
}
