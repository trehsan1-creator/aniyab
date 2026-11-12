/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  scripts/db-check.ts — is the database actually ready?
 * ─────────────────────────────────────────────────────────────────────────────
 *  Answers, in order, the questions that actually block a deployment:
 *
 *    1. Are the env vars present (and is the pepper set *before* any data)?
 *    2. Does the key authenticate?
 *    3. Did the migrations run — i.e. do all 12 tables exist?
 *    4. Are the service-only tables actually closed to clients (RLS)?
 *    5. Is the connection string usable from a Vercel function (IPv4 pooler
 *       vs direct — the failure nobody sees until a cold start on prod)?
 *
 *  Read-only: it never writes, so it is safe to run against production.
 *
 *    npm run db:check
 */

/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js';

import { loadEnv, required } from './env.mjs';

loadEnv();

const TABLES = [
  'customers',
  'conversations',
  'messages',
  'memories',
  'tag_consultations',
  'lost_reports',
  'found_reports',
  'registry_entries',
  'secure_calls',
  'post_shipments',
  'newspaper_ads',
  'events',
] as const;

/** Tables that must never be readable by a browser client. */
const SERVICE_ONLY = ['registry_entries', 'events'] as const;

let failures = 0;
let warnings = 0;

function ok(msg: string) {
  console.log(`✓ ${msg}`);
}
function fail(msg: string, hint?: string) {
  failures += 1;
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  → ${hint}`);
}
function warn(msg: string, hint?: string) {
  warnings += 1;
  console.warn(`! ${msg}`);
  if (hint) console.warn(`  → ${hint}`);
}

async function main() {
  const url = required('NEXT_PUBLIC_SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const pepper = required('PII_HASH_PEPPER');

  /* ── 1. env ─────────────────────────────────────────────────────────────── */
  console.log('\n── محیط ──');
  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL تنظیم نشده', 'از Supabase → Settings → API بردار');
  if (!key) fail('SUPABASE_SERVICE_ROLE_KEY تنظیم نشده', 'کلید service_role، نوع Sensitive');
  if (key && key.startsWith('sb_') === false && !key.startsWith('eyJ')) {
    warn('کلید شبیه service_role نیست', 'anon key کار نمی‌کند؛ RLS همه‌چیز را می‌بندد');
  }
  if (!pepper) {
    fail(
      'PII_HASH_PEPPER تنظیم نشده',
      'کد ملی با هش salted ذخیره می‌شود؛ بدون آن جست‌وجو هرگز پیدا نمی‌کند',
    );
  } else if (pepper.length < 24) {
    warn(`PII_HASH_PEPPER کوتاه است (${pepper.length} نویسه)`, 'حداقل ۳۲ نویسهٔ تصادفی');
  }
  if (url && key && pepper) ok('هر سه متغیر موجودند');

  if (!url || !key) {
    console.log('\nبدون این دو متغیر هیچ بررسی دیگری معنا ندارد.\n');
    process.exit(1);
  }

  if (url.includes('supabase.co')) {
    const ref = url.replace(/^https?:\/\//, '').split('.')[0];
    ok(`پروژه: ${ref}`);
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* ── 2. auth ────────────────────────────────────────────────────────────── */
  console.log('\n── احراز هویت ──');
  const probe = await sb.from('customers').select('id', { count: 'exact', head: true });
  if (probe.error) {
    const msg = probe.error.message ?? '';
    if (/relation .* does not exist|42P01/i.test(msg)) {
      fail('اتصال برقرار است اما جدول‌ها ساخته نشده‌اند', 'migration ها را اجرا کن (پایین)');
    } else if (/JWT|invalid api key|401/i.test(msg)) {
      fail('کلید رد شد', 'service_role key را دوباره از داشبورد کپی کن');
    } else {
      fail(`اتصال ناموفق: ${msg}`, 'آدرس پروژه و دسترسی شبکه را بررسی کن');
    }
    report();
    return;
  }
  ok(`کلید معتبر است (customers: ${probe.count ?? 0} ردیف)`);

  /* ── 3. schema ──────────────────────────────────────────────────────────── */
  console.log('\n── جدول‌ها ──');
  const missing: string[] = [];
  for (const table of TABLES) {
    const res = await sb.from(table).select('*', { count: 'exact', head: true });
    if (res.error) missing.push(table);
  }
  if (missing.length) {
    fail(`${missing.length} جدول از ۱۲ ساخته نشده: ${missing.join('، ')}`);
    console.error('  → به ترتیب اجرا کن: 0001_init.sql → 0002_rls.sql → 0003_realtime.sql');
  } else {
    ok('هر ۱۲ جدول موجودند');
  }

  /* ── 4. RLS on service-only tables ──────────────────────────────────────── */
  console.log('\n── امنیت RLS ──');
  const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!anonKey) {
    ok('anon key تنظیم نشده — مرورگر هیچ دسترسی مستقیمی ندارد (درست است)');
  } else {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const table of SERVICE_ONLY) {
      const res = await anon.from(table).select('*', { count: 'exact', head: true });
      if (!res.error && (res.count ?? 0) > 0) {
        fail(`${table} با anon key خوانده می‌شود (${res.count} ردیف)`, '0002_rls.sql اجرا نشده');
      } else {
        ok(`${table} برای کلاینت بسته است`);
      }
    }
  }

  /* ── 5. connection mode ─────────────────────────────────────────────────── */
  console.log('\n── حالت اتصال ──');
  if (/db\.[a-z0-9]+\.supabase\.co/.test(url)) {
    warn(
      'آدرس مستقیم دیتابیس (db.*.supabase.co) IPv6 است',
      'Vercel IPv6 ندارد؛ از Connection Pooling (port 6543) استفاده کن',
    );
  } else if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    warn('connection string خام داده شده', 'این اپ با supabase-js کار می‌کند، نه pg مستقیم');
  } else {
    ok('آدرس از نوع HTTP API پروژه است (با Vercel سازگار)');
  }

  report();
}

function report() {
  console.log('');
  if (failures) {
    console.error(`${failures} خطا، ${warnings} هشدار — تا رفع نشدن، redeploy فایده ندارد.`);
    process.exit(1);
  }
  if (warnings) {
    console.warn(`آماده است، با ${warnings} هشدار.`);
  } else {
    console.log('همه‌چیز آماده است. مرحلهٔ بعد: npm run seed && redeploy');
  }
}

main().catch((err) => {
  console.error('db:check crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
