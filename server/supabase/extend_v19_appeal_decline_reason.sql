-- Owner decline reason on ban appeals, shown to the player on the banned login screen.
-- Run after extend_v18.

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run schema.sql, then extend_v2 through extend_v18, then this file.';
  end if;
end $$;

alter table public.skyhop_users
  add column if not exists appeal_decline_reason text;

alter table public.skyhop_ban_appeals
  add column if not exists decline_reason text;

comment on column public.skyhop_users.appeal_decline_reason is
  'Latest owner decline message for a ban appeal. Shown on the banned login screen.';

comment on column public.skyhop_ban_appeals.decline_reason is
  'Owner-written reason when an appeal is declined. Shown to the banned player.';
