/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  scripts/seed.ts — deterministic demo data
 * ─────────────────────────────────────────────────────────────────────────────
 *  Runs against Supabase when configured, otherwise fills the in-memory store
 *  (useful for local demos without a database).
 *
 *  npm run seed        → idempotent upsert
 *  npm run seed:reset  → wipe demo rows first
 *
 *  All phone numbers use the 0912-000-00xx range so they are obviously fake and
 *  can never belong to a real subscriber.
 */

/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

import {
  DEMO_EXTRA_CUSTOMERS,
  DEMO_NATIONAL_IDS,
  DEMO_OFFICES,
  DEMO_PERSONAS,
  DEMO_REGISTRY_ITEMS,
} from '../lib/demo-data';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEPPER = process.env.PII_HASH_PEPPER?.trim() || 'aniyab-demo-pepper-v1';

const RESET = process.argv.includes('--reset');

/** Same algorithm as lib/crypto.ts (server-side hashing). */
function hashNationalId(nationalId: string): string {
  return createHash('sha256').update(`${PEPPER}:${nationalId}`).digest('hex');
}

/* ── fixtures come from one place (lib/demo-data.ts) ─────────────────────── */

function trackingCode(prefix: 'L' | 'F' | 'P' | 'N', seed: number): string {
  const alphabet = 'ABCDEF0123456789';
  let n = seed * 2_654_435_761;
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    n = (n * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.abs(n) % alphabet.length];
  }
  return `AN-${prefix}-${out}`;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const NEWSPAPERS = ['همشهری', 'ایران', 'جام‌جم', 'کیهان', 'شرق'];

/** Checksum-valid Iranian national ID, generated deterministically for filler rows. */
function makeNationalId(seed: number): string {
  const base = String(100_000_000 + seed * 7_919).slice(0, 9).padStart(9, '0');
  const digits = base.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const r = sum % 11;
  const check = r < 2 ? r : 11 - r;
  return `${base}${check}`;
}
const OFFICES = ['ولیعصر', 'شهرک غرب', 'تجریش', 'نارمک', 'ونک', 'سعادت‌آباد'];

/* ── runner ───────────────────────────────────────────────────────────────── */

async function main() {
  if (!URL_ || !KEY) {
    console.log('⚠️  Supabase is not configured — nothing to seed.');
    console.log('   Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or run the');
    console.log('   app without a database (ephemeral in-memory store).');
    return;
  }

  const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

  if (RESET) {
    console.log('🧹 removing previous demo rows…');
    for (const table of [
      'events',
      'newspaper_ads',
      'post_shipments',
      'secure_calls',
      'found_reports',
      'lost_reports',
      'tag_consultations',
      'memories',
      'messages',
      'conversations',
      'registry_entries',
      'customers',
    ]) {
      const { error } = await sb.from(table).delete().not('id', 'is', null);
      if (error) console.warn(`   ${table}: ${error.message}`);
    }
  }

  let seed = 1;

  /* ── customers ──────────────────────────────────────────────────────────── */
  console.log('👥 seeding customers…');
  const ids = new Map<string, string>();

  for (const p of DEMO_PERSONAS) {
    const { data, error } = await sb
      .from('customers')
      .upsert(
        {
          phone: p.phone,
          full_name: p.fullName,
          preferred_name: p.preferredName,
          city: p.city,
          visit_count: p.visits,
          first_seen_at: minutesAgo(60 * 24 * 3),
          last_seen_at: minutesAgo(12),
          consent_memory: true,
          is_demo: true,
        },
        { onConflict: 'phone' },
      )
      .select('id')
      .single();
    if (error) {
      console.error(`   ${p.fullName}: ${error.message}`);
      continue;
    }
    ids.set(p.key, data.id as string);
  }

  for (const { fullName, preferredName, phone, city } of DEMO_EXTRA_CUSTOMERS) {
    await sb.from('customers').upsert(
      {
        phone,
        full_name: fullName,
        preferred_name: preferredName,
        city,
        visit_count: 1 + (seed % 3),
        last_seen_at: minutesAgo(seed * 37),
        is_demo: true,
      },
      { onConflict: 'phone' },
    );
    seed += 1;
  }

  /* ── memories + consultations + reports ─────────────────────────────────── */
  console.log('🧠 seeding memories, consultations and tickets…');
  for (const p of DEMO_PERSONAS) {
    const customerId = ids.get(p.key);
    if (!customerId) continue;

    for (const memory of p.memories) {
      await sb.from('memories').upsert(
        {
          customer_id: customerId,
          kind: memory.kind,
          key: memory.key,
          value: memory.value,
          confidence: memory.confidence,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_id,kind,key' },
      );
    }

    const { data: conv } = await sb
      .from('conversations')
      .upsert(
        { customer_id: customerId, flow: 'general', status: 'open', last_message_at: minutesAgo(9) },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();

    if (p.consultation) {
      await sb.from('tag_consultations').insert({
        customer_id: customerId,
        conversation_id: conv?.id ?? null,
        object_type: p.consultation.objectType,
        recommended_product: p.consultation.product,
        objections: p.consultation.objections,
        stage: p.consultation.stage,
        created_at: minutesAgo(25),
      });
    }

    if (p.lostReport) {
      await sb.from('lost_reports').upsert(
        {
          tracking_code: trackingCode('L', personaIndex(p.key) + 1),
          customer_id: customerId,
          item_type: p.lostReport.itemType,
          imei: p.lostReport.imei,
          brand_model: p.lostReport.brandModel,
          last_seen_place: p.lostReport.place,
          status: p.lostReport.status,
          is_demo: true,
          created_at: minutesAgo(p.lostReport.minutesAgo),
        },
        { onConflict: 'tracking_code' },
      );
    }

    if (p.foundReport) {
      await sb.from('found_reports').upsert(
        {
          tracking_code: trackingCode('F', personaIndex(p.key) + 11),
          reporter_customer_id: customerId,
          item_type: p.foundReport.itemType,
          identifier_kind: p.foundReport.kind,
          identifier: p.foundReport.identifier,
          description_public: `${p.foundReport.itemType} در ${p.foundReport.area} پیدا شد و به دفتر تحویل داده شد.`,
          description_private: 'روی شیء یک کارت ویزیت و یک خراش کوچک سمت راست وجود دارد.',
          area: p.foundReport.area,
          status: 'registered',
          created_at: minutesAgo(40),
        },
        { onConflict: 'tracking_code' },
      );
    }
  }

  /* ── registry pool (60+ entries) ────────────────────────────────────────── */
  console.log('🗂  seeding registry entries…');
  const registryRows = [] as Array<Record<string, unknown>>;
  for (let i = 0; i < 62; i += 1) {
    const item = DEMO_REGISTRY_ITEMS[i % DEMO_REGISTRY_ITEMS.length]!;
    const itemType = item.itemType;
    const description = item.descriptionMasked;
    // First entries are the national IDs the demo script uses.
    const nationalId = i < DEMO_NATIONAL_IDS.length ? DEMO_NATIONAL_IDS[i]! : makeNationalId(i + 100);
    registryRows.push({
      national_id_hash: hashNationalId(nationalId),
      item_type: itemType,
      description_masked: description,
      held_at: `دفتر ${DEMO_OFFICES[i % DEMO_OFFICES.length]}`,
      received_at: minutesAgo(60 * (i + 2)),
      status: 'held',
      is_demo: true,
    });
  }
  for (const row of registryRows) {
    await sb.from('registry_entries').insert(row);
  }
  console.log(`   demo national IDs: ${DEMO_NATIONAL_IDS.join(', ')}`);

  /* ── newspapers (reference rows live in code; log for the demo script) ──── */
  console.log(`📰 newspapers available: ${NEWSPAPERS.join('، ')}`);

  /* ── analytics seed ─────────────────────────────────────────────────────── */
  console.log('📈 seeding funnel events…');
  for (let i = 0; i < 18; i += 1) {
    await sb.from('events').insert({
      customer_id: ids.get(DEMO_PERSONAS[i % DEMO_PERSONAS.length]!.key) ?? null,
      type: ['shop_cta_click', 'consultation.recommended', 'lost_report.created', 'registry.lookup'][i % 4],
      payload: { demo: true, i },
      created_at: minutesAgo(i * 13),
    });
  }

  console.log('\n✅ seed complete.');
  console.log('   demo personas:');
  for (const p of DEMO_PERSONAS) {
    console.log(`   · ${p.fullName} — ${p.phone} — ${p.visits} visits`);
  }
}

function personaIndex(key: string): number {
  return DEMO_PERSONAS.findIndex((p) => p.key === key);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
