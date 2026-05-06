-- Run in Supabase SQL Editor if you already applied schema.sql before moderation was added.
-- New installs: server/supabase/schema.sql already includes these changes.

alter table public.skyhop_users add column if not exists role text not null default 'player';
alter table public.skyhop_users add column if not exists ban_until_ms bigint;
alter table public.skyhop_users add column if not exists ban_reason text;

update public.skyhop_users set role = 'player' where role is null;

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
