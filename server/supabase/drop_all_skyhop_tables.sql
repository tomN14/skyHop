-- Remove ALL Sky Hop tables from the current Supabase project.
-- USE ONLY on the WRONG / accidental project — NOT the one in SUPABASE_URL for live play.
--
-- Before running:
--   1) Supabase dashboard → Project Settings → confirm this is NOT your live game DB.
--   2) Optional: select current_database();
--
-- Does NOT delete Storage buckets (skyhop-profiles, skyhop-recordings, etc.).
-- Remove those manually under Storage if you created them here by mistake.

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'skyhop\_%' escape '\'
    order by tablename
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
    raise notice 'Dropped public.%', r.tablename;
  end loop;
end $$;

-- Verify nothing left:
-- select tablename from pg_tables where schemaname = 'public' and tablename like 'skyhop_%';
