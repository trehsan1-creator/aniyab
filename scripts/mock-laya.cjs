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

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const tokens = ANSWER.match(/[\s\S]{1,9}/g) ?? [];
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

      // `/json-mode` forces the non-streaming branch (tests the JSON fallback).
      const wantsStream = body.includes('"stream":true') && !url.startsWith('/json-mode');
      if (url.startsWith('/v1/chat/completions') && wantsStream) return sse(res);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'meta/llama-3.1-8b-instruct',
          choices: [{ index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }],
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
