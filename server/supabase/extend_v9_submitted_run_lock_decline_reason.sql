-- Lock mod status changes + decline reasons on submitted runs. Run after extend_v8.

alter table public.skyhop_submitted_runs add column if not exists decline_reason text;
alter table public.skyhop_submitted_runs add column if not exists status_locked boolean not null default false;

create index if not exists skyhop_submitted_runs_locked_idx
  on public.skyhop_submitted_runs (status_locked, status, created_at desc);
