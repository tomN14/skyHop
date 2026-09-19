-- World 2 unlock tied to account (World 1 campaign fully cleared).
alter table public.skyhop_users
  add column if not exists campaign_world1_cleared_at bigint;

comment on column public.skyhop_users.campaign_world1_cleared_at is
  'Unix ms when user first cleared all World 1 built-in stages; unlocks World 2 on any device.';
