-- ═══════════════════════════════════════════════════════════════════════════
--  Aniyab Smart Assistant v2 — initial schema
--  Run order: 0001 → 0002 → 0003.  Everything is demo data (is_demo = true).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type memory_kind as enum ('fact','preference','item','event','concern');
exception when duplicate_object then null; end $$;

do $$ begin
  create type consultation_stage as enum ('discovery','recommended','objection','cta_shown','clicked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lost_status as enum ('submitted','referred','reviewing','matched','delivered');
exception when duplicate_object then null; end $$;

-- ── customers ──────────────────────────────────────────────────────────────
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,
  phone           text unique,
  full_name       text,
  preferred_name  text,
  city            text,
  visit_count     int  not null default 1,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  consent_memory  boolean not null default true,
  is_demo         boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists customers_last_seen_idx on customers (last_seen_at desc);

-- ── conversations & messages ───────────────────────────────────────────────
create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  flow            text not null default 'general',
  summary         text,
  status          text not null default 'open',
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists conversations_customer_idx on conversations (customer_id);
create index if not exists conversations_last_msg_idx on conversations (last_message_at desc);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text not null default '',
  ui              jsonb,
  tool_calls      jsonb,
  served_by       text,
  latency_ms      int,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
create index if not exists messages_created_idx on messages (created_at desc);

-- ── long-term memory ───────────────────────────────────────────────────────
create table if not exists memories (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(id) on delete cascade,
  kind              memory_kind not null,
  key               text not null,
  value             text not null,
  confidence        real not null default 0.6 check (confidence >= 0 and confidence <= 1),
  source_message_id uuid references messages(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (customer_id, kind, key)
);
create index if not exists memories_customer_idx on memories (customer_id);

-- ── tag consultations (Flow A) ─────────────────────────────────────────────
create table if not exists tag_consultations (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id) on delete cascade,
  conversation_id     uuid references conversations(id) on delete set null,
  object_type         text,
  budget_hint         text,
  recommended_product text,
  objections          text[] not null default '{}',
  stage               consultation_stage not null default 'discovery',
  created_at          timestamptz not null default now()
);
create index if not exists consultations_customer_idx on tag_consultations (customer_id);

-- ── lost / found / registry (Flows B, C, D) ────────────────────────────────
create table if not exists lost_reports (
  id              uuid primary key default gen_random_uuid(),
  tracking_code   text not null unique,
  customer_id     uuid references customers(id) on delete set null,
  item_type       text not null,
  imei            text,
  brand_model     text,
  last_seen_place text,
  last_seen_at    text,
  status          lost_status not null default 'submitted',
  is_demo         boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists lost_reports_customer_idx on lost_reports (customer_id);
create index if not exists lost_reports_code_idx on lost_reports (tracking_code);

create table if not exists found_reports (
  id                   uuid primary key default gen_random_uuid(),
  tracking_code        text not null unique,
  reporter_customer_id uuid references customers(id) on delete set null,
  item_type            text not null,
  identifier_kind      text not null check (identifier_kind in ('qr','serial')),
  identifier           text not null,
  description_public   text not null,
  description_private  text,
  area                 text,
  status               text not null default 'registered',
  is_demo              boolean not null default true,
  created_at           timestamptz not null default now()
);
create index if not exists found_reports_code_idx on found_reports (tracking_code);

create table if not exists registry_entries (
  id                 uuid primary key default gen_random_uuid(),
  national_id_hash   text not null,
  item_type          text not null,
  description_masked text not null,
  held_at            text not null,
  received_at        timestamptz not null default now(),
  status             text not null default 'held',
  is_demo            boolean not null default true
);
create index if not exists registry_hash_idx on registry_entries (national_id_hash);

create table if not exists secure_calls (
  id              uuid primary key default gen_random_uuid(),
  found_report_id uuid not null references found_reports(id) on delete cascade,
  relay_number    text not null,
  expires_at      timestamptz not null,
  status          text not null default 'active'
);

create table if not exists post_shipments (
  id              uuid primary key default gen_random_uuid(),
  tracking_code   text not null unique,
  customer_id     uuid references customers(id) on delete set null,
  lost_report_id  uuid references lost_reports(id) on delete set null,
  status          text not null default 'requested',
  created_at      timestamptz not null default now()
);

create table if not exists newspaper_ads (
  id              uuid primary key default gen_random_uuid(),
  tracking_code   text not null unique,
  customer_id     uuid references customers(id) on delete set null,
  doc_type        text not null,
  newspaper       text not null,
  publish_date    text,
  price_breakdown jsonb,
  ad_text         text,
  status          text not null default 'quoted',
  created_at      timestamptz not null default now()
);

-- ── analytics ──────────────────────────────────────────────────────────────
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  type        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists events_created_idx on events (created_at desc);
create index if not exists events_type_idx on events (type);
