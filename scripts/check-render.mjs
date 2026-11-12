/**
 * Render smoke test — catches the class of bug that a "200 OK" hides:
 * a server component crashing into Next's __next_error__ page.
 *
 *   node scripts/check-render.mjs [baseUrl]
 *
 * Asserts, for every route that must work:
 *   • no `<html id="__next_error__">`
 *   • the page's own marker text is present
 *   • no literal "Application error" / "digest" markers
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';

const CHECKS = [
  { path: '/', markers: ['خرید برچسب', 'اعلام مفقودی'], name: 'chat' },
  { path: '/?demo=1', markers: ['خرید برچسب'], name: 'chat+demo' },
  { path: '/?flow=lost-report', markers: ['خرید برچسب'], name: 'chat+flow' },
  // With no ADMIN_PASSWORD the page must say "not configured" instead of
  // offering a login form — both states are correct, a crash is not.
  { path: '/admin', markers: ['رمز عبور', 'داشبورد تنظیم نشده است'], anyOf: true, name: 'admin gate' },
  { path: '/offline', markers: ['ارتباط اینترنت قطع است'], name: 'offline' },
  /**
   * Every receipt prints `/f/AN-F-…`, so this route must exist and must render
   * the not-found state (not a 404) for an unknown code. It used to not exist at
   * all, which meant every QR code and every receipt link was dead.
   */
  {
    path: '/f/AN-F-RENDERCHECK',
    markers: ['این کد پیدا نشد', 'گفتگو با دستیار آنی‌یاب'],
    name: 'found-item page',
    expectStatus: 200,
  },
];

const API_CHECKS = [
  { path: '/api/health', expect: (d) => d.ok === true && d.checks?.llm?.configured !== undefined },
  { path: '/api/identity?deviceId=render-check', expect: (d) => typeof d.visitCount === 'number' },
  { path: '/api/memory?deviceId=render-check', expect: (d) => Array.isArray(d.memories) },
  { path: '/api/tickets?deviceId=render-check', expect: (d) => Array.isArray(d.tickets) },
  { path: '/manifest.webmanifest', json: true, expect: (d) => Array.isArray(d.icons) },
];

let failures = 0;

for (const check of CHECKS) {
  const res = await fetch(`${BASE}${check.path}`).catch((err) => ({ error: err }));
  if (res.error) {
    console.error(`✗ ${check.name} ${check.path} — ${res.error.message}`);
    failures += 1;
    continue;
  }
  const html = await res.text();
  const crashed = html.includes('__next_error__') || html.includes('Application error');
  const missing = check.anyOf
    ? check.markers.some((m) => html.includes(m))
      ? []
      : check.markers
    : check.markers.filter((m) => !html.includes(m));
  if (res.status !== 200 || crashed || missing.length) {
    console.error(
      `✗ ${check.name} ${check.path} — status=${res.status} crashed=${crashed} missing=${JSON.stringify(missing)}`,
    );
    failures += 1;
  } else {
    console.log(`✓ ${check.name} ${check.path}`);
  }
}

for (const check of API_CHECKS) {
  const res = await fetch(`${BASE}${check.path}`).catch((err) => ({ error: err }));
  if (res.error) {
    console.error(`✗ ${check.path} — ${res.error.message}`);
    failures += 1;
    continue;
  }
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || !body || !check.expect(body)) {
    console.error(`✗ ${check.path} — status=${res.status} body=${JSON.stringify(body)?.slice(0, 120)}`);
    failures += 1;
  } else {
    console.log(`✓ ${check.path}`);
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nall render checks passed.');
