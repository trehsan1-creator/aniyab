# راهنمای استقرار روی Vercel — دستیار هوشمند آنی‌یاب

این سند دقیقاً همان مسیری است که این پروژه با آن روی Vercel بالا می‌آید، به‌همراه اتصال به API واقعی.

---

## ۰. پیش‌نیازها

| مورد | مقدار |
| --- | --- |
| مخزن | `trehsan1-creator/aniyab` |
| شاخه | `arena/73568076-aniyab` (یا بعد از merge: `main`) |
| فریم‌ورک | Next.js 14.2 (App Router) |
| Runtime روت چت | Node.js (`maxDuration = 60`) |
| Build Command | `npm run build` (پیش‌فرض Vercel درست است) |
| Output | `.next` (دست نزنید) |

فایل `vercel.json` از قبل اضافه شده است:

```json
{
  "framework": "nextjs",
  "regions": ["fra1"],
  "functions": {
    "app/api/chat/route.ts": { "maxDuration": 60, "memory": 1024 }
  }
}
```

---

## ۱. ساخت پروژه در Vercel (دو راه)

### راه الف — از داشبورد (توصیه‌شده)

1. برو به <https://vercel.com/new>
2. مخزن `aniyab` را Import کن (اگر دیده نمی‌شود: `Adjust GitHub App Permissions`)
3. تنظیمات را **دست نزن**؛ Vercel خودش `Next.js` را تشخیص می‌دهد
4. **قبل از کلیک روی Deploy** بخش *Environment Variables* را باز کن و سه متغیر بخش ۲ را اضافه کن
5. Deploy

### راه ب — از CLI

```bash
npm i -g vercel
vercel login
cd aniyab
vercel link                     # اتصال به پروژه (نام: aniyab)
vercel env add LAYA_API_ENDPOINT production
vercel env add LAYA_API_KEY production
vercel --prod
```

> نکته: شاخه‌ی `arena/73568076-aniyab` در حالت عادی Preview می‌سازد. برای Production یا این شاخه را merge کن روی `main`، یا در Project Settings → Git → Production Branch همان شاخه را انتخاب کن.

---

## ۲. متغیرهای محیطی (مهم‌ترین بخش)

| کلید | مقدار | محیط |
| --- | --- | --- |
| `LAYA_API_ENDPOINT` | آدرس کامل gateway لایا | Production + Preview |
| `LAYA_API_KEY` | توکن Bearer | Production + Preview (نوع: **Sensitive**) |
| `LAYA_MODEL` | `meta/llama-3.1-8b-instruct` | اختیاری |
| `LAYA_TIMEOUT_MS` | `45000` | اختیاری — باید **کمتر** از `maxDuration` باشد |

سه قاعده‌ی طلایی:

1. **هرگز** پیشوند `NEXT_PUBLIC_` نگذار؛ کلید فقط سمت سرور مصرف می‌شود و نباید به مرورگر برسد.
2. نوع متغیر کلید را `Sensitive` بگذار تا بعد از ذخیره حتی در داشبورد خوانا نباشد.
3. بعد از هر تغییر متغیر، **Redeploy** لازم است (Deployments → ⋯ → Redeploy).

---

## ۳. آدرس درست `LAYA_API_ENDPOINT`

روت ما با هر دو حالت کنار می‌آید و بر اساس `Content-Type` تصمیم می‌گیرد:

| اگر gateway شما… | مقدار | نتیجه |
| --- | --- | --- |
| OpenAI-compatible | `https://api.laya.studio/v1/chat/completions` | Streaming یا JSON |
| SystemOne gateway | `https://api.laya.studio/v1/systemone` | همان رفتار |
| آدرس اختصاصی | `https://<host>/v1/chat/completions` | همان رفتار |

بدنه‌ای که فرستاده می‌شود:

```json
{
  "model": "meta/llama-3.1-8b-instruct",
  "stream": true,
  "temperature": 0.4,
  "max_tokens": 1024,
  "messages": [{ "role": "system", "content": "<پرامپت جریان فعال>" }, { "role": "user", "content": "…" }],
  "metadata": { "gateway": "systemone", "provider": "nvidia-nim", "flow": "lost-report", "session_id": "…" }
}
```

اگر gateway شما `metadata` را نمی‌پسندد، حذفش کن (خط `metadata` در `app/api/chat/route.ts`).
اگر به‌جای `messages` ساختار `input`/`prompt` می‌خواهد، فقط همان یک آبجکت `upstreamPayload` را عوض کن.

---

## ۴. تست بعد از Deploy

```bash
# ۱) سلامت و تنظیمات (نباید بگوید missing)
curl https://<your-app>.vercel.app/api/chat

# ۲) استریم واقعی
curl -N -X POST https://<your-app>.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"سلام"}],"sessionId":"deploy-test-0001","activeFlow":"smart-tag"}'
```

خروجی سالم باید یکی از این دو باشد:

- فریم‌های `data: {"choices":[{"delta":{"content":"…"}}]}` و در پایان `data: [DONE]`
- یا یک JSON با `choices[0].message.content` و `answer`

و در UI، برچسب «متصل» سبز بماند و پاسخ تکه‌تکه تایپ شود.

---

## ۵. نگاشت خطاها (برای عیب‌یابی سریع)

| کد برگشتی | معنا | کار |
| --- | --- | --- |
| `503 NOT_CONFIGURED` | env خالی است | متغیرها را ست و Redeploy کن |
| `502 UNAUTHORIZED` | کلید یا scope اشتباه | `LAYA_API_KEY` و مجوز مدل در لایا |
| `502 UPSTREAM_NOT_FOUND` | آدرس/مدل غلط | `LAYA_API_ENDPOINT` و نام مدل |
| `429 RATE_LIMITED` | سهمیه پر شده | `Retry-After` را رعایت کن یا سهمیه بخر |
| `504 TIMEOUT` | gateway کند است | `LAYA_TIMEOUT_MS` و پلن/ریجن |
| `502 NETWORK` | DNS/فایروال | اگر لایا IP ایران را بلاک می‌کند، ریجن را عوض کن |

**نکته‌ی مهم درباره‌ی ریجن:** پیش‌فرض `fra1` (فرانکفورت) است چون از ایران معمولاً پایدارتر است.
اگر لایا در آمریکا میزبانی می‌شود و تأخیر زیاد شد، در `vercel.json` مقدار را به `iad1` تغییر بده.

---

## ۶. دامنه‌ی اختصاصی

1. Project → Settings → Domains → `Add`، مثلاً `chat.aniyab.com`
2. در DNS دامنه، رکورد را طبق راهنمای Vercel بگذار:
   - ساب‌دامین: `CNAME chat → cname.vercel-dns.com`
   - دامنه‌ی اصلی: `A @ → 76.76.21.21`
3. تا زمان فعال‌شدن SSL صبر کن (چند دقیقه)

---

## ۷. چک‌لیست قبل از انتشار عمومی

- [ ] `LAYA_API_KEY` حتماً server-side و از نوع Sensitive
- [ ] `LAYA_TIMEOUT_MS` < `maxDuration`
- [ ] `GET /api/chat` روی Production مقدار `configured` بدهد
- [ ] یک گفتگو روی موبایل واقعی (فونت پیدا + RTL)
- [ ] متن پرامپت‌های جریان‌ها با واحد کسب‌وکار نهایی شده باشد (قیمت‌ها و شماره‌ها در `FLOW_PROMPTS`)
- [ ] شماره پشتیبانی `۰۲۱-۶۲۸۰۱` در `HOTLINE_FA` و لینک `tel:` درست باشد
- [ ] در صورت نیاز، محدودسازی نرخ روی روت چت (Vercel WAF یا Upstash Ratelimit)
