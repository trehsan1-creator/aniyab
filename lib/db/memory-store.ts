/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/db/memory-store.ts — ephemeral fallback store (no Supabase configured)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Keeps the whole demo usable without any database. Process-local, so it
 *  resets on redeploy — that is acceptable for a showcase and documented in
 *  docs/ASSUMPTIONS.md.
 */

import type {
  AppEvent,
  Conversation,
  Customer,
  FoundReport,
  LostReport,
  Memory,
  Message,
  NewspaperAd,
  PostShipment,
  RegistryEntry,
  SecureCall,
  TagConsultation,
} from './types';

interface Tables {
  customers: Map<string, Customer>;
  conversations: Map<string, Conversation>;
  messages: Map<string, Message>;
  memories: Map<string, Memory>;
  tag_consultations: Map<string, TagConsultation>;
  lost_reports: Map<string, LostReport>;
  found_reports: Map<string, FoundReport>;
  registry_entries: Map<string, RegistryEntry>;
  secure_calls: Map<string, SecureCall>;
  post_shipments: Map<string, PostShipment>;
  newspaper_ads: Map<string, NewspaperAd>;
  events: Map<string, AppEvent>;
}

const globalForStore = globalThis as unknown as { __aniyabStore?: Tables };

function freshTables(): Tables {
  return {
    customers: new Map(),
    conversations: new Map(),
    messages: new Map(),
    memories: new Map(),
    tag_consultations: new Map(),
    lost_reports: new Map(),
    found_reports: new Map(),
    registry_entries: new Map(),
    secure_calls: new Map(),
    post_shipments: new Map(),
    newspaper_ads: new Map(),
    events: new Map(),
  };
}

/** Survives Next.js hot reloads in dev; resets on a cold start. */
export const memoryStore: Tables = (globalForStore.__aniyabStore ??= freshTables());

/* ── boot seed ────────────────────────────────────────────────────────────── */
/**
 * Without Supabase the demo must still feel populated: registry lookups need
 * real hashed rows, and the admin dashboard needs customers to show. We seed
 * lazily (first access) and only once per process.
 */
let seeding: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  seeding ??= seedOnce();
  return seeding;
}

async function seedOnce(): Promise<void> {
  if (memoryStore.registry_entries.size > 0) return;

  const { DEMO_NATIONAL_IDS, DEMO_PERSONAS, DEMO_EXTRA_CUSTOMERS, DEMO_REGISTRY_ITEMS, DEMO_OFFICES, hashNationalId } =
    await import('@/lib/demo-data');

  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const uid = () => crypto.randomUUID();
  // Deterministic but well-mixed, so seeded codes look like real ones
  // (AN-L-7K3QX9), not like a counter (AN-L-AAAA2A).
  const code = (prefix: string, seed: number) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    let out = '';
    for (let i = 0; i < 6; i += 1) {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      h >>>= 0;
      out += alphabet[h % alphabet.length];
    }
    return `AN-${prefix}-${out}`;
  };

  // registry: 3 "lucky" IDs plus filler so the pool looks real
  for (let i = 0; i < 62; i += 1) {
    const lucky = i < DEMO_NATIONAL_IDS.length ? DEMO_NATIONAL_IDS[i]! : null;
    const nationalId =
      lucky ?? `00000000${String(10 + i).slice(-2)}`;
    const item = DEMO_REGISTRY_ITEMS[i % DEMO_REGISTRY_ITEMS.length]!;
    const id = uid();
    memoryStore.registry_entries.set(id, {
      id,
      national_id_hash: await hashNationalId(nationalId),
      item_type: item.itemType,
      description_masked: item.descriptionMasked,
      held_at: `دفتر ${DEMO_OFFICES[i % DEMO_OFFICES.length]}`,
      received_at: iso(60 * (i + 2)),
      status: 'held',
    });
  }

  // personas
  for (const [index, persona] of DEMO_PERSONAS.entries()) {
    const customerId = uid();
    memoryStore.customers.set(customerId, {
      id: customerId,
      auth_user_id: `demo-${persona.key}`,
      phone: persona.phone,
      full_name: persona.fullName,
      preferred_name: persona.preferredName,
      city: persona.city,
      visit_count: persona.visits,
      first_seen_at: iso(60 * 24 * 3),
      last_seen_at: iso(12),
      consent_memory: true,
      is_demo: true,
    });

    for (const memory of persona.memories) {
      const id = uid();
      memoryStore.memories.set(id, {
        id,
        customer_id: customerId,
        kind: memory.kind,
        key: memory.key,
        value: memory.value,
        confidence: memory.confidence,
        source_message_id: null,
        created_at: iso(180),
        updated_at: iso(60),
      });
    }

    if (persona.consultation) {
      const id = uid();
      memoryStore.tag_consultations.set(id, {
        id,
        customer_id: customerId,
        conversation_id: null,
        object_type: persona.consultation.objectType,
        budget_hint: null,
        recommended_product: persona.consultation.product,
        objections: persona.consultation.objections,
        stage: persona.consultation.stage,
        created_at: iso(25),
      });
    }

    if (persona.lostReport) {
      const id = uid();
      memoryStore.lost_reports.set(id, {
        id,
        tracking_code: code('L', index + 1),
        customer_id: customerId,
        item_type: persona.lostReport.itemType,
        imei: persona.lostReport.imei,
        brand_model: persona.lostReport.brandModel,
        last_seen_place: persona.lostReport.place,
        last_seen_at: null,
        status: persona.lostReport.status,
        is_demo: true,
        created_at: iso(persona.lostReport.minutesAgo),
      });
    }

    if (persona.foundReport) {
      const id = uid();
      memoryStore.found_reports.set(id, {
        id,
        tracking_code: code('F', index + 11),
        reporter_customer_id: customerId,
        item_type: persona.foundReport.itemType,
        identifier_kind: persona.foundReport.kind,
        identifier: persona.foundReport.identifier,
        description_public: `${persona.foundReport.itemType} در ${persona.foundReport.area} پیدا شد و به دفتر تحویل داده شد.`,
        description_private: 'خراش کوچک سمت راست و یک کارت ویزیت داخل جیب.',
        area: persona.foundReport.area,
        status: 'registered',
        created_at: iso(40),
      });
    }
  }

  // filler customers for the dashboard
  for (const [index, extra] of DEMO_EXTRA_CUSTOMERS.entries()) {
    const id = uid();
    memoryStore.customers.set(id, {
      id,
      auth_user_id: `demo-extra-${index}`,
      phone: extra.phone,
      full_name: extra.fullName,
      preferred_name: extra.preferredName,
      city: extra.city,
      visit_count: 1 + (index % 3),
      first_seen_at: iso(60 * 24),
      last_seen_at: iso(index * 37 + 5),
      consent_memory: true,
      is_demo: true,
    });
  }
}

export function resetMemoryStore(): void {
  const fresh = freshTables();
  for (const key of Object.keys(fresh) as (keyof Tables)[]) {
    // @ts-expect-error — structurally identical maps, keyed by table name
    memoryStore[key] = fresh[key];
  }
}
