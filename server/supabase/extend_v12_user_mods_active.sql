-- Active user mods (up to 3) stored on account, not browser localStorage.
alter table public.skyhop_users
  add column if not exists active_user_mod_ids jsonb not null default '[]'::jsonb;

comment on column public.skyhop_users.active_user_mod_ids is
  'JSON array of up to 3 skyhop_user_mods.id (uuid) currently enabled for this account.';
