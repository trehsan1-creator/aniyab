# اتصال به Laya.Studio — لایهٔ تصمیم، نه تولید متن

> اصل راهنما: **مدل زبانی NVIDIA جمله می‌سازد؛ Laya تصمیم می‌گیرد.**
> Laya یک API تصمیم (decision API) است: `{state, questions}` می‌فرستیم و
> احتمال کالیبره‌شدهٔ هر گزینه را می‌گیریم. هیچ‌وقت متن تولید نمی‌کند، پس
> «مدل زبانی دوم» نیست و نباید برای نوشتن پاسخ استفاده شود.

## ۱. تفکیک مسئولیت

| لایه | فراهم‌کننده | فایل |
|---|---|---|
| تصمیم (مسیریابی، اولویت، تطبیق) | Laya SystemOne — `api.laya.studio/v1/systemone` | `lib/laya.ts`, `lib/agent/laya-decisions.ts` |
| استنتاج و نگارش پاسخ | NVIDIA NIM — `integrate.api.nvidia.com/v1/chat/completions` | `lib/llm.ts` |
| ابزارها و گردش‌کار | خودمان | `lib/agent/tools.ts` |
| داده | Supabase | `lib/db/store.ts` |

## ۲. چرا نسخهٔ قبلی کار نمی‌کرد (ریشه‌یابی)

سه لایه خطا، و هر سه در سکوت شکست می‌خوردند:

1. **بدنهٔ درخواست غلط:** `{session_id, flow, locale, channel, messages, context}` می‌فرستادیم.
   Laya فقط `{state, questions}` می‌پذیرد؛ بقیه ۴۰۰/۴۲۲ می‌گیرد.
2. **پارس پاسخ غلط:** منتظر `hints.{system_prompt,temperature,max_tokens}` بودیم.
   پاسخ واقعی `answers.<id>.{choice,noul,score,probabilities,confidence}` است.
3. **مدل پیش‌فرض غلط:** پیش‌فرض Laya برای متن انگلیسی `english` است؛ فارسی به
   `multilingual` نیاز دارد.

و دو عامل که خطا را پنهان می‌کردند: مسیر `fallback` بی‌صدا بود، و
`scripts/mock-laya.cjs` همان `hints` ساختگی را برمی‌گرداند — یعنی تست‌ها با
همان قرارداد غلط سبز می‌شدند. **درس:** شکل پاسخ را از مستندات کپی کن، نه از کلاینت.

## ۳. تنظیمات

```bash
LAYA_SYSTEMONE_ENDPOINT=https://api.laya.studio/v1/systemone
LAYA_SYSTEMONE_MODE=live        # live | off
LAYA_MODEL=multilingual         # فارسی = multilingual (۱۰۲۴ توکن، ۱۰۰+ زبان)
LAYA_SYSTEMONE_TIMEOUT_MS=4000
LAYA_API_KEY=lsk_live_…
LAYA_TOOL_THRESHOLD=0.70        # آستانهٔ اجرای خودکار ابزار
LAYA_TIER_THRESHOLD=0.65
LAYA_URGENCY_THRESHOLD=0.60
```

اگر کلید یا endpoint نباشد، `enabled=false` و همه‌چیز به مسیر قطعی برمی‌گردد.
هیچ نوبتی به‌خاطر Laya شکست نمی‌خورد (`decide()` هرگز throw نمی‌کند).

## ۴. پنج تصمیم حرفه‌ای

### ۴.۱ مسیریابی ابزار — `routeTurn()`
یک سؤال `choice` روی ۱۲ ابزار + `none`، همراه با `needs_tools` و `category`.
اگر بالاترین احتمال از `LAYA_TOOL_THRESHOLD` بیشتر بود، ابزار **قبل از مدل** اجرا
می‌شود و نتیجهٔ واقعی به مدل داده می‌شود تا فقط روایتش کند.

### ۴.۲ انتخاب سطح مدل — `tierForTurn()`
یک سؤال `score` با چهار سطح. `trivial` → `fast` (بودجهٔ ۳۲۰ توکن)،
`moderate` → `standard` (۹۰۰)، `hard` → `deep` (۱۲۰۰). با
`NVIDIA_MODEL_FAST` می‌توان یک مدل ارزان‌تر هم به ابتدای زنجیره آورد.

### ۴.۳ اولویت‌بندی پرونده — `triageTicket()`
سه سؤال `noul`: فوریت، مدرک هویتی بودن، ریسک سوءاستفاده. خروجی روی کارت
`TriageNote` و در صف ادمین استفاده می‌شود. کارت ملی و گذرنامه اول صف می‌روند
چون نوع متفاوتی از خطر هستند.

### ۴.۴ تطبیق شیء پیداشده — `matchFoundItem()`
توضیح خصوصی یابنده در برابر توضیح مالک؛ `noul` کالیبره + کدام ویژگی برای
تأیید مالکیت قابل استناد است. بالای ۰٫۸۵ = اطلاع‌رسانی خودکار، پایین‌تر = داوری انسانی.

### ۴.۵ تشخیص تردید خرید — `detectObjection()`
یک سؤال `choice` روی هشت تردید مصوب. **برچسب خودش آرگومان است:** همان شناسه
به `get_objection_answer(topic)` می‌رود، پس مدل دیگر موضوع را حدس نمی‌زند.
(`price`, `privacy`, `durability`, `secure-call`, `dishonest-finder`, `pets-kids`,
`other-cities`, `difference`)

## ۵. قرارداد API

درخواست:

```json
{
  "state": { "message": "کارت ملی‌ام را گم کردم", "flow": "lost-report" },
  "questions": {
    "tool": { "type": "choice", "instructions": "…", "criteria": { "create_lost_report": "…", "none": "…" } },
    "needs_tools": { "type": "noul", "instructions": "…" },
    "difficulty": { "type": "score", "criteria": ["trivial: …", "easy: …", "moderate: …", "hard: …"] }
  },
  "model": "multilingual",
  "lang": "fa"
}
```

پاسخ:

```json
{
  "id": "…", "model": "multilingual",
  "answers": {
    "tool": { "type": "choice", "choice": "create_lost_report",
              "probabilities": { "create_lost_report": 0.88, "none": 0.12 }, "confidence": 0.88 },
    "needs_tools": { "type": "noul", "noul": 0.91 },
    "difficulty": { "type": "score", "score": 1 }
  },
  "usage": { "input_tokens": 118, "output_tokens": 3 }
}
```

هدرهای مهم: `x-credits-charged` (۱ اعتبار = ۱ توکن ورودی)، `x-free-runs-remaining`،
`x-laya-residency`. خطاها: `400` بدنهٔ خراب، `401` کلید، `402` اعتبار تمام،
`422` سؤال نامعتبر، `429` محدودیت نرخ، `503` موقتاً در دسترس نیست.

⚠️ `POST /v1/ask` را استفاده نکن: آن یک LLM planner است با هزینهٔ ۳ تا ۱۸ اعتبار
**به‌ازای هر توکن پرامپت**. تصمیم‌گیری مسیریابی را با `systemone` انجام می‌دهیم.

## ۶. حالت `off` (fallback)

اگر Laya نباشد یا خطا بدهد:

```
router قطعی (IMEI / کد ملی / فراموشم کن / ثبت یافته)  ← همان رفتار نسخهٔ قبل
مدل با tools، بدون تصمیم قبلی                          ← مدل خودش ابزار را انتخاب می‌کند
```

`meta.laya` همیشه صادق است: `mode`, `status`, `latencyMs`, `answered`,
`router.{tool,probability,confident,source}`, `error`, `creditsCharged`.
`source` یکی از `laya` (تصمیم گرفت)، `fallback` (روتر قطعی)، یا `model` است.

## ۷. نتیجهٔ اولین اجرای واقعی (production)

اولین فراخوانی مقابل کلید واقعی، **درست کار کرد و شکست خورد** — و هر دو مهم است:

```json
{ "attempted": true, "status": "failed", "ms": 210, "model": "multilingual",
  "error": "http_402_no_credits", "errorStatus": 402 }
```

یعنی کلید و endpoint و شکل سؤال درست است (وگرنه ۴۰۱ یا ۴۲۲ می‌گرفتیم)؛ اعتبار
workspace تمام شده. با ۱ اعتبار = ۱ توکن ورودی و ۶۰۰۰ اعتبار رایگان اولیه، هر نوبت
با ۵ سؤال و state کوتاه حدود ۵۰۰ تا ۶۰۰ اعتبار مصرف می‌کند.

### دو باگ که همین اجرا لو داد

**۱. `last` همیشه `null` بود.** `layaLastDecision()` روی یک متغیر ماژول‌سطح بود، اما
Next.js هر route را در باندل جدا می‌سازد؛ پس `/api/chat` تصمیم را در یک نسخه از
ماژول ثبت می‌کرد و `/api/health` نسخهٔ دیگری را می‌خواند. نتیجه: health می‌گفت
`configured-unused` در حالی که همهٔ تصمیم‌ها ۴۰۲ می‌گرفتند. حالا رکورد روی
`globalThis` است و بین routeها مشترک می‌شود.

**۲. `source: "laya"` دروغ می‌گفت.** وقتی فراخوانی Laya شکست می‌خورد، منبع تصمیم
همچنان `laya` گزارش می‌شد — دقیقاً همان چیزی که X-Ray برای اثباتش ساخته شده بود.
حالا `laya` فقط وقتی گزارش می‌شود که واقعاً پاسخی آمده باشد (`answered.length > 0`).

### فیلد تازهٔ `decisionLayer` در health

| مقدار | معنا |
|---|---|
| `off` | کلید نیست؛ روتر کلیدواژه کار می‌کند |
| `unverified` | کلید هست اما این instance هنوز تصمیمی ندیده (روی Vercel هر تابع، state خودش را دارد) |
| `ok` | تصمیم‌ها گرفته می‌شوند |
| `failed` | یک فراخوانی واقعی شکست خورد؛ `last.error` می‌گوید چرا |

روی این فیلد هشدار بگذار، نه روی `configured`.

## ۸. اندازه‌گیری

| سؤال | زمان (مدل multilingual) |
|---|---|
| یک سؤال | ~۳۳ms |
| پنج سؤال | ~۸۵ms |

در عمل حدود ۵ms در محیط لوکال و ۲ تا ۳ درصد تأخیر کل نوبت. هر نوبت دو فراخوانی
موازی دارد (مسیریابی + سختی) و در مجموع زیر ۱۰ms.

## ۹. تست

- `tests/laya.test.ts` — قرارداد پاسخ (`readChoice`/`readNoul`/`readScore`)،
  نرمال‌سازی، حالت `off`.
- `tests/laya-decisions.test.ts` — وقتی Laya نیست، هر سه تصمیم `null` می‌دهند
  و خطا نمی‌دهند.
- `scripts/mock-laya.cjs` — قرارداد مستند را پیاده می‌کند (نه قرارداد کلاینت)،
  و درخواست بدون `state`/`questions` را با ۴۲۲ رد می‌کند.
- `scripts/probe-turn.py` — یک نوبت واقعی می‌فرستد و `meta` + `trace` را چاپ می‌کند.
