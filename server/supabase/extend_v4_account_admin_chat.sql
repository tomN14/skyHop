-- Account disable flag, friend chat (profanity-censored on server). Run in Supabase SQL Editor.

alter table public.skyhop_users add column if not exists disabled_at bigint;

create table if not exists public.skyhop_friend_chat (
  id uuid primary key default gen_random_uuid(),
  from_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  to_user_id bigint not null references public.skyhop_users (id) on delete cascade,
  body text not null,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_friend_chat_pair_idx
  on public.skyhop_friend_chat (from_user_id, to_user_id, created_at);
