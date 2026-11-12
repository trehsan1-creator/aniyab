# اتصال به Laya.Studio — دقیقاً کجا و چطور

> اصل راهنما: **مدل از NVIDIA، ارکستراسیون از Laya، و هیچ‌کدام اجباری نیست.**
> اگر `LAYA_*` تنظیم نشود، همه‌چیز کار می‌کند؛ فقط لایهٔ سیاست حذف می‌شود.

## ۱. تفکیک مسئولیت

| لایه | فراهم‌کننده | فایل |
|---|---|---|
| استنتاج (LLM) | NVIDIA NIM — `integrate.api.nvidia.com/v1/chat/completions` | `lib/llm.ts` |
| سیاست/راهنمای پیش از پاسخ | Laya SystemOne — `api.laya.studio/v1/systemone` | `lib/laya.ts` |
| ابزارها و گردش‌کار | خودمان (`lib/agent/tools.ts`) | — |
| داده | Supabase | `lib/db/store.ts` |

## ۲. سه حالت Laya

```bash
LAYA_MODE=off          # هیچ فراخوانی‌ای انجام نمی‌شود (پیش‌فرض وقتی کلید نیست)
LAYA_MODE=preflight    # یک POST قبل از مدل؛ خروجی = hints (پیشنهاد)
LAYA_MODE=orchestrate  # Laya در مسیر تصمیم قرار می‌گیرد؛ در صورت خطا، fallback به NVIDIA
```

`orchestrate` عمداً شکست‌پذیر است: اگر SystemOne خطا بدهد، درخواست **بی‌صدا** به NVIDIA می‌رود و `meta.servedBy` مقدار `nvidia` می‌گیرد. هیچ کاربری خطای Laya نمی‌بیند.

## ۳. جریان یک نوبت

```
POST /api/chat
  → router (قطعی: IMEI / کد ملی / فراموشم کن / ثبت یافته)
  → layaPreflight({ sessionId, flow, messages, customerBrief })
        ← { hints: { system_prompt?, temperature?, max_tokens?, metadata }, trace }
  → buildSystemPrompt(flow, customerBrief, extras)
  → applyLayaHints(prompt, hints)      ← hint فقط «تقویت» می‌کند، جایگزین نمی‌کند
  → حلقهٔ مدل با tools
  → meta.trace  → پنل X-Ray
```

## ۴. قرارداد SystemOne

درخواست:

```json
{
  "session_id": "…",
  "flow": "smart-tag | lost-report | found-report | general",
  "messages": [{ "role": "user", "content": "…" }],
  "customer_brief": "…≤۴۰۰ توکن…",
  "metadata": { "app": "aniyab-smart-assistant", "version": 2 }
}
```

پاسخ مورد انتظار (همه فیلدها اختیاری):

```json
{
  "ok": true,
  "hints": {
    "system_prompt": "…",
    "temperature": 0.3,
    "max_tokens": 900,
    "metadata": { "policy": "aniyab-v1" }
  }
}
```

نگاشت به `trace`:

| وضعیت | معنا در X-Ray |
|---|---|
| `ok` | hints رسید و اعمال شد |
| `skipped` | کلید/اندپوینت نیست یا mode=`off` |
| `failed` | خطای شبکه/۴۰۱/۴۲۹ — نادیده گرفته شد و مسیر ادامه یافت |
| `off` | عمداً خاموش |

## ۵. آنچه هرگز از Laya نمی‌پذیریم

- **ابزار جدید**: Laya نمی‌تواند ابزار تزریق کند؛ فهرست ابزارها در `lib/agent/tools.ts` بسته است.
- **دسترسی داده**: هیچ کوئری‌ای از سمت Laya اجرا نمی‌شود.
- **متن خام بدون فیلتر**: `hint.system_prompt` فقط به انتهای prompt اضافه می‌شود؛ `SAFETY_RULES_FA` همیشه آخر می‌ماند و بازنویسی نمی‌شود.

## ۶. اجرای محلی بدون کلید

```bash
npm run demo:upstream     # mock روی :4100 (NVIDIA) و :4200 (SystemOne)
```

سپس در `.env.local`:

```bash
NVIDIA_API_URL=http://127.0.0.1:4100/v1/chat/completions
LAYA_API_ENDPOINT=http://127.0.0.1:4200/v1/systemone
LAYA_MODE=preflight
```

mock سه چیز را شبیه‌سازی می‌کند: tool calling سازگار با OpenAI، پاسخ preflight با hints، و خطاهای NVIDIA (`RATE_TEST`، `AUTH_TEST`، `NOTFOUND_TEST`، `BOOM_TEST`، `SLOW_TEST`).

## ۷. بررسی سالم بودن

```bash
curl -s localhost:3000/api/health | jq .checks.laya
# { "mode": "preflight", "configured": true, "endpointHost": "api.laya.studio" }
```

و در هر نوبت با `xray: true`، فیلد `meta.laya` دقیقاً همان چیزی است که در پنل کنار گفتگو دیده می‌شود — همان جایی که «Powered by Laya.Studio» نوشته شده است.
