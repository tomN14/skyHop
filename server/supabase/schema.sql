-- Sky Hop — run in Supabase → SQL Editor → New query → Paste → Run
-- Uses bigint epoch ms for created_at to match the Node JSON store.

create table if not exists public.skyhop_users (
  id bigserial primary key,
  username text not null,
  username_lower text not null unique,
  salt text not null,
  hash text not null,
  role text not null default 'player',
  ban_until_ms bigint,
  ban_reason text,
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

-- User-created levels
create table if not exists public.skyhop_user_levels (
  id uuid primary key default gen_random_uuid(),
  author_id bigint not null references public.skyhop_users (id) on delete cascade,
  title text not null,
  title_lower text not null,
  data jsonb not null,
  play_count bigint not null default 0,
  beaten_verified boolean not null default false,
  published boolean not null default false,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_levels_author_id_idx on public.skyhop_user_levels (author_id);
create index if not exists skyhop_levels_title_lower_idx on public.skyhop_user_levels (title_lower);
create index if not exists skyhop_levels_published_play_idx on public.skyhop_user_levels (published, play_count desc);

-- Player reports (moderation). Run server/supabase/moderation.sql on existing DBs, or use this file for new projects.
create table if not exists public.skyhop_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id bigint not null references public.skyhop_users (id) on delete cascade,
  reported_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  moderator_note text,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists skyhop_reports_status_idx on public.skyhop_reports (status);

-- Coins, skins, server-stored built-in campaign, online coin claims (see extend_v2_coins_builtin.sql for ALTER on existing DBs)
alter table public.skyhop_users add column if not exists coins bigint not null default 0;
alter table public.skyhop_users add column if not exists skin_texture text;

create table if not exists public.skyhop_builtin_campaign (
  id smallint primary key default 1 constraint skyhop_builtin_singleton check (id = 1),
  stages jsonb not null default '[]'::jsonb,
  updated_at bigint not null default 0
);

insert into public.skyhop_builtin_campaign (id, stages, updated_at)
values (1, '[]'::jsonb, 0)
on conflict (id) do nothing;

create table if not exists public.skyhop_online_coin_claims (
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  level_id uuid not null references public.skyhop_user_levels (id) on delete cascade,
  coin_index integer not null,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint,
  primary key (user_id, level_id, coin_index)
);

create index if not exists skyhop_online_coin_claims_level_idx on public.skyhop_online_coin_claims (level_id);
