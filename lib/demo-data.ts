/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/demo-data.ts — deterministic demo fixtures (isomorphic, no server-only)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Used by:
 *    • lib/db/memory-store.ts  → boot seed so the ephemeral demo is never empty
 *    • scripts/seed.ts          → same rows into Supabase
 *    • scripts/reset-demo.ts    → restore the scripted state between runs
 *
 *  Everything here is fake. Phones live in the 0912-000-00xx range and national
 *  IDs are checksum-valid numbers generated for the demo only.
 */

export const DEMO_PEPPER = 'aniyab-demo-pepper-v1';

/** The three national IDs that exist in the registry pool (checksum-valid). */
export const DEMO_NATIONAL_IDS = ['0499370899', '0084575948', '0013542419'] as const;

/** IMEI used across the demo (Luhn-valid). */
export const DEMO_IMEI = '356938035643809';

export interface DemoPersona {
  key: 'niloufar' | 'reza' | 'sara';
  fullName: string;
  preferredName: string;
  phone: string;
  city: string;
  visits: number;
  memories: Array<{ kind: 'fact' | 'preference' | 'item' | 'event' | 'concern'; key: string; value: string; confidence: number }>;
  consultation?: {
    objectType: string;
    product: 'ani-park' | 'ani-pro';
    objections: string[];
    stage: 'discovery' | 'recommended' | 'objection' | 'cta_shown' | 'clicked';
  };
  lostReport?: {
    itemType: string;
    imei: string;
    brandModel: string;
    place: string;
    status: 'submitted' | 'referred' | 'reviewing' | 'matched' | 'delivered';
    minutesAgo: number;
  };
  foundReport?: {
    itemType: string;
    kind: 'qr' | 'serial';
    identifier: string;
    area: string;
  };
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    key: 'niloufar',
    fullName: 'نیلوفر احمدی',
    preferredName: 'نیلوفر',
    phone: '09120000011',
    city: 'تهران',
    visits: 3,
    memories: [
      { kind: 'fact', key: 'city', value: 'تهران، سعادت‌آباد', confidence: 0.9 },
      { kind: 'item', key: 'object_of_interest', value: 'کیف لپ‌تاپ ۱۵ اینچی', confidence: 0.85 },
      { kind: 'preference', key: 'product_interest', value: 'آنی پرو', confidence: 0.8 },
      { kind: 'concern', key: 'privacy_concern', value: 'نگران نمایش شماره موبایل به یابنده است', confidence: 0.75 },
      { kind: 'event', key: 'last_lost_report', value: 'گوشی سامسونگ — در حال بررسی', confidence: 0.95 },
    ],
    consultation: {
      objectType: 'کیف لپ‌تاپ',
      product: 'ani-pro',
      objections: ['price', 'privacy'],
      stage: 'recommended',
    },
    lostReport: {
      itemType: 'گوشی موبایل',
      imei: DEMO_IMEI,
      brandModel: 'سامسونگ Galaxy S23',
      place: 'مترو ونک',
      status: 'reviewing',
      minutesAgo: 6,
    },
  },
  {
    key: 'reza',
    fullName: 'رضا کریمی',
    preferredName: 'رضا',
    phone: '09120000022',
    city: 'کرج',
    visits: 2,
    memories: [
      { kind: 'fact', key: 'city', value: 'کرج', confidence: 0.85 },
      { kind: 'event', key: 'found_bag', value: 'کیف چرمی پیدا کرد و تحویل داد', confidence: 0.9 },
      { kind: 'preference', key: 'contact_channel', value: 'ترجیح می‌دهد پیامک بگیرد', confidence: 0.6 },
    ],
    foundReport: {
      itemType: 'کیف چرمی مشکی',
      kind: 'serial',
      identifier: 'BAG-8842-TH',
      area: 'پارک لاله، تهران',
    },
  },
  {
    key: 'sara',
    fullName: 'سارا محمدی',
    preferredName: 'سارا',
    phone: '09120000033',
    city: 'اصفهان',
    visits: 1,
    memories: [
      { kind: 'item', key: 'object_of_interest', value: 'قلاده سگ کوچک', confidence: 0.8 },
      { kind: 'concern', key: 'pet_safety', value: 'نگران گم شدن سگ در پیاده‌روی روزانه', confidence: 0.7 },
    ],
    consultation: {
      objectType: 'قلاده حیوان خانگی',
      product: 'ani-pro',
      objections: ['pets-kids'],
      stage: 'discovery',
    },
  },
];

/** Extra customers so the admin dashboard looks alive. */
export const DEMO_EXTRA_CUSTOMERS: Array<{ fullName: string; preferredName: string; phone: string; city: string }> = [
  { fullName: 'مهدی رضایی', preferredName: 'مهدی', phone: '09120000044', city: 'شیراز' },
  { fullName: 'فاطمه حسینی', preferredName: 'فاطمه', phone: '09120000055', city: 'مشهد' },
  { fullName: 'امیر تهرانی', preferredName: 'امیر', phone: '09120000066', city: 'تهران' },
  { fullName: 'زهرا نوری', preferredName: 'زهرا', phone: '09120000077', city: 'تبریز' },
  { fullName: 'حسین صادقی', preferredName: 'حسین', phone: '09120000088', city: 'رشت' },
  { fullName: 'مریم اکبری', preferredName: 'مریم', phone: '09120000099', city: 'کرمان' },
  { fullName: 'علی موسوی', preferredName: 'علی', phone: '09120000111', city: 'اهواز' },
  { fullName: 'نرگس شریفی', preferredName: 'نرگس', phone: '09120000122', city: 'یزد' },
  { fullName: 'بهرام جعفری', preferredName: 'بهرام', phone: '09120000133', city: 'قزوین' },
];

export const DEMO_OFFICES = ['ولیعصر', 'شهرک غرب', 'تجریش', 'نارمک', 'ونک', 'سعادت‌آباد'] as const;

export const DEMO_REGISTRY_ITEMS: Array<{ itemType: string; descriptionMasked: string }> = [
  { itemType: 'کارت ملی', descriptionMasked: 'کارت ملی با نام م.ر (پوشانده)' },
  { itemType: 'کارت بانکی', descriptionMasked: 'کارت بانکی بانک ملت (۴ رقم آخر ۳۲۱۸)' },
  { itemType: 'گذرنامه', descriptionMasked: 'گذرنامه با شماره پوشانده' },
  { itemType: 'کیف', descriptionMasked: 'کیف دستی چرم قهوه‌ای با کارت‌های شناسایی' },
  { itemType: 'گوشی', descriptionMasked: 'گوشی سامسونگ با قاب شفاف و خط‌خوردگی گوشه' },
  { itemType: 'کلید', descriptionMasked: 'دسته‌کلید با برچسب پارکینگ' },
  { itemType: 'عینک', descriptionMasked: 'عینک طبی قاب فلزی در کیف چرمی' },
  { itemType: 'کارت بیمه', descriptionMasked: 'کارت بیمه درمانی (نام پوشانده)' },
];

/** SHA-256(`${pepper}:${nationalId}`) — Web Crypto, so it works everywhere. */
export async function hashNationalId(
  nationalId: string,
  pepper: string = DEMO_PEPPER,
): Promise<string> {
  const data = new TextEncoder().encode(`${pepper}:${nationalId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
