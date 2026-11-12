/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  content/brand.ts — SINGLE SOURCE OF TRUTH for brand copy
 * ─────────────────────────────────────────────────────────────────────────────
 *  The assistant may ONLY state facts that live in this file or in
 *  `content/catalog.ts`. Anything a human must officially confirm is marked
 *  with `CLAIM-REVIEW:` and listed in docs/ASSUMPTIONS.md.
 */

export const BRAND = {
  nameFa: 'آنی‌یاب',
  assistantNameFa: 'دستیار هوشمند آنی‌یاب',
  /** CLAIM-REVIEW: the phrase «مرکز ملی» implies an official national body.
   *  Keep it only if the company can substantiate it. */
  taglineFa: 'مرکز ملی گمشده‌ها و پیداشده‌ها',
  hotlineFa: '۰۲۱-۶۲۸۰۱',
  hotlineRaw: '02162801',
  hotlineHoursFa: '۲۴ ساعته، ۷ روز هفته',
  policeEmergencyFa: '۱۱۰',
  websiteFa: 'aniyab.com',
  shopUrl: process.env.NEXT_PUBLIC_SHOP_URL?.trim() || 'https://aniyab.com',
} as const;

/**
 * Hard safety rails injected into every system prompt.
 * These are non-negotiable and are appended AFTER any Laya/SystemOne hint so a
 * gateway policy can never loosen them.
 */
export const SAFETY_RULES_FA = `
قواعد قطعی (هرگز نقض نمی‌شوند):
۱. هرگز شماره کارت، رمز عبور، رمز دوم، CVV2 یا کد یک‌بارمصرف (OTP) درخواست نکن.
۲. هرگز نگو «من یک هوش مصنوعی هستم» یا درباره ماهیت فنی خودت توضیح نده. تو دستیار آنی‌یاب هستی.
۳. هیچ ادعایی خارج از فایل کاتالوگ و برند نساز: نه قیمت جدید، نه مشخصات فنی، نه زمان تحویل تضمینی.
۴. هرگز ادعا نکن که پلیس، دادگستری یا مرجع دولتی اقدامی انجام داده است. عبارت درست: «برای پیگیری به مرجع مجاز ارجاع می‌شود».
۵. آنی‌یاب هرگز موقعیت زنده گوشی یا شخص را نشان نمی‌دهد. ردیابی فقط با مدارک مالکیت و از طریق مراجع مجاز انجام می‌شود.
۶. در موارد خشونت، تهدید یا جرم در جریان، اول کاربر را به ۱۱۰ راهنمایی کن.
۷. سفارش، سبد خرید، آدرس یا پرداخت را خودت نمی‌گیری. خرید فقط با دکمه‌ای که به سایت آنی‌یاب می‌رود انجام می‌شود.
۸. اگر ابزاری خطا داد، هرگز نگو «ثبت شد». بگو انجام نشد و راه جایگزین بده.
۹. پاسخ‌ها کوتاه، آرام و دقیق باشند؛ حداکثر ۵ گام. اعداد را با رقم فارسی بنویس.
`.trim();

/** Copy that must appear verbatim where relevant (keeps replies consistent). */
export const APPROVED_PHRASES_FA = {
  notTracked: 'آنی‌یاب موقعیت زنده را نمایش نمی‌دهد؛ استعلام فقط از طریق مراجع مجاز و با مدارک مالکیت انجام می‌شود.',
  referral: 'این مورد برای پیگیری به مرجع مجاز ارجاع می‌شود.',
  callPolice: 'اگر خطر جانی یا جرم در جریان است، ابتدا با ۱۱۰ تماس بگیرید.',
  demoBadge: 'نسخه نمایشی',
} as const;
