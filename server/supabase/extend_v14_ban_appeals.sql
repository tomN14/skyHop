-- Ban appeals + mod/owner votes. Run after extend_v13.
--
-- Requires public.skyhop_users (and the rest of Sky Hop). If you see:
--   relation "public.skyhop_users" does not exist
-- then this Supabase project has not been bootstrapped yet:
--   1) SQL Editor → run server/supabase/schema.sql
--   2) Run extend_v2 … extend_v13 in order (see server/README.md)
--   3) Run this file again
--
-- Check: select to_regclass('public.skyhop_users');  -- should not be null

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run server/supabase/schema.sql, then extend_v2 through extend_v13, then extend_v14.';
  end if;
end $$;

create table if not exists public.skyhop_ban_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  outcome text,
  created_at bigint not null,
  resolved_at bigint
);

create index if not exists skyhop_ban_appeals_status_idx
  on public.skyhop_ban_appeals (status, created_at desc);

create table if not exists public.skyhop_ban_appeal_votes (
  appeal_id uuid not null references public.skyhop_ban_appeals(id) on delete cascade,
  voter_user_id bigint not null references public.skyhop_users(id) on delete cascade,
  vote text not null,
  created_at bigint not null,
  primary key (appeal_id, voter_user_id)
);
