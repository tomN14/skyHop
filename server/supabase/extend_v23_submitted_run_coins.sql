-- Track automatic submit / accept / top-10 coin payouts on submitted runs.
alter table public.skyhop_submitted_runs
  add column if not exists submit_coins integer,
  add column if not exists accept_coins integer,
  add column if not exists rank_coins integer,
  add column if not exists lb_rank integer;
