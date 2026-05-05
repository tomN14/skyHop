-- Sky Hop — run in Supabase → SQL Editor → New query → Paste → Run
-- Uses bigint epoch ms for created_at to match the Node JSON store.

create table if not exists public.skyhop_users (
  id bigserial primary key,
  username text not null,
  username_lower text not null unique,
  salt text not null,
  hash text not null,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create table if not exists public.skyhop_sessions (
  token text primary key,
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  expires_at bigint not null
);

create index if not exists skyhop_sessions_user_id_idx on public.skyhop_sessions (user_id);
create index if not exists skyhop_sessions_expires_at_idx on public.skyhop_sessions (expires_at);

create table if not exists public.skyhop_runs (
  id bigserial primary key,
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  time_ms bigint not null,
  deaths integer not null,
  source text not null check (source in ('campaign', 'race')),
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_runs_user_id_idx on public.skyhop_runs (user_id);

create table if not exists public.skyhop_user_achievements (
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  achievement_id text not null,
  unlocked_at bigint not null,
  primary key (user_id, achievement_id)
);
