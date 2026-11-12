-- ═══════════════════════════════════════════════════════════════════════════
--  Realtime — powers the live admin dashboard
--  Only the tables the dashboard subscribes to.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table lost_reports;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table found_reports;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table tag_consultations;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null; end $$;

-- Realtime needs the full row for the dashboard's live feed.
alter table messages          replica identity full;
alter table lost_reports      replica identity full;
alter table found_reports     replica identity full;
alter table tag_consultations replica identity full;
alter table events            replica identity full;
