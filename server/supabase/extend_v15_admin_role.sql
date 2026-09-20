-- Admin role support: staff requests (demote / longer ban) + 1-day ban quota log.
-- Run after extend_v14. Role itself is free-form text on skyhop_users (no extra column).
-- Do not assign an admin here — the owner sets it in-game after deploy.

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run schema.sql, then extend_v2 through extend_v14, then this file.';
  end if;
end $$;

create table if not exists public.skyhop_staff_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  from_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  target_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  owner_note text,
  created_at bigint not null,
  resolved_at bigint
);

create index if not exists skyhop_staff_requests_status_idx
  on public.skyhop_staff_requests (status, created_at desc);

create table if not exists public.skyhop_admin_ban_log (
  id bigserial primary key,
  admin_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  target_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  created_at bigint not null
);

create index if not exists skyhop_admin_ban_log_admin_created_idx
  on public.skyhop_admin_ban_log (admin_user_id, created_at desc);
