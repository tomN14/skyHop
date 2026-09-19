-- Run recordings (account-linked). Storage bucket + metadata table.

create table if not exists public.skyhop_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  title text not null,
  source text not null default 'campaign',
  storage_path text not null,
  mime_type text not null default 'video/webm',
  byte_size bigint not null default 0,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_recordings_user_created_idx
  on public.skyhop_recordings (user_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skyhop-recordings',
  'skyhop-recordings',
  false,
  26214400,
  array['video/webm', 'video/mp4', 'video/x-matroska']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
