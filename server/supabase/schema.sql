-- Sky Hop — run in Supabase → SQL Editor → New query → Paste → Run
-- Uses bigint epoch ms for created_at to match the Node JSON store.

create table if not exists public.skyhop_users (
  id bigserial primary key,
  username text not null,
  username_lower text not null unique,
  salt text not null,
  hash text not null,
  role text not null default 'player', -- player | report_advisor | moderator | admin | owner
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
  difficulty text check (difficulty is null or difficulty in ('easy', 'normal', 'hard')),
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_runs_user_id_idx on public.skyhop_runs (user_id);
create index if not exists skyhop_runs_campaign_diff_time_idx
  on public.skyhop_runs (difficulty, time_ms)
  where source = 'campaign' and difficulty is not null;

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
alter table public.skyhop_users add column if not exists profile_bio text;
alter table public.skyhop_users add column if not exists profile_avatar_path text;
alter table public.skyhop_users add column if not exists disabled_at bigint;
alter table public.skyhop_users add column if not exists promotion_from text;
alter table public.skyhop_users add column if not exists promotion_to text;
alter table public.skyhop_users add column if not exists strikes integer not null default 0;
alter table public.skyhop_users add column if not exists mods_warning_seen boolean not null default false;
alter table public.skyhop_users add column if not exists appeal_decline_reason text;

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

create table if not exists public.skyhop_user_texture_grants (
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  texture_filename text not null,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint,
  primary key (user_id, texture_filename)
);

create index if not exists skyhop_texture_grants_user_idx on public.skyhop_user_texture_grants (user_id);

create table if not exists public.skyhop_friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  to_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint,
  constraint skyhop_friend_requests_no_self check (from_user_id <> to_user_id)
);

create index if not exists skyhop_friend_requests_to_pending_idx
  on public.skyhop_friend_requests (to_user_id)
  where status = 'pending';

create unique index if not exists skyhop_friend_requests_one_pending_pair_idx
  on public.skyhop_friend_requests (from_user_id, to_user_id)
  where status = 'pending';

create index if not exists skyhop_friend_requests_user_accepted_idx
  on public.skyhop_friend_requests (from_user_id, to_user_id)
  where status = 'accepted';

create table if not exists public.skyhop_friend_chat (
  id uuid primary key default gen_random_uuid(),
  from_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  to_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  body text not null,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_friend_chat_pair_idx
  on public.skyhop_friend_chat (from_user_id, to_user_id, created_at);

-- Run recordings (see extend_v7_recordings.sql for Storage bucket)
create table if not exists public.skyhop_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  title text not null,
  source text not null default 'campaign',
  storage_path text not null,
  mime_type text not null default 'video/webm',
  byte_size bigint not null default 0,
  anticheat_on boolean not null default true,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_recordings_user_created_idx
  on public.skyhop_recordings (user_id, created_at desc);

-- Ban appeals (see extend_v14_ban_appeals.sql on existing DBs)
create table if not exists public.skyhop_ban_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  outcome text,
  decline_reason text,
  created_at bigint not null,
  resolved_at bigint
);

create index if not exists skyhop_ban_appeals_status_idx
  on public.skyhop_ban_appeals (status, created_at desc);

create table if not exists public.skyhop_ban_appeal_votes (
  appeal_id uuid not null references public.skyhop_ban_appeals (id) on delete cascade,
  voter_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  vote text not null,
  created_at bigint not null,
  primary key (appeal_id, voter_user_id)
);

-- Admin (exactly one, assigned in-game): demote/longer-ban requests + 1-day ban quota
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
