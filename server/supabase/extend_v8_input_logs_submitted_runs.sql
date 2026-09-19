-- Input logs + moderator submitted runs. Run after extend_v7_recordings.sql.

create table if not exists public.skyhop_input_logs (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  title text not null,
  source text not null default 'campaign',
  storage_path text not null,
  byte_size bigint not null default 0,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_input_logs_user_created_idx
  on public.skyhop_input_logs (user_id, created_at desc);

create table if not exists public.skyhop_submitted_runs (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  recording_id uuid not null references public.skyhop_recordings (id) on delete cascade,
  input_log_id uuid not null references public.skyhop_input_logs (id) on delete cascade,
  status text not null default 'unreviewed'
    check (status in ('unreviewed', 'approved', 'declined')),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  time_ms bigint not null,
  deaths integer not null default 0,
  player_note text,
  reviewed_by bigint references public.skyhop_users (id) on delete set null,
  reviewed_at bigint,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint
);

create index if not exists skyhop_submitted_runs_status_idx
  on public.skyhop_submitted_runs (status, created_at desc);

create index if not exists skyhop_submitted_runs_user_idx
  on public.skyhop_submitted_runs (user_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skyhop-input-logs',
  'skyhop-input-logs',
  false,
  5242880,
  array['application/json', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
