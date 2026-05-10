-- Run once in Supabase SQL Editor (existing projects). New installs: merge into schema.sql manually if desired.

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
