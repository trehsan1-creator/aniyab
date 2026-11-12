/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  content/objections.fa.ts — approved objection-handling answers
 * ─────────────────────────────────────────────────────────────────────────────
 *  Keeps the sales advisor consistent and safe. The model is told to prefer
 *  these answers; the UI can also show them as quick replies.
 */

export interface Objection {
  id: string;
  /** Short label used by the advisor + quick replies. */
  labelFa: string;
  /** Approved answer — the only wording the assistant should use. */
  answerFa: string;
  keywords: string[];
}

export const OBJECTIONS: readonly Objection[] = [
  {
    id: 'price',
    labelFa: 'قیمت بالاست',
    answerFa:
      'قیمت آنی پارک ۳۴۹٬۰۰۰ تومان و آنی پرو ۶۹۴٬۰۰۰ تومان است؛ یک‌بار خرید و بدون اشتراک ماهانه. اگر فقط برای خودرو می‌خواهید، آنی پارک کافی است و تفاوت قیمت را نمی‌پردازید.',
    keywords: ['گران', 'قیمت', 'هزینه', 'ارزان', 'بودجه'],
  },
  {
    id: 'privacy',
    labelFa: 'شماره‌ام لو می‌رود؟',
    answerFa:
      'نه. یابنده فقط QR را اسکن می‌کند و از طریق شماره واسط با شما تماس می‌گیرد؛ شماره واقعی شما و یابنده هیچ‌وقت به هم نمایش داده نمی‌شود.',
    keywords: ['شماره', 'حریم', 'خصوصی', 'لو', 'افشا', 'ناشناس'],
  },
  {
    id: 'durability',
    labelFa: 'چقدر دوام دارد؟',
    answerFa:
      'آنی پارک با چسب مخصوص شیشه خودرو نصب می‌شود و به حرارت و شست‌وشو مقاوم است. آنی پرو بدنه مقاوم به آب‌پاش و ضربه روزمره دارد؛ برای باران و استفاده روزمره مناسب است. اگر محل نصب خاصی دارید بگویید تا راهنمایی کنم.',
    keywords: ['دوام', 'خراب', 'آب', 'باران', 'شکستن', 'مقاوم'],
  },
  {
    id: 'dishonest-finder',
    labelFa: 'اگر یابنده صادق نبود؟',
    answerFa:
      'برای تحویل، احراز هویت و مدرک مالکیت لازم است. اگر موردی مشکوک بود، از طریق پشتیبانی ۲۴ ساعته ۰۲۱-۶۲۸۰۱ پیگیری می‌شود و در موارد جرم، موضوع به مرجع مجاز ارجاع می‌شود.',
    keywords: ['دزد', 'صادق', 'اعتماد', 'کلاهبرداری', 'بدزدد'],
  },
  {
    id: 'secure-call',
    labelFa: 'تماس امن چطور کار می‌کند؟',
    answerFa:
      'یابنده QR را اسکن می‌کند و دکمه «تماس امن» را می‌زند؛ سیستم یک شماره واسط می‌سازد که مثلاً ۱۵ دقیقه اعتبار دارد. هر دو طرف بی‌نام صحبت می‌کنند و بعد از پایان، شماره باطل می‌شود.',
    keywords: ['تماس امن', 'واسط', 'چطور کار', 'اعتبار'],
  },
  {
    id: 'pets-kids',
    labelFa: 'برای حیوان یا کیف بچه مناسب است؟',
    answerFa:
      'بله، آنی پرو برای قلاده حیوان خانگی، کیف مدرسه و ساک ورزشی طراحی شده. وزن سبکی دارد و روی قلاده یا دسته کیف می‌نشیند.',
    keywords: ['حیوان', 'سگ', 'گربه', 'قلاده', 'بچه', 'مدرسه', 'کیف'],
  },
  {
    id: 'other-cities',
    labelFa: 'ارسال به شهرستان',
    answerFa:
      'خرید از سایت آنی‌یاب انجام می‌شود و ارسال به شهرهای مختلف امکان‌پذیر است؛ جزئیات ارسال را در صفحه خرید سایت می‌بینید. من خودم سفارش ثبت نمی‌کنم.',
    keywords: ['ارسال', 'شهرستان', 'پست', 'تحویل', 'تهران'],
  },
  {
    id: 'difference',
    labelFa: 'تفاوت پارک و پرو چیست؟',
    answerFa:
      'آنی پارک مخصوص شیشه خودروست و ارزان‌تر. آنی پرو همه‌کاره است: QR اختصاصی، صفحه گزارش گم‌شدن، بدنه مقاوم‌تر و مناسب کیف، چمدان و قلاده. اگر شیء شما همیشه همراهتان است، پرو انتخاب بهتری است.',
    keywords: ['تفاوت', 'فرق', 'کدام', 'پارک', 'پرو'],
  },
];

export function matchObjection(text: string): Objection | undefined {
  const normalized = text.replace(/[\u064A]/g, 'ی').replace(/[\u0643]/g, 'ک');
  return OBJECTIONS.find((o) => o.keywords.some((k) => normalized.includes(k)));
}

export function objectionsForPrompt(): string {
  return OBJECTIONS.map((o) => `• «${o.labelFa}» → ${o.answerFa}`).join('\n');
}
