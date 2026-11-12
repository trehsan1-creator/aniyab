/**
 * Local stand-ins for the two upstreams this app talks to.
 *
 *   :4100  NVIDIA NIM  — mirrors integrate.api.nvidia.com/v1/chat/completions
 *                        (OpenAI-compatible SSE + JSON, NVIDIA error shapes)
 *   :4200  Laya SystemOne — mirrors the orchestration/preflight gateway
 *
 * Fault injection is driven by the user's message so a single mock can exercise
 * every branch of the route's error mapping:
 *   RATE_TEST · AUTH_TEST · NOTFOUND_TEST · BOOM_TEST · SLOW_TEST
 */
const http = require('node:http');

const ANSWER = `سلام! برای اعلام مفقودی گوشی، این مراحل را انجام دهید:

1. **ابتدا کد IMEI را بردارید**: شماره‌گیری کنید \`*#06#\` یا جعبه دستگاه را ببینید. کد ۱۵ رقمی است.
2. **ثبت اعلام مفقودی**: در فرم اعلام مفقودی آنی‌یاب، IMEI و شماره تماس را وارد کنید.
3. **درخواست ردیابی**: فقط با ارائه مدارک مالکیت و از مسیر مراجع مجاز انجام می‌شود.
4. **آگهی مفقودی در روزنامه**: برای مدارک هویتی پیشنهاد می‌شود.

**نکته مهم:** آنی‌یاب هیچ‌گاه موقعیت لحظه‌ای گوشی را به کاربر نشان نمی‌دهد.

- پشتیبانی ۲۴ ساعته: ۰۲۱-۶۲۸۰۱
- هزینه آگهی روزنامه از ۳۵۰٬۰۰۰ تومان شروع می‌شود.`;

/**
 * Grounded narration — the thing a real model does after it sees tool results.
 * Without this the mock always replied with the canned "lost phone" script,
 * which made tool-only turns look broken in the demo.
 */
/**
 * Intent → tool, with schema-valid args. Mirrors what a competent model would
 * call for each demo flow so the mock is a faithful stand-in.
 */
function chooseTool(lastUser, byName, messages) {
  const t = String(lastUser || '');
  const none = { name: null, args: {} };

  if (
    /پیگیری|وضعیت|کد رهگیری|AN-L|پرونده‌ام|چی شد|رسید/i.test(t) &&
    byName('get_report_status') &&
    !/گم شد|مفقود|پیدا کردم/i.test(t)
  ) {
    const code = (t.match(/AN-[LF]-[A-Z0-9]{6}/i) || [])[0];
    return {
      name: byName('get_report_status'),
      args: code ? { trackingCode: code.toUpperCase() } : {},
    };
  }
  if (/پیدا کردم|پیداشد|پیدا شد|یافتم|تحویل بدم|ثبت شیء/i.test(t) && byName('register_found_item')) {
    return {
      name: byName('register_found_item'),
      args: {
        itemType: /کیف/.test(t) ? 'کیف چرمی مشکی' : /گوشی/.test(t) ? 'گوشی موبایل' : 'شیء پیداشده',
        identifierKind: /سریال|serial/i.test(t) ? 'serial' : 'qr',
        identifier: 'BAG-8842-TH',
        descriptionPublic: 'شیء پیداشده در پارک لاله؛ برای دریافت، کد رهگیری را ارائه دهید.',
        descriptionPrivate: 'خراش کوچک سمت راست و یک کارت ویزیت داخل جیب.',
        area: 'پارک لاله، تهران',
      },
    };
  }
  if (/تحویل پست|پست کن|ارسال به آدرس|بفرست/i.test(t) && byName('request_found_post')) {
    return { name: byName('request_found_post'), args: {} };
  }
  if (/آگهی|روزنامه|پیش‌فاکتور|پیش فاکتور/i.test(t) && byName('quote_newspaper_ad')) {
    return {
      name: byName('quote_newspaper_ad'),
      args: {
        docType: /گذرنامه/.test(t) ? 'passport' : /کارت ملی/.test(t) ? 'national-id' : /کارت بانکی/.test(t) ? 'bank-card' : 'phone',
        newspaper: 'hamshahri',
        size: 'medium',
        days: 3,
        highlighted: true,
        publishDate: '۱۴۰۴/۰۸/۲۵',
        itemName: /گذرنامه/.test(t) ? 'گذرنامه' : /کارت ملی/.test(t) ? 'کارت ملی' : 'گوشی موبایل',
        place: 'مترو ونک',
      },
    };
  }
  if (/استعلام|کد ملی/i.test(t) && byName('lookup_registry')) {
    const id = (t.match(/[\u06F0-\u06F9\d]{10}/) || [])[0];
    return { name: byName('lookup_registry'), args: { nationalId: id || '0499370899' } };
  }
  if (/imei|۳۵۶|356|گوشی/i.test(t) && byName('validate_imei') && /\d{10,}|[\u06F0-\u06F9]{10,}/.test(t)) {
    const imei = (t.match(/[\u06F0-\u06F9\d]{15}/) || [])[0];
    return {
      name: byName('validate_imei'),
      args: { imei: imei ? imei.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) : '356938035643809' },
    };
  }
  if (/گم شد|مفقود|اعلام مفقودی/i.test(t) && byName('create_lost_report') && !/پیگیری/i.test(t)) {
    return {
      name: byName('create_lost_report'),
      args: {
        itemType: /کیف/.test(t) ? 'کیف' : /گذرنامه/.test(t) ? 'گذرنامه' : 'گوشی موبایل',
        imei: /گوشی|imei|۳۵۶|356/i.test(t) ? '356938035643809' : undefined,
        brandModel: 'سامسونگ Galaxy S23',
        lastSeenPlace: 'مترو ونک',
        lastSeenAt: 'دیشب حدود ۹',
      },
    };
  }
  if (/لپ\s*تاپ|کیف|برچسب|پارک|پرو|خرید|قیمت/i.test(t) && byName('recommend_product')) {
    return {
      name: byName('recommend_product'),
      args: {
        objectType: /کیف/.test(t) ? 'کیف لپ‌تاپ' : /خودرو|ماشین|پارک/i.test(t) ? 'خودرو' : 'شیء همراه',
        recommendedProduct: /خودرو|ماشین|پارک/i.test(t) ? 'ani-park' : 'ani-pro',
        reasonFa:
          /خودرو|ماشین|پارک/i.test(t)
            ? 'چون برای خودرو و پارکینگ طراحی شده و چسب آن به شیشه مقاوم است.'
            : 'چون کیف لپ‌تاپ هر روز با شما بیرون می‌رود و آنی پرو QR اختصاصی با صفحه گزارش گم‌شدن دارد.',
        budgetHint: 'انعطاف‌پذیر',
        stage: 'recommended',
      },
    };
  }
  void messages;
  return none;
}

function narrate(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser =
    [...list].reverse().find((m) => m.role === 'user')?.content?.toString().trim() ?? '';

  const toolMsg = [...list].reverse().find((m) => m.role === 'tool');
  if (toolMsg) {
    let payload = null;
    try {
      payload = JSON.parse(toolMsg.content);
    } catch {
      payload = null;
    }
    if (payload) {
      const summary = (payload.summaryFa || payload.note || '').toString().trim();
      const data = payload.data && typeof payload.data === 'object' ? payload.data : {};

      if (payload.ok === false) {
        return [
          summary || 'این مورد را نتوانستم تأیید کنم.',
          '',
          'اگر شماره یا کد را دوباره چک کردی و درست بود، بگو تا مسیر دیگری را امتحان کنیم. پشتیبانی هم ۲۴ ساعته روی ۰۲۱-۶۲۸۰۱ پاسخ می‌دهد.',
        ].join('\n');
      }

      const lines = [];
      if (summary) lines.push(summary);

      // A short, human next step that depends on which tool just ran.
      const name = (payload.tool || payload.name || '').toString();
      const cards = Array.isArray(payload.cardsShown) ? payload.cardsShown.join(',') : '';
      if (/recommend_product/.test(name + cards) || data.recommended) {
        lines.push(
          '',
          'اگر موافقی، همین حالا سفارش را در سایت آنی‌یاب نهایی کن؛ نصب و فعال‌سازی کمتر از یک دقیقه است.',
        );
      } else if (/validate_imei/.test(name + cards) || data.imei) {
        lines.push(
          '',
          'قدم بعدی: اعلام مفقودی را ثبت کنیم تا کد پیگیری بگیری. کافی است بگویی «اعلام مفقودی کن».',
        );
      } else if (/lookup_registry/.test(name) || data.found) {
        lines.push('', 'برای تحویل، کارت ملی و مدرک مالکیت را همراه داشته باش.');
      } else if (/quote_newspaper_ad/.test(name + cards)) {
        lines.push(
          '',
          'این پیش‌فاکتور هیچ مبلغی از شما کم نمی‌کند؛ فقط با تأیید شما آگهی ثبت می‌شود. تاریخ درج را هم می‌توانی عوض کنی.',
        );
      } else if (/register_found_item/.test(name + cards) || /ReceiptCard/.test(cards)) {
        lines.push(
          '',
          'رسید و کد رهگیری را نگه دار. اگر صاحب شیء پیدا شد، از همین کد می‌توانی بدون نمایش شماره‌ات با او تماس بگیری.',
        );
      } else if (lines.length === 1) {
        lines.push('', 'اگر سؤال دیگری داری، همین‌جا بپرس.');
      }
      return lines.join('\n');
    }
  }

  if (/گم|مفقود|imei|۳۵۶|356/i.test(lastUser)) return ANSWER;
  if (/کیف|لپ\s*تاپ|برچسب|پارک|پرو|قیمت/i.test(lastUser)) {
    return [
      'دو گزینه داریم: آنی پارک ۳۴۹٬۰۰۰ تومان برای خودرو و پارکینگ، و آنی پرو ۶۹۴٬۰۰۰ تومان برای وسایل همراه.',
      '',
      'برای اینکه دقیق پیشنهاد بدهم، بگو شیء مورد نظرت چیست و کجا بیشتر استفاده می‌شود؟',
    ].join('\n');
  }
  return ANSWER;
}

/**
 * Memory-extractor emulation: the real app asks the model for strict JSON after
 * each turn (see lib/agent/extract.ts). Without this branch the mock answered
 * with prose, so nothing was ever remembered and the demo's continuity story
 * silently broke.
 */
function extractJson(messages) {
  const system = (messages ?? []).find((m) => m.role === 'system')?.content ?? '';
  if (!/استخراج‌کننده حافظه/.test(system)) return null;

  const userText = (messages ?? []).reverse().find((m) => m.role === 'user')?.content ?? '';
  const said = userText.split('\n')[0]?.replace(/^کاربر:\s*/, '') ?? '';
  const memories = [];

  const city = said.match(/(تهران|کرج|اصفهان|شیراز|مشهد|تبریز|رشت|اهواز|یزد|قزوین|قم|کرمان)/)?.[0];
  if (city) memories.push({ kind: 'fact', key: 'city', value: city, confidence: 0.85 });

  const item = said.match(/(کیف لپ‌?تاپ|کیف چرمی|کوله|چمدان|گوشی|لپ‌?تاپ|کلید|عینک|گذرنامه|کارت ملی|قلاده)/)?.[0];
  if (item) memories.push({ kind: 'item', key: 'object_of_interest', value: item, confidence: 0.8 });

  if (/آنی پرو/.test(said)) memories.push({ kind: 'preference', key: 'product_interest', value: 'آنی پرو', confidence: 0.8 });
  else if (/آنی پارک/.test(said)) memories.push({ kind: 'preference', key: 'product_interest', value: 'آنی پارک', confidence: 0.8 });

  if (/شماره|موبایلم را نده|حریم|خصوصی/.test(said)) {
    memories.push({ kind: 'concern', key: 'privacy_concern', value: 'نگران نمایش شماره موبایل است', confidence: 0.7 });
  }
  if (/گم شد|مفقود|دزدیده/.test(said)) {
    memories.push({ kind: 'event', key: 'lost_item_reported', value: 'اعلام مفقودی ثبت کرد', confidence: 0.9 });
  }
  if (/بودجه|هزار تومان/.test(said)) {
    memories.push({ kind: 'preference', key: 'budget_hint', value: 'بودجه محدود اعلام کرده', confidence: 0.65 });
  }

  const summary =
    memories.length > 0
      ? `${item ? item + ' — ' : ''}${memories.map((m) => m.value).slice(0, 2).join(' / ')}`
      : 'گفتگوی عمومی دربارهٔ خدمات آنی‌یاب';

  return JSON.stringify({ memories: memories.slice(0, 4), summary });
}

function sse(res, TEXT = ANSWER) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const tokens = TEXT.match(/[\s\S]{1,9}/g) ?? [];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= tokens.length) {
      res.write('data: [DONE]\n\n');
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'meta/llama-3.1-8b-instruct',
        choices: [{ index: 0, delta: { content: tokens[i] }, finish_reason: null }],
      })}\n\n`,
    );
    i += 1;
  }, 18);
  res.on('close', () => clearInterval(timer));
}

/** NVIDIA-shaped error envelope. */
function nvidiaError(res, status, title, detail, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => cb(body));
}

/* ── NVIDIA NIM mock ─────────────────────────────────────────────────────── */
http
  .createServer((req, res) => {
    const url = req.url || '/';
    readBody(req, (body) => {
      const auth = req.headers.authorization || '';
      console.log(`[nvidia-mock] ${req.method} ${url} auth=${auth.slice(0, 16)}… body=${body.length}B`);
      if (url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }));
      }

      if (body.includes('RATE_TEST')) {
        return nvidiaError(res, 429, 'Too Many Requests', 'Rate limit exceeded. Retry later.', {
          'Retry-After': '7',
        });
      }
      if (body.includes('AUTH_TEST')) {
        return nvidiaError(res, 401, 'Unauthorized', 'Invalid bearer token.');
      }
      if (body.includes('NOTFOUND_TEST')) {
        return nvidiaError(res, 404, 'Not Found', 'Model meta/does-not-exist is not available.');
      }
      if (body.includes('BOOM_TEST')) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end('<html>upstream exploded</html>');
      }
      if (body.includes('SLOW_TEST')) return; // never respond → timeout path

      // ── Strict body validation, like the real NIM gateway ──────────────
      // NIM answers 400 `Validation: Unsupported parameter(s)` for any
      // top-level key it does not recognise. Distrusting that is what broke
      // production, so the mock now enforces it.
      if (url.startsWith('/v1/chat/completions') || url.startsWith('/json-mode')) {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          return nvidiaError(res, 400, 'Bad Request', 'Request body is not valid JSON.');
        }
        const allowed = new Set([
          'model', 'messages', 'stream', 'stream_options', 'temperature', 'top_p',
          'max_tokens', 'max_completion_tokens', 'n', 'stop', 'presence_penalty',
          'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'user',
          'seed', 'response_format', 'tools', 'tool_choice', 'parallel_tool_calls',
        ]);
        const unknown = Object.keys(parsed || {}).filter((k) => !allowed.has(k));
        if (unknown.length) {
          return nvidiaError(
            res,
            400,
            'Bad Request',
            `Validation: Unsupported parameter(s): ${unknown.map((k) => `\`${k}\``).join(', ')}`,
          );
        }
      }

      let parsedBody = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = null;
      }

      // ── Tool-call emulation ────────────────────────────────────────────────
      // If the caller sent `tools`, behave like a model that supports OpenAI
      // tool calling: first turn → tool_calls, and once tool results are in the
      // conversation → a natural-language answer.
      const hasTools = Array.isArray(parsedBody?.tools) && parsedBody.tools.length > 0;
      const lastRoles = (parsedBody?.messages ?? []).map((m) => m.role);
      const alreadyUsedTool = lastRoles.includes('tool');
      const wantsTools = body.includes('"tool_choice"') || hasTools;
      const streamRequested = parsedBody?.stream === true && !url.startsWith('/json-mode');

      if (wantsTools && hasTools && !alreadyUsedTool) {
        // Pick the tool that fits the latest user message, and send the args a
        // real model would send (schema-valid), so the guardrails stay honest.
        const lastUser =
          [...(parsedBody?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
        const byName = (n) => parsedBody.tools.find((t) => t.function?.name === n)?.function?.name;

        let toolName = null;
        let toolArgs = {};

        const pick = chooseTool(lastUser, byName, parsedBody.messages);
        toolName = pick.name;
        toolArgs = pick.args;

        if (!toolName) {
          // Nothing to do — behave like a plain answering model.
          const wantsStream2 = parsedBody?.stream === true;
          if (wantsStream2) return sse(res, narrate(parsedBody?.messages));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(
            JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion',
              choices: [
                { index: 0, message: { role: 'assistant', content: narrate(parsedBody?.messages) }, finish_reason: 'stop' },
              ],
            }),
          );
        }

        const callId = 'call_mock_1';
        const toolCall = {
          id: callId,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(toolArgs) },
        };

        if (streamRequested) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // Legacy content delta + a tool_call delta, like NIM does.
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            id: 'chatcmpl-mock-tool',
            object: 'chat.completion',
            model: parsedBody?.model ?? 'mock',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: null, tool_calls: [toolCall] },
                finish_reason: 'tool_calls',
              },
            ],
          }),
        );
      }

      // ── Deterministic action-envelope emulation ────────────────────────────
      // When the caller asks for JSON (`response_format` or the [/action] marker),
      // answer with the envelope the fallback router expects.
      const wantsEnvelope =
        Boolean(parsedBody?.response_format) ||
        body.includes('ACTION_ENVELOPE') ||
        url.startsWith('/action-mode');

      if (wantsEnvelope && !alreadyUsedTool) {
        const userText = [...(parsedBody?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
        let action = null;
        if (/imei|۳۵۶|356/i.test(userText)) {
          action = { tool: 'validate_imei', args: { imei: '356938035643809' }, say_fa: 'کد را بررسی می‌کنم.' };
        } else if (/لپ\s*تاپ|کیف|برچسب|پارک|پرو/.test(userText)) {
          action = {
            tool: 'recommend_product',
            args: {
              objectType: 'کیف لپ‌تاپ',
              recommendedProduct: 'ani-pro',
              reasonFa: 'چون کیف لپ‌تاپ هر روز بیرون می‌رود و پرو QR اختصاصی دارد.',
            },
            say_fa: 'بر اساس توضیح شما، آنی پرو مناسب‌تر است.',
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            id: 'chatcmpl-mock-envelope',
            object: 'chat.completion',
            model: parsedBody?.model ?? 'mock',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ action, reply_fa: action ? action.say_fa : ANSWER.slice(0, 200), remember: [] }),
                },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      }

      // Memory extraction: strict JSON, never streamed.
      const extracted = extractJson(parsedBody?.messages);
      if (extracted) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            id: 'chatcmpl-mock-extract',
            object: 'chat.completion',
            model: parsedBody?.model ?? 'mock',
            choices: [{ index: 0, message: { role: 'assistant', content: extracted }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
          }),
        );
      }

      // `/json-mode` forces the non-streaming branch (tests the JSON fallback).
      const wantsStream = parsedBody ? parsedBody.stream === true : body.includes('"stream":true');
      if (url.startsWith('/v1/chat/completions') && wantsStream && !url.startsWith('/json-mode')) return sse(res, narrate(parsedBody?.messages));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'meta/llama-3.1-8b-instruct',
          choices: [
            { index: 0, message: { role: 'assistant', content: narrate(parsedBody?.messages) }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 240, total_tokens: 360 },
        }),
      );
    });
  })
  .listen(4100, '0.0.0.0', () => console.log('mock NVIDIA NIM on :4100'));

/* ── Laya SystemOne mock (preflight) ─────────────────────────────────────── */
http
  .createServer((req, res) => {
    readBody(req, (body) => {
      const auth = req.headers.authorization || '';
      console.log(`[systemone-mock] ${req.method} ${req.url} auth=${auth.slice(0, 16)}… body=${body.length}B`);

      // /v1/chat/completions in orchestrate mode: deliberately down, so the route
      // must transparently fall back to NVIDIA.
      if ((req.url || '').startsWith('/v1/chat/completions')) {
        return nvidiaError(res, 503, 'Service Unavailable', 'SystemOne model routing is down.');
      }

      // A preflight response: hints the route may merge into the model call.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          session_id: 'mock',
          hints: {
            system_prompt: 'در پاسخ به کاربر، اگر موردی اورژانسی بود ابتدا شماره ۱۱۰ را یادآوری کن.',
            temperature: 0.3,
            metadata: { policy: 'aniyab-v1', routed_by: 'systemone' },
          },
        }),
      );
    });
  })
  .listen(4200, '0.0.0.0', () => console.log('mock Laya SystemOne on :4200'));
