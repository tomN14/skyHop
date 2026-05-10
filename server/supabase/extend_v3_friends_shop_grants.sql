-- Friends, texture grants (shop + owner gifts), optional backfill from existing skin_texture.
-- Run in Supabase SQL Editor on existing DBs.

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

-- One-time backfill: treat current equipped skin as already granted (migration comfort).
insert into public.skyhop_user_texture_grants (user_id, texture_filename, created_at)
select id, skin_texture, created_at
from public.skyhop_users
where skin_texture is not null
  and btrim(skin_texture) <> ''
on conflict (user_id, texture_filename) do nothing;
