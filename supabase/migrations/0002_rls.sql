-- ═══════════════════════════════════════════════════════════════════════════
--  Row Level Security
--  Model: customers may READ their own rows; ALL writes go through server
--  routes using the service role (which bypasses RLS by design).
--  The admin dashboard only reads via the service role behind a password gate.
-- ═══════════════════════════════════════════════════════════════════════════

alter table customers          enable row level security;
alter table conversations      enable row level security;
alter table messages           enable row level security;
alter table memories           enable row level security;
alter table tag_consultations  enable row level security;
alter table lost_reports       enable row level security;
alter table found_reports      enable row level security;
alter table registry_entries   enable row level security;
alter table secure_calls       enable row level security;
alter table post_shipments     enable row level security;
alter table newspaper_ads      enable row level security;
alter table events             enable row level security;

-- ── customers: self only ───────────────────────────────────────────────────
drop policy if exists customers_select_self on customers;
create policy customers_select_self on customers
  for select using (auth.uid() = auth_user_id);

-- ── conversations / messages: owned by the authed customer ─────────────────
drop policy if exists conversations_select_own on conversations;
create policy conversations_select_own on conversations
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists messages_select_own on messages;
create policy messages_select_own on messages
  for select using (
    conversation_id in (
      select c.id from conversations c
      join customers cu on cu.id = c.customer_id
      where cu.auth_user_id = auth.uid()
    )
  );

-- ── memories: self only (delete is done server-side, but allow self-delete) ─
drop policy if exists memories_select_own on memories;
create policy memories_select_own on memories
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

-- ── reports & consultations: self only ────────────────────────────────────
drop policy if exists lost_reports_select_own on lost_reports;
create policy lost_reports_select_own on lost_reports
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists found_reports_select_own on found_reports;
create policy found_reports_select_own on found_reports
  for select using (
    reporter_customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists consultations_select_own on tag_consultations;
create policy consultations_select_own on tag_consultations
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

-- ── registry: NEVER readable by anon/authed clients ───────────────────────
-- No select policy is created on purpose: only the service role can read it.
-- This is what keeps the national-ID hash pool private.

-- ── events: no client access at all ───────────────────────────────────────
-- (same reasoning: service-role only)
