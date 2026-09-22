-- Owner-added coin shop items (images in storage bucket skyhop-shop).
create table if not exists public.skyhop_shop_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  texture text not null unique,
  price bigint not null,
  sell_price bigint not null default 0,
  page integer not null,
  slot integer not null,
  storage_path text not null,
  mime_type text not null default 'image/png',
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_shop_items_page_slot_idx
  on public.skyhop_shop_items (page, slot);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skyhop-shop',
  'skyhop-shop',
  false,
  1572864,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
