import 'server-only';

import { adminClient, warnEphemeral } from './client';
import { memoryStore, ensureSeeded } from './memory-store';
import type {
  AppEvent,
  Conversation,
  Customer,
  Flow,
  FoundReport,
  LostReport,
  Memory,
  MemoryKind,
  Message,
  NewspaperAd,
  PostShipment,
  RegistryEntry,
  SecureCall,
  TagConsultation,
} from './types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/db/store.ts — the ONLY data-access surface used by the app
 * ─────────────────────────────────────────────────────────────────────────────
 *  Every function: tries Supabase first, falls back to the in-memory store.
 *  Nothing else in the codebase talks to Supabase directly, which keeps the
 *  ephemeral mode honest instead of half-working.
 */

const sb = () => adminClient();
const nowIso = () => new Date().toISOString();

function uid(): string {
  return crypto.randomUUID();
}

/** Deterministic-ish tracking code: AN-L-4F82C1 */
export function trackingCode(prefix: 'L' | 'F' | 'P' | 'N'): string {
  const alphabet = 'ABCDEF0123456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `AN-${prefix}-${out}`;
}

/* ── customers ─────────────────────────────────────────────────────────────── */

export interface CustomerInput {
  authUserId?: string | null;
  phone?: string | null;
  preferredName?: string | null;
  city?: string | null;
}

export async function findOrCreateCustomer(input: CustomerInput): Promise<Customer> {
  if (!sb()) await ensureSeeded();
  const client = sb();
  const fallback = (): Customer => {
    const existing = [...memoryStore.customers.values()].find(
      (c) =>
        (input.authUserId && c.auth_user_id === input.authUserId) ||
        (input.phone && c.phone === input.phone),
    );
    if (existing) {
      existing.last_seen_at = nowIso();
      existing.visit_count += 1;
      if (input.preferredName && !existing.preferred_name) existing.preferred_name = input.preferredName;
      if (input.city && !existing.city) existing.city = input.city;
      if (input.phone && !existing.phone) existing.phone = input.phone;
      return existing;
    }
    const created: Customer = {
      id: uid(),
      auth_user_id: input.authUserId ?? null,
      phone: input.phone ?? null,
      full_name: null,
      preferred_name: input.preferredName ?? null,
      city: input.city ?? null,
      visit_count: 1,
      first_seen_at: nowIso(),
      last_seen_at: nowIso(),
      consent_memory: true,
      is_demo: true,
    };
    memoryStore.customers.set(created.id, created);
    return created;
  };

  if (!client) {
    warnEphemeral('findOrCreateCustomer');
    return fallback();
  }

  try {
    const filter = input.authUserId
      ? `auth_user_id.eq.${input.authUserId}`
      : input.phone
        ? `phone.eq.${input.phone}`
        : null;

    if (filter) {
      const { data } = await client.from('customers').select('*').or(filter).limit(1).maybeSingle();
      if (data) {
        const updated = {
          last_seen_at: nowIso(),
          visit_count: (data.visit_count ?? 1) + 1,
          preferred_name: data.preferred_name ?? input.preferredName ?? null,
          city: data.city ?? input.city ?? null,
          phone: data.phone ?? input.phone ?? null,
        };
        const { data: saved } = await client
          .from('customers')
          .update(updated)
          .eq('id', data.id)
          .select('*')
          .single();
        return (saved ?? data) as Customer;
      }
    }

    const insert = {
      auth_user_id: input.authUserId ?? null,
      phone: input.phone ?? null,
      preferred_name: input.preferredName ?? null,
      city: input.city ?? null,
      visit_count: 1,
      first_seen_at: nowIso(),
      last_seen_at: nowIso(),
      consent_memory: true,
      is_demo: true,
    };
    const { data, error } = await client.from('customers').insert(insert).select('*').single();
    if (error) throw error;
    return data as Customer;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[aniyab/db] findOrCreateCustomer failed', (err as Error).message);
    return fallback();
  }
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const client = sb();
  if (!client) return memoryStore.customers.get(id) ?? null;
  const { data } = await client.from('customers').select('*').eq('id', id).maybeSingle();
  return (data as Customer | null) ?? null;
}

export async function updateCustomer(
  id: string,
  patch: Partial<Pick<Customer, 'preferred_name' | 'full_name' | 'city' | 'phone' | 'consent_memory'>>,
): Promise<void> {
  const client = sb();
  if (!client) {
    const c = memoryStore.customers.get(id);
    if (c) Object.assign(c, patch);
    return;
  }
  await client.from('customers').update(patch).eq('id', id);
}

/** Merges an anonymous customer into a phone-keyed one (demo-OTP verification). */
export async function mergeCustomers(_fromId: string, _toId: string): Promise<void> {
  const client = sb();
  if (!client) {
    const from = memoryStore.customers.get(_fromId);
    if (from) from.auth_user_id = null;
    return;
  }
  // Conversations / tickets / memories follow the phone identity.
  for (const table of ['conversations', 'memories', 'lost_reports', 'found_reports', 'newspaper_ads', 'post_shipments'] as const) {
    const column = table === 'found_reports' ? 'reporter_customer_id' : 'customer_id';
    await client.from(table).update({ [column]: _toId }).eq(column, _fromId);
  }
}

/* ── conversations & messages ──────────────────────────────────────────────── */

export async function getOrCreateConversation(params: {
  customerId: string;
  flow: Flow;
  conversationId?: string | null;
}): Promise<Conversation> {
  const client = sb();
  const fallback = (): Conversation => {
    if (params.conversationId) {
      const found = memoryStore.conversations.get(params.conversationId);
      if (found) {
        found.last_message_at = nowIso();
        found.flow = params.flow;
        return found;
      }
    }
    const open = [...memoryStore.conversations.values()].find(
      (c) => c.customer_id === params.customerId && c.status === 'open',
    );
    if (open) {
      open.last_message_at = nowIso();
      return open;
    }
    const created: Conversation = {
      id: uid(),
      customer_id: params.customerId,
      flow: params.flow,
      summary: null,
      status: 'open',
      started_at: nowIso(),
      last_message_at: nowIso(),
    };
    memoryStore.conversations.set(created.id, created);
    return created;
  };

  if (!client) return fallback();

  try {
    if (params.conversationId) {
      const { data } = await client.from('conversations').select('*').eq('id', params.conversationId).maybeSingle();
      if (data && (data as Conversation).customer_id === params.customerId) {
        await client.from('conversations').update({ last_message_at: nowIso(), flow: params.flow }).eq('id', data.id);
        return data as Conversation;
      }
    }
    const { data: openConv } = await client
      .from('conversations')
      .select('*')
      .eq('customer_id', params.customerId)
      .eq('status', 'open')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openConv) {
      await client.from('conversations').update({ last_message_at: nowIso() }).eq('id', openConv.id);
      return openConv as Conversation;
    }
    const { data, error } = await client
      .from('conversations')
      .insert({ customer_id: params.customerId, flow: params.flow })
      .select('*')
      .single();
    if (error) throw error;
    return data as Conversation;
  } catch {
    return fallback();
  }
}

export async function saveMessage(params: {
  conversationId: string;
  role: Message['role'];
  content: string;
  ui?: Message['ui'];
  toolCalls?: unknown[];
  servedBy?: string | null;
  latencyMs?: number | null;
}): Promise<Message> {
  const client = sb();
  const record: Message = {
    id: uid(),
    conversation_id: params.conversationId,
    role: params.role,
    content: params.content,
    ui: params.ui ?? null,
    tool_calls: params.toolCalls ?? null,
    served_by: params.servedBy ?? null,
    latency_ms: params.latencyMs ?? null,
    created_at: nowIso(),
  };

  if (!client) {
    memoryStore.messages.set(record.id, record);
    return record;
  }

  try {
    const { data, error } = await client
      .from('messages')
      .insert({
        conversation_id: record.conversation_id,
        role: record.role,
        content: record.content,
        ui: record.ui,
        tool_calls: record.tool_calls,
        served_by: record.served_by,
        latency_ms: record.latency_ms,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as Message;
  } catch {
    memoryStore.messages.set(record.id, record);
    return record;
  }
}

export async function recentMessages(conversationId: string, limit = 30): Promise<Message[]> {
  const client = sb();
  if (!client) {
    return [...memoryStore.messages.values()]
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-limit);
  }
  const { data } = await client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data as Message[] | null) ?? [];
}

export async function setConversationSummary(conversationId: string, summary: string): Promise<void> {
  const client = sb();
  if (!client) {
    const c = memoryStore.conversations.get(conversationId);
    if (c) c.summary = summary;
    return;
  }
  await client.from('conversations').update({ summary }).eq('id', conversationId);
}

/* ── memories ──────────────────────────────────────────────────────────────── */

export async function upsertMemory(params: {
  customerId: string;
  kind: MemoryKind;
  key: string;
  value: string;
  confidence: number;
  sourceMessageId?: string | null;
}): Promise<Memory | null> {
  const client = sb();
  const normalizedKey = params.key.trim().slice(0, 64).toLowerCase();

  // Low-confidence facts never overwrite high-confidence ones.
  const shouldOverwrite = (existing?: Memory | null) =>
    !existing || params.confidence >= existing.confidence - 0.05;

  if (!client) {
    const existing = [...memoryStore.memories.values()].find(
      (m) => m.customer_id === params.customerId && m.kind === params.kind && m.key === normalizedKey,
    );
    if (existing) {
      if (!shouldOverwrite(existing)) return existing;
      existing.value = params.value.slice(0, 500);
      existing.confidence = Math.max(existing.confidence, params.confidence);
      existing.updated_at = nowIso();
      return existing;
    }
    const created: Memory = {
      id: uid(),
      customer_id: params.customerId,
      kind: params.kind,
      key: normalizedKey,
      value: params.value.slice(0, 500),
      confidence: params.confidence,
      source_message_id: params.sourceMessageId ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    memoryStore.memories.set(created.id, created);
    return created;
  }

  try {
    const { data: existing } = await client
      .from('memories')
      .select('*')
      .eq('customer_id', params.customerId)
      .eq('kind', params.kind)
      .eq('key', normalizedKey)
      .maybeSingle();

    if (existing && !shouldOverwrite(existing as Memory)) return existing as Memory;

    const { data, error } = await client
      .from('memories')
      .upsert(
        {
          customer_id: params.customerId,
          kind: params.kind,
          key: normalizedKey,
          value: params.value.slice(0, 500),
          confidence: Math.max(params.confidence, (existing as Memory | null)?.confidence ?? 0),
          source_message_id: params.sourceMessageId ?? null,
          updated_at: nowIso(),
        },
        { onConflict: 'customer_id,kind,key' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as Memory;
  } catch {
    return null;
  }
}

export async function listMemories(customerId: string): Promise<Memory[]> {
  if (!sb()) await ensureSeeded();
  const client = sb();
  if (!client) {
    return [...memoryStore.memories.values()]
      .filter((m) => m.customer_id === customerId)
      .sort((a, b) => b.confidence - a.confidence);
  }
  const { data } = await client
    .from('memories')
    .select('*')
    .eq('customer_id', customerId)
    .order('confidence', { ascending: false })
    .limit(60);
  return (data as Memory[] | null) ?? [];
}

export async function deleteMemory(customerId: string, memoryId?: string): Promise<number> {
  const client = sb();
  if (!client) {
    let n = 0;
    for (const [id, m] of memoryStore.memories) {
      if (m.customer_id === customerId && (!memoryId || id === memoryId)) {
        memoryStore.memories.delete(id);
        n += 1;
      }
    }
    return n;
  }
  let query = client.from('memories').delete().eq('customer_id', customerId);
  if (memoryId) query = query.eq('id', memoryId);
  const { error } = await query;
  return error ? 0 : 1;
}

/* ── tag consultations ─────────────────────────────────────────────────────── */

export async function upsertConsultation(params: {
  customerId: string;
  conversationId: string | null;
  objectType?: string | null;
  budgetHint?: string | null;
  recommendedProduct?: string | null;
  objections?: string[];
  stage?: TagConsultation['stage'];
}): Promise<TagConsultation> {
  const client = sb();
  const fallback = (): TagConsultation => {
    const existing = [...memoryStore.tag_consultations.values()].find(
      (c) => c.customer_id === params.customerId,
    );
    if (existing) {
      if (params.objectType) existing.object_type = params.objectType;
      if (params.budgetHint) existing.budget_hint = params.budgetHint;
      if (params.recommendedProduct) existing.recommended_product = params.recommendedProduct;
      if (params.objections?.length) {
        existing.objections = [...new Set([...existing.objections, ...params.objections])];
      }
      if (params.stage) existing.stage = params.stage;
      return existing;
    }
    const created: TagConsultation = {
      id: uid(),
      customer_id: params.customerId,
      conversation_id: params.conversationId,
      object_type: params.objectType ?? null,
      budget_hint: params.budgetHint ?? null,
      recommended_product: params.recommendedProduct ?? null,
      objections: params.objections ?? [],
      stage: params.stage ?? 'discovery',
      created_at: nowIso(),
    };
    memoryStore.tag_consultations.set(created.id, created);
    return created;
  };

  if (!client) return fallback();

  try {
    const { data: existing } = await client
      .from('tag_consultations')
      .select('*')
      .eq('customer_id', params.customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const prev = existing as TagConsultation;
      const patch = {
        object_type: params.objectType ?? prev.object_type,
        budget_hint: params.budgetHint ?? prev.budget_hint,
        recommended_product: params.recommendedProduct ?? prev.recommended_product,
        objections: [...new Set([...(prev.objections ?? []), ...(params.objections ?? [])])],
        stage: params.stage ?? prev.stage,
      };
      const { data } = await client.from('tag_consultations').update(patch).eq('id', prev.id).select('*').single();
      return (data ?? prev) as TagConsultation;
    }

    const { data, error } = await client
      .from('tag_consultations')
      .insert({
        customer_id: params.customerId,
        conversation_id: params.conversationId,
        object_type: params.objectType ?? null,
        budget_hint: params.budgetHint ?? null,
        recommended_product: params.recommendedProduct ?? null,
        objections: params.objections ?? [],
        stage: params.stage ?? 'discovery',
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as TagConsultation;
  } catch {
    return fallback();
  }
}

export async function latestConsultation(customerId: string): Promise<TagConsultation | null> {
  const client = sb();
  if (!client) {
    return (
      [...memoryStore.tag_consultations.values()]
        .filter((c) => c.customer_id === customerId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }
  const { data } = await client
    .from('tag_consultations')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TagConsultation | null) ?? null;
}

/* ── lost reports ──────────────────────────────────────────────────────────── */

export async function createLostReport(params: {
  customerId: string | null;
  itemType: string;
  imei?: string | null;
  brandModel?: string | null;
  lastSeenPlace?: string | null;
  lastSeenAt?: string | null;
}): Promise<LostReport> {
  const code = trackingCode('L');
  const client = sb();
  const fallback = (): LostReport => {
    const created: LostReport = {
      id: uid(),
      tracking_code: code,
      customer_id: params.customerId,
      item_type: params.itemType,
      imei: params.imei ?? null,
      brand_model: params.brandModel ?? null,
      last_seen_place: params.lastSeenPlace ?? null,
      last_seen_at: params.lastSeenAt ?? null,
      status: 'submitted',
      is_demo: true,
      created_at: nowIso(),
    };
    memoryStore.lost_reports.set(created.id, created);
    return created;
  };
  if (!client) return fallback();
  try {
    const { data, error } = await client
      .from('lost_reports')
      .insert({
        tracking_code: code,
        customer_id: params.customerId,
        item_type: params.itemType,
        imei: params.imei ?? null,
        brand_model: params.brandModel ?? null,
        last_seen_place: params.lastSeenPlace ?? null,
        last_seen_at: params.lastSeenAt ?? null,
        status: 'submitted',
        is_demo: true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as LostReport;
  } catch {
    return fallback();
  }
}

export async function listLostReports(customerId: string): Promise<LostReport[]> {
  const client = sb();
  if (!client) {
    return [...memoryStore.lost_reports.values()]
      .filter((r) => r.customer_id === customerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data } = await client
    .from('lost_reports')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data as LostReport[] | null) ?? [];
}

/**
 * Demo aid: moves every open ticket of a customer one step forward.
 * Honest about what it is — `GET /api/demo/fast-forward` exists only for the
 * presenter, never called from the customer UI.
 */
export async function fastForwardLostReports(customerId: string): Promise<LostReport[]> {
  if (!sb()) await ensureSeeded();
  const client = sb();
  const { nextStatus } = await import('@/lib/status');

  if (!client) {
    const updated: LostReport[] = [];
    for (const report of memoryStore.lost_reports.values()) {
      if (report.customer_id !== customerId) continue;
      if (report.status === 'delivered') continue;
      report.status = nextStatus(report.status);
      updated.push(report);
    }
    return updated;
  }

  const { data } = await client.from('lost_reports').select('*').eq('customer_id', customerId).limit(20);
  const rows = (data as LostReport[] | null) ?? [];
  const updated: LostReport[] = [];
  for (const report of rows) {
    if (report.status === 'delivered') continue;
    const status = nextStatus(report.status);
    await client.from('lost_reports').update({ status }).eq('id', report.id);
    updated.push({ ...report, status });
  }
  return updated;
}

export async function getLostReportByCode(code: string): Promise<LostReport | null> {
  const client = sb();
  if (!client) {
    return [...memoryStore.lost_reports.values()].find((r) => r.tracking_code === code) ?? null;
  }
  const { data } = await client.from('lost_reports').select('*').eq('tracking_code', code).maybeSingle();
  return (data as LostReport | null) ?? null;
}

/* ── found reports & secure calls ──────────────────────────────────────────── */

export async function createFoundReport(params: {
  customerId: string | null;
  itemType: string;
  identifierKind: 'qr' | 'serial';
  identifier: string;
  descriptionPublic: string;
  descriptionPrivate?: string | null;
  area?: string | null;
}): Promise<FoundReport> {
  const code = trackingCode('F');
  const client = sb();
  const fallback = (): FoundReport => {
    const created: FoundReport = {
      id: uid(),
      tracking_code: code,
      reporter_customer_id: params.customerId,
      item_type: params.itemType,
      identifier_kind: params.identifierKind,
      identifier: params.identifier,
      description_public: params.descriptionPublic,
      description_private: params.descriptionPrivate ?? null,
      area: params.area ?? null,
      status: 'registered',
      created_at: nowIso(),
    };
    memoryStore.found_reports.set(created.id, created);
    return created;
  };
  if (!client) return fallback();
  try {
    const { data, error } = await client
      .from('found_reports')
      .insert({
        tracking_code: code,
        reporter_customer_id: params.customerId,
        item_type: params.itemType,
        identifier_kind: params.identifierKind,
        identifier: params.identifier,
        description_public: params.descriptionPublic,
        description_private: params.descriptionPrivate ?? null,
        area: params.area ?? null,
        status: 'registered',
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as FoundReport;
  } catch {
    return fallback();
  }
}

export async function createSecureCall(foundReportId: string, minutes = 15): Promise<SecureCall> {
  const relay = `۰۲۱-۹۱۰۰${Math.floor(1000 + Math.random() * 8999)}`;
  const expires = new Date(Date.now() + minutes * 60_000).toISOString();
  const client = sb();
  const fallback = (): SecureCall => {
    const created: SecureCall = {
      id: uid(),
      found_report_id: foundReportId,
      relay_number: relay,
      expires_at: expires,
      status: 'active',
    };
    memoryStore.secure_calls.set(created.id, created);
    return created;
  };
  if (!client) return fallback();
  try {
    const { data, error } = await client
      .from('secure_calls')
      .insert({ found_report_id: foundReportId, relay_number: relay, expires_at: expires, status: 'active' })
      .select('*')
      .single();
    if (error) throw error;
    return data as SecureCall;
  } catch {
    return fallback();
  }
}

/* ── registry lookup ───────────────────────────────────────────────────────── */

export async function lookupRegistry(nationalIdHash: string): Promise<RegistryEntry[]> {
  if (!sb()) await ensureSeeded();
  const client = sb();
  if (!client) {
    return [...memoryStore.registry_entries.values()].filter(
      (e) => e.national_id_hash === nationalIdHash && e.status === 'held',
    );
  }
  const { data } = await client
    .from('registry_entries')
    .select('*')
    .eq('national_id_hash', nationalIdHash)
    .eq('status', 'held')
    .limit(5);
  return (data as RegistryEntry[] | null) ?? [];
}

/* ── post shipments & newspaper ads ────────────────────────────────────────── */

export async function createPostShipment(params: {
  customerId: string | null;
  lostReportId?: string | null;
}): Promise<PostShipment> {
  const code = trackingCode('P');
  const client = sb();
  const fallback = (): PostShipment => {
    const created: PostShipment = {
      id: uid(),
      tracking_code: code,
      customer_id: params.customerId,
      lost_report_id: params.lostReportId ?? null,
      status: 'requested',
      created_at: nowIso(),
    };
    memoryStore.post_shipments.set(created.id, created);
    return created;
  };
  if (!client) return fallback();
  try {
    const { data, error } = await client
      .from('post_shipments')
      .insert({
        tracking_code: code,
        customer_id: params.customerId,
        lost_report_id: params.lostReportId ?? null,
        status: 'requested',
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as PostShipment;
  } catch {
    return fallback();
  }
}

export async function createNewspaperAd(params: {
  customerId: string | null;
  docType: string;
  newspaper: string;
  publishDate: string;
  priceBreakdown: unknown;
  adText: string;
}): Promise<NewspaperAd> {
  const code = trackingCode('N');
  const client = sb();
  const fallback = (): NewspaperAd => {
    const created: NewspaperAd = {
      id: uid(),
      tracking_code: code,
      customer_id: params.customerId,
      doc_type: params.docType,
      newspaper: params.newspaper,
      publish_date: params.publishDate,
      price_breakdown: params.priceBreakdown,
      ad_text: params.adText,
      status: 'quoted',
      created_at: nowIso(),
    };
    memoryStore.newspaper_ads.set(created.id, created);
    return created;
  };
  if (!client) return fallback();
  try {
    const { data, error } = await client
      .from('newspaper_ads')
      .insert({
        tracking_code: code,
        customer_id: params.customerId,
        doc_type: params.docType,
        newspaper: params.newspaper,
        publish_date: params.publishDate,
        price_breakdown: params.priceBreakdown as never,
        ad_text: params.adText,
        status: 'quoted',
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as NewspaperAd;
  } catch {
    return fallback();
  }
}

/* ── events ────────────────────────────────────────────────────────────────── */

export async function logEvent(params: {
  customerId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const client = sb();
  const record: AppEvent = {
    id: uid(),
    customer_id: params.customerId ?? null,
    type: params.type,
    payload: params.payload ?? {},
    created_at: nowIso(),
  };
  if (!client) {
    memoryStore.events.set(record.id, record);
    return;
  }
  try {
    await client.from('events').insert({
      customer_id: record.customer_id,
      type: record.type,
      payload: record.payload,
    });
  } catch {
    memoryStore.events.set(record.id, record);
  }
}

/* ── admin read models ─────────────────────────────────────────────────────── */

export async function adminSnapshot(): Promise<{
  customers: Customer[];
  conversations: Conversation[];
  messages: Message[];
  memories: Memory[];
  consultations: TagConsultation[];
  lostReports: LostReport[];
  foundReports: FoundReport[];
  events: AppEvent[];
  source: 'supabase' | 'memory';
}> {
  if (!sb()) await ensureSeeded();
  const client = sb();
  if (!client) {
    const byDate = <T extends { created_at: string }>(rows: T[]) =>
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      customers: [...memoryStore.customers.values()].sort((a, b) =>
        b.last_seen_at.localeCompare(a.last_seen_at),
      ),
      conversations: [...memoryStore.conversations.values()],
      messages: byDate([...memoryStore.messages.values()]).slice(0, 60),
      memories: [...memoryStore.memories.values()],
      consultations: [...memoryStore.tag_consultations.values()],
      lostReports: byDate([...memoryStore.lost_reports.values()]),
      foundReports: byDate([...memoryStore.found_reports.values()]),
      events: byDate([...memoryStore.events.values()]).slice(0, 60),
      source: 'memory',
    };
  }

  const [customers, conversations, messages, memories, consultations, lostReports, foundReports, events] =
    await Promise.all([
      client.from('customers').select('*').order('last_seen_at', { ascending: false }).limit(60),
      client.from('conversations').select('*').order('last_message_at', { ascending: false }).limit(60),
      client.from('messages').select('*').order('created_at', { ascending: false }).limit(60),
      client.from('memories').select('*').limit(200),
      client.from('tag_consultations').select('*').order('created_at', { ascending: false }).limit(60),
      client.from('lost_reports').select('*').order('created_at', { ascending: false }).limit(60),
      client.from('found_reports').select('*').order('created_at', { ascending: false }).limit(60),
      client.from('events').select('*').order('created_at', { ascending: false }).limit(60),
    ]);

  return {
    customers: (customers.data as Customer[] | null) ?? [],
    conversations: (conversations.data as Conversation[] | null) ?? [],
    messages: (messages.data as Message[] | null) ?? [],
    memories: (memories.data as Memory[] | null) ?? [],
    consultations: (consultations.data as TagConsultation[] | null) ?? [],
    lostReports: (lostReports.data as LostReport[] | null) ?? [],
    foundReports: (foundReports.data as FoundReport[] | null) ?? [],
    events: (events.data as AppEvent[] | null) ?? [],
    source: 'supabase',
  };
}
