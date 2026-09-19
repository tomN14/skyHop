-- Owner-editable ToS pages and feature list HTML. Run after extend_v12.

create table if not exists public.skyhop_site_content (
  key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);
