# راه‌اندازی دیتابیس و پنل ادمین — قدم به قدم

> وضعیت فعلی production: `supabase.configured: false` و `admin.configured: false`.
> یعنی همه‌چیز در حافظهٔ موقت است و `/admin` خاموش. این سند آن را روشن می‌کند.
> زمان لازم: حدود ۱۰ دقیقه. هیچ کد‌نویسی‌ای لازم نیست.

---

## ۰. تصمیم اول: کدام دیتابیس؟

| گزینه | برای | چرا |
|---|---|---|
| **Supabase (پیشنهاد)** | این پروژه، همین حالا | migration ها نوشته شده‌اند، RLS آماده است، `store.ts` با آن کار می‌کند |
| بدون دیتابیس | فقط دموی یک‌نفرهٔ محلی | روی Vercel با هر cold start پاک می‌شود |

اگر روی Vercel بمانی و Supabase نگذاری، **هیچ داده‌ای پایدار نمی‌ماند** — نه مشتری، نه پرونده، نه حافظه.

---

## ۱. پروژهٔ Supabase بساز

1. وارد <https://supabase.com/dashboard> شو → **New project**
2. Region: نزدیک‌ترین (برای ایران، `eu-central-1` فرانکفورت منطقی است — همان `fra1` که در `vercel.json` هست)
3. رمز دیتابیس را **جایی امن ذخیره کن** (برای این اپ لازم نیست، اما اگر بعداً بخواهی مستقیم وصل شوی لازم می‌شود)

## ۲. سه migration را به ترتیب اجرا کن

در داشبورد → **SQL Editor** → **New query**. هر فایل را کامل کپی کن، اجرا کن، بعدی:

| ترتیب | فایل | چه می‌سازد |
|---|---|---|
| ۱ | `supabase/migrations/0001_init.sql` | ۱۲ جدول + enumها + ایندکس‌ها |
| ۲ | `supabase/migrations/0002_rls.sql` | RLS: مشتری فقط ردیف خودش؛ `registry_entries` و `events` برای کلاینت بسته |
| ۳ | `supabase/migrations/0003_realtime.sql` | publication برای داشبورد |

هر سه idempotent هستند (`if not exists` / `exception when duplicate_object`)، پس اجرای دوباره ضرری ندارد.

**ترتیب مهم است:** ۰۰۰۲ روی جدول‌هایی policy می‌گذارد که ۰۰۰۱ ساخته. اگر برعکس بزنی، خطا می‌گیری.

## ۳. متغیرها را بردار

داشبورد → **Settings → API**:

| متغیری که می‌خواهی | از کجا |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** — شکل `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** secret (نه anon!) |

و خودت بساز:

| متغیر | مقدار |
|---|---|
| `PII_HASH_PEPPER` | رشتهٔ تصادفی ≥۳۲ نویسه |

```bash
# ساخت pepper:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### سه هشدار جدی

1. **`PII_HASH_PEPPER` را قبل از اولین دادهٔ واقعی تنظیم کن.** کد ملی با هش salted ذخیره می‌شود؛ اگر بعداً عوض شود، همهٔ جست‌وجوهای قبلی بی‌صدا «پیدا نشد» می‌دهند. باید در Vercel و محلی **یکی** باشد.
2. **`SUPABASE_SERVICE_ROLE_KEY` هرگز `NEXT_PUBLIC_` نگیرد.** این کلید RLS را دور می‌زند. اگر به مرورگر برسد، کل دیتابیس باز است.
3. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` لازم نیست — نگذارش.** این معماری همه‌چیز را از routeهای سرور می‌فرستد. نبودنش یعنی سطح حملهٔ کمتر. (`db:check` این را تأیید می‌کند.)

## ۴. محلی بررسی کن

```bash
# در .env.local بگذار (این فایل git-ignore است):
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PII_HASH_PEPPER=<همان رشته>

npm run db:check     # ← اول این
npm run seed         # ← بعد این (اختیاری: دادهٔ دمو)
```

`db:check` پنج چیز را می‌گوید: محیط، احراز هویت، وجود ۱۲ جدول، بسته بودن جدول‌های حساس، و سازگاری آدرس با Vercel. **اگر خطا داد، redeploy فایده ندارد** — تا رفع نشدن، همان خطا در production هم هست.

`seed` حالا قبل از نوشتن، schema را بررسی می‌کند و اگر نوشتنی شکست بخورد با کد خطا خارج می‌شود (قبلاً «✅ seed complete» می‌گفت حتی وقتی صفر ردیف نوشته بود).

## ۵. در Vercel تنظیم کن

```bash
# هر سه، برای environment های Production + Preview:
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production      # نوع: Sensitive
vercel env add PII_HASH_PEPPER production                # نوع: Sensitive
```

یا از داشبورد: **Settings → Environment Variables**.

⚠️ `NEXT_PUBLIC_*` را تغییر بدهی، باید **Redeploy** کنی (در build جاسازی می‌شود). بقیه در runtime خوانده می‌شوند، اما Redeploy ساده‌ترین راه است.

## ۶. تأیید نهایی

بعد از deploy:

```bash
curl -s https://<your-domain>/api/health | jq '.checks.supabase'
# باید باشد: { "configured": true, "mode": "supabase" }
```

اگر `mode: "memory"` ماند، متغیرها به آن environment نرسیده‌اند.

---

## پنل ادمین

کد کامل است؛ فقط یک متغیر می‌خواهد:

```bash
ADMIN_PASSWORD=<یک رمز قوی>     # نوع: Sensitive
```

بعد از Redeploy:

- `/admin` → فرم رمز
- نشست: httpOnly cookie، ۸ ساعت، `sameSite=strict`، مقایسهٔ constant-time، ۵ تلاش در ۱۰ دقیقه
- بدون `ADMIN_PASSWORD` صفحه می‌گوید «داشبورد تنظیم نشده است» و هیچ فرمی نشان نمی‌دهد — این عمدی است، نه خرابی

### آنچه در پنل هست

۵ شاخص (گفتگوی فعال، تیکت امروز، سرنخ گرم، نرخ بازگشت، میانگین پاسخ)، قیف فروش، جدول مشتریان، و نمای ۳۶۰ درجهٔ هر مشتری.

### آنچه در پنل **نیست** (و باید بدانی)

| کمبود | اثر |
|---|---|
| **صف پرونده‌ها** | ادمین نمی‌تواند ببیند کدام شیء پیدا شده و منتظر مالک است. `foundReports` فقط داخل نمای یک مشتری تکی استفاده می‌شود. |
| **اولویت تریاژ ذخیره‌شده** | `triageTicket()` اولویت را حساب می‌کند و کارت `TriageNote` را به مشتری نشان می‌دهد، اما نتیجه هیچ‌جا ذخیره نمی‌شود (ستون `priority` وجود ندارد). صف ادمین حتی اگر ساخته شود، نمی‌تواند بر اساسش مرتب کند. |
| **Realtime واقعی** | بنر می‌نویسد «Supabase Realtime»، اما در واقع polling هر ۲ ثانیه است. `supabase-js` در مرورگر بدون `NEXT_PUBLIC_SUPABASE_ANON_KEY` نمی‌تواند subscribe کند، پس `0003` عملاً بی‌استفاده است. |

این سه مورد در PR بعدی بسته می‌شوند (migration `0004`: ستون `priority` + `triage_reason`؛ صف مرتب‌شدهٔ پرونده‌ها؛ و یا ادعای realtime تصحیح می‌شود یا واقعاً پیاده).

## اگر گیر کردی

| نشانه | علت |
|---|---|
| `db:check` → «کلید رد شد» | anon key داده‌ای، نه service_role |
| `db:check` → «جدول‌ها ساخته نشده‌اند» | migration اجرا نشده |
| `db:check` → «آدرس مستقیم دیتابیس» | `db.*.supabase.co` داده‌ای؛ این اپ با HTTP API کار می‌کند |
| سلامت می‌گوید `mode: "memory"` در production | متغیرها در environment درست تنظیم نشده‌اند |
| جست‌وجوی کد ملی همیشه «پیدا نشد» | `PII_HASH_PEPPER` با مقدار زمان نوشتن فرق دارد |
