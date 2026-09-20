-- Mark recordings and input logs as anti-cheat on/off for leaderboard eligibility.
-- Run after extend_v19.

do $$
begin
  if to_regclass('public.skyhop_recordings') is null then
    raise exception
      'Missing public.skyhop_recordings. Run schema.sql / extend_v7, then this file.';
  end if;
end $$;

alter table public.skyhop_recordings
  add column if not exists anticheat_on boolean not null default true;

alter table public.skyhop_input_logs
  add column if not exists anticheat_on boolean not null default true;

comment on column public.skyhop_recordings.anticheat_on is
  'False when the clip was recorded in a session with Enable Anti-Cheat off. Not eligible for submit/leaderboards.';

comment on column public.skyhop_input_logs.anticheat_on is
  'False when the log was recorded in a session with Enable Anti-Cheat off. Not eligible for submit/leaderboards.';
