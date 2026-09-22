-- Multiple recordings / input logs on one submitted run (selection order).
alter table public.skyhop_submitted_runs
  add column if not exists recording_ids jsonb,
  add column if not exists input_log_ids jsonb;

update public.skyhop_submitted_runs
set recording_ids = jsonb_build_array(recording_id)
where recording_ids is null;

update public.skyhop_submitted_runs
set input_log_ids = jsonb_build_array(input_log_id)
where input_log_ids is null;
