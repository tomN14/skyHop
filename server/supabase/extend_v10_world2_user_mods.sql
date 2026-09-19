-- World 2 built-in stages + user JS mods. Run after extend_v9.

create table if not exists public.skyhop_builtin_world2 (
  id smallint primary key default 1 check (id = 1),
  stages jsonb not null,
  updated_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create table if not exists public.skyhop_user_mods (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  title text not null,
  storage_path text not null,
  byte_size bigint not null default 0,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_user_mods_user_created_idx
  on public.skyhop_user_mods (user_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skyhop-user-mods',
  'skyhop-user-mods',
  false,
  5242880,
  array['application/javascript', 'text/javascript', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
