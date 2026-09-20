-- First-time My Mods safety warning, per account.
-- Run after extend_v17.

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run schema.sql, then extend_v2 through extend_v17, then this file.';
  end if;
end $$;

alter table public.skyhop_users
  add column if not exists mods_warning_seen boolean not null default false;

comment on column public.skyhop_users.mods_warning_seen is
  'True after the player acknowledges the first-time My Mods third-party / payment warning.';
