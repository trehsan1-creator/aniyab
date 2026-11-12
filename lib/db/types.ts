/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/db/types.ts — shared record shapes (mirror of supabase/migrations)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Flow = 'smart-tag' | 'lost-report' | 'found-report' | 'general';

export type MemoryKind = 'fact' | 'preference' | 'item' | 'event' | 'concern';

export interface Customer {
  id: string;
  auth_user_id: string | null;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  city: string | null;
  visit_count: number;
  first_seen_at: string;
  last_seen_at: string;
  consent_memory: boolean;
  is_demo: boolean;
}

export interface Conversation {
  id: string;
  customer_id: string;
  flow: Flow;
  summary: string | null;
  status: 'open' | 'closed';
  started_at: string;
  last_message_at: string;
}

export interface MessageUi {
  card?: string;
  props?: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  ui: MessageUi | null;
  tool_calls: unknown[] | null;
  served_by: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface Memory {
  id: string;
  customer_id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  confidence: number;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagConsultation {
  id: string;
  customer_id: string;
  conversation_id: string | null;
  object_type: string | null;
  budget_hint: string | null;
  recommended_product: string | null;
  objections: string[];
  stage: 'discovery' | 'recommended' | 'objection' | 'cta_shown' | 'clicked';
  created_at: string;
}

export type LostReportStatus = 'submitted' | 'referred' | 'reviewing' | 'matched' | 'delivered';

export interface LostReport {
  id: string;
  tracking_code: string;
  customer_id: string | null;
  item_type: string;
  imei: string | null;
  brand_model: string | null;
  last_seen_place: string | null;
  last_seen_at: string | null;
  status: LostReportStatus;
  is_demo: boolean;
  created_at: string;
}

export interface FoundReport {
  id: string;
  tracking_code: string;
  reporter_customer_id: string | null;
  item_type: string;
  identifier_kind: 'qr' | 'serial';
  identifier: string;
  description_public: string;
  description_private: string | null;
  area: string | null;
  status: 'registered' | 'owner_notified' | 'delivered';
  created_at: string;
}

export interface RegistryEntry {
  id: string;
  national_id_hash: string;
  item_type: string;
  description_masked: string;
  held_at: string;
  received_at: string;
  status: 'held' | 'delivered' | 'archived';
}

export interface SecureCall {
  id: string;
  found_report_id: string;
  relay_number: string;
  expires_at: string;
  status: 'active' | 'expired' | 'ended';
}

export interface PostShipment {
  id: string;
  tracking_code: string;
  customer_id: string | null;
  lost_report_id: string | null;
  status: 'requested' | 'picked_up' | 'in_transit' | 'delivered';
  created_at: string;
}

export interface NewspaperAd {
  id: string;
  tracking_code: string;
  customer_id: string | null;
  doc_type: string;
  newspaper: string;
  publish_date: string;
  price_breakdown: unknown;
  ad_text: string;
  status: 'quoted' | 'confirmed';
  created_at: string;
}

export interface AppEvent {
  id: string;
  customer_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
