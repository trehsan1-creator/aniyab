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

معماری دو لایه است، پس دو گروه متغیر داریم:

### الف) استنتاج (اجباری) — NVIDIA NIM

| کلید | مقدار | محیط |
| --- | --- | --- |
| `NVIDIA_API_KEY` | کلید `nvapi-…` از build.nvidia.com | Production + Preview (نوع: **Sensitive**) |
| `NVIDIA_API_ENDPOINT` | `https://integrate.api.nvidia.com/v1/chat/completions` | اختیاری |
| `NVIDIA_MODEL` | `nvidia/nemotron-3.5-bolt-e4b` | اختیاری |

### ب) ارکستراسیون (اختیاری) — Laya SystemOne

| کلید | مقدار | محیط |
| --- | --- | --- |
| `LAYA_SYSTEMONE_ENDPOINT` | آدرس SystemOne، مثلاً `https://api.laya.studio/v1/systemone` | اختیاری |
| `LAYA_API_KEY` | توکن Bearer لایا | اختیاری (نوع: **Sensitive**) |
| `LAYA_SYSTEMONE_MODE` | `off` (پیش‌فرض) یا `preflight` یا `orchestrate` | اختیاری |
| `LLM_TIMEOUT_MS` | `45000` | اختیاری — باید **کمتر** از `maxDuration` باشد |

سه قاعده‌ی طلایی:

1. **هرگز** پیشوند `NEXT_PUBLIC_` نگذار؛ کلید فقط سمت سرور مصرف می‌شود و نباید به مرورگر برسد.
2. نوع متغیر کلید را `Sensitive` بگذار تا بعد از ذخیره حتی در داشبورد خوانا نباشد.
3. بعد از هر تغییر متغیر، **Redeploy** لازم است (Deployments → ⋯ → Redeploy).

---

## ۳. سه حالت اتصال به SystemOne

`LAYA_SYSTEMONE_MODE` تعیین می‌کند SystemOne چه نقشی داشته باشد:

| حالت | چه اتفاقی می‌افتد | چه زمانی |
| --- | --- | --- |
| `off` | فقط NVIDIA. لایا هیچ تماسی نمی‌گیرد. | وقتی SystemOne آماده نیست |
| `preflight` | اول از SystemOne راهنمای پرامپت/مدل می‌گیریم، بعد خودمان NVIDIA را صدا می‌زنیم | **پیشنهاد شروع** — کم‌ریسک‌ترین |
| `orchestrate` | خود SystemOne مدل را صدا می‌زند؛ اگر خطا داد، خودکار روی NVIDIA fallback می‌شود | وقتی می‌خواهی لایا مالک فراخوانی باشد |

برای دیدن اینکه هر درخواست با کدام مسیر جواب داده شده، هدرهای پاسخ را ببین:

```
X-Aniyab-Served-By: nvidia | systemone | laya
X-Aniyab-Systemone: off | ok | skipped | failed
```

همچنین `GET /api/chat` کل توپولوژی را (بدون لو دادن کلید) گزارش می‌دهد.

بدنه‌ای که فرستاده می‌شود:

```json
{
  "model": "nvidia/nemotron-3.5-bolt-e4b",
  "stream": true,
  "temperature": 0.4,
  "max_tokens": 1024,
  "messages": [{ "role": "system", "content": "<پرامپت جریان فعال>" }, { "role": "user", "content": "…" }],
  "metadata": { "gateway": "systemone", "provider": "nvidia-nim", "flow": "lost-report", "session_id": "…" }
}
```

### عیب‌یابی: چرا پیام خطای عمومی می‌گیرم؟

به ترتیب این سه دستور را در مرورگر باز کن (نیازی به کلید در آدرس نیست):

| آدرس | چه چیزی را نشان می‌دهد |
| --- | --- |
| `/api/chat` | `providers.nvidia.configured` باید `true` باشد. `false` یعنی `NVIDIA_API_KEY` در آن محیط ست نشده یا deployment بعد از تنظیم آن ساخته نشده. |
| `/api/chat?probe=1` | تماس واقعی با NVIDIA از داخل خودِ deployment. `status:200` یعنی کلید و مدل هر دو سالم‌اند. `401` کلید نامعتبر · `410/404` مدل بازنشسته یا برای این حساب فعال نیست · `status:"network"` یعنی deployment به اینترنت خروجی نمی‌رسد. |
| `/api/chat?probe=1&stream=1` | همان تست اما روی مسیر SSE که مرورگر مصرف می‌کند؛ `stream.sawDone:true` و `stream.chars>0` یعنی استریم سالم است. |

سه علت واقعیِ خطا که در همین پروژه دیده شد و اکنون هر سه پوشش داده شده‌اند:

1. **`metadata` در بدنه** — NIM پارامتر ناشناخته را با `400 Validation: Unsupported parameter(s)` رد می‌کند.
2. **مدل بازنشسته** — `meta/llama-3.1-8b-instruct` در ۲۰۲۶-۰۸-۲۶ از رده خارج شد و NVIDIA `410 Gone` می‌دهد.
3. **مدلِ فعال‌نشده برای حساب** — برای این حساب اکثر مدل‌ها `404 Not Found for account` می‌دهند؛ تنها سه مدل nemotron-3.5 پاسخ می‌دهند.

`NVIDIA_MODEL` را روی یکی از این سه مقدار مجاز بگذار:

```
nvidia/nemotron-3.5-bolt-e4b        ← پیش‌فرض (سریع، پاسخ مستقیم)
nvidia/nemotron-3.5-lightning-30b-a3b
nvidia/nemotron-3.5-super-vl-120b-a12b
```

### نکتهٔ حیاتی: NVIDIA NIM پارامتر ناشناخته را رد می‌کند

NIM (برخلاف بسیاری از gatewayها) هر کلید ناشناخته در بدنه را با خطای زیر رد می‌کند:

```
400 Validation: Unsupported parameter(s): `metadata`
```

به همین دلیل `metadata` **فقط** برای providerهایی فرستاده می‌شود که `strictBody=false` دارند
(یعنی SystemOne/Laya). برای NVIDIA بدنه فقط شامل فیلدهای مستندِ OpenAI است.
اگر باز هم ۴۰۰ بدهد، مسیر به‌طور خودکار یک بار با بدنهٔ حداقلی (`slimPayload`) دوباره تلاش می‌کند
و هدر `X-Aniyab-Retry: slim-body` را برمی‌گرداند.

اگر به‌جای `messages` ساختار `input`/`prompt` می‌خواهد، فقط همان یک آبجکت `upstreamPayload` را عوض کن.

---

## ۴. تست بعد از Deploy

```bash
# ۱) سلامت و توپولوژی (configured باید true باشد)
curl https://<your-app>.vercel.app/api/chat

# ۱-ب) تست واقعیِ سرتاسری از داخل خودِ deployment (بدون لو دادن متن پاسخ)
curl 'https://<your-app>.vercel.app/api/chat?probe=1'
#    probe.status باید 200 باشد. اگر 401 دیدی → کلید nvapi نامعتبر/منقضی است.
#    اگر 400 دیدی → بدنه هنوز پارامتری دارد که NIM قبول نمی‌کند (متن body را بخوان).
#    اگر status:"network" دیدی → deployment به اینترنت خروجی دسترسی ندارد.

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
| `503 NOT_CONFIGURED` | هیچ ارائه‌دهنده‌ای ست نیست | `NVIDIA_API_KEY` (یا Laya) را ست و Redeploy کن |
| `502 UNAUTHORIZED` | کلید نامعتبر/منقضی | `NVIDIA_API_KEY` را از build.nvidia.com دوباره بساز؛ پیام سرویس داخل خطای فارسی چاپ می‌شود |
| `502 UPSTREAM_NOT_FOUND` | نام مدل غلط | `NVIDIA_MODEL` باید **دقیقاً** مطابق کاتالوگ build.nvidia.com باشد |
| `429 RATE_LIMITED` | سهمیه/نرخ پر شده | تیر رایگان انویدیا محدود است؛ `Retry-After` را رعایت کن یا اعتبار اضافه کن |
| `504 TIMEOUT` | مدل کند یا صف طولانی | `LLM_TIMEOUT_MS` را بالا ببر (حداکثر تا ۵۵ ثانیه) یا مدل سبک‌تر بگذار |
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

- [ ] `NVIDIA_API_KEY` حتماً server-side و از نوع Sensitive
- [ ] `LLM_TIMEOUT_MS` < `maxDuration`
- [ ] `LAYA_SYSTEMONE_MODE` روی مقدار عمدی (`off` یا `preflight`)
- [ ] `GET /api/chat` روی Production مقدار `configured` بدهد
- [ ] یک گفتگو روی موبایل واقعی (فونت پیدا + RTL)
- [ ] متن پرامپت‌های جریان‌ها با واحد کسب‌وکار نهایی شده باشد (قیمت‌ها و شماره‌ها در `FLOW_PROMPTS`)
- [ ] شماره پشتیبانی `۰۲۱-۶۲۸۰۱` در `HOTLINE_FA` و لینک `tel:` درست باشد
- [ ] در صورت نیاز، محدودسازی نرخ روی روت چت (Vercel WAF یا Upstash Ratelimit)
