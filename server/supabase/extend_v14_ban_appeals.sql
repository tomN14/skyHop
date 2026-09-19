-- Ban appeals + mod/owner votes. Run after extend_v13.

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
