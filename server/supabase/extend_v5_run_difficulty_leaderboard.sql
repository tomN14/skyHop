-- Campaign run difficulty for Easy / Normal / Hard leaderboards. Run in Supabase SQL Editor.

alter table public.skyhop_runs add column if not exists difficulty text;

alter table public.skyhop_runs drop constraint if exists skyhop_runs_difficulty_check;
alter table public.skyhop_runs add constraint skyhop_runs_difficulty_check
  check (difficulty is null or difficulty in ('easy', 'normal', 'hard'));

create index if not exists skyhop_runs_campaign_diff_time_idx
  on public.skyhop_runs (difficulty, time_ms)
  where source = 'campaign' and difficulty is not null;
