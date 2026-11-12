/**
 * Local stand-in for the Laya.Studio Orchestrator.
 * Mirrors both response modes so the chat route can be tested offline:
 *   POST /stream  → text/event-stream (chunked OpenAI-style deltas)
 *   POST /json    → application/json  (choices[0].message.content)
 *   POST /429     → rate-limit error
 *   POST /403     → auth error
 *   POST /slow    → never responds (timeout path)
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
        choices: [{ index: 0, delta: { content: tokens[i] } }],
      })}\n\n`,
    );
    i += 1;
  }, 18);
  res.on('close', () => clearInterval(timer));
}

http
  .createServer((req, res) => {
    const url = req.url || '/';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      console.log(`[mock] ${req.method} ${url} auth=${auth.slice(0, 18)}… body=${body.length}B`);

      // Fault injection driven by the user's message so a single mock can
      // exercise every branch of the gateway's error mapping.
      if (body.includes('RATE_TEST')) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' });
        return res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
      }
      if (body.includes('AUTH_TEST')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'forbidden' } }));
      }
      if (body.includes('NOTFOUND_TEST')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'no such model' } }));
      }
      if (body.includes('BOOM_TEST')) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end('<html>upstream exploded</html>');
      }
      if (body.includes('SLOW_TEST')) return; // never respond -> timeout path

      if (url.startsWith('/stream')) return sse(res);
      if (url.startsWith('/429')) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' });
        return res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
      }
      if (url.startsWith('/403')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'forbidden' } }));
      }
      if (url.startsWith('/slow')) return; // never respond
      if (url.startsWith('/json')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            choices: [{ index: 0, message: { role: 'assistant', content: ANSWER } }],
          }),
        );
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  })
  .listen(4100, '0.0.0.0', () => console.log('mock Laya upstream on :4100'));
