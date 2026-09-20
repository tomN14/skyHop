-- Permanent strike counts on accounts. Only the owner can add/remove.
-- Run after extend_v16.

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run schema.sql, then extend_v2 through extend_v16, then this file.';
  end if;
end $$;

alter table public.skyhop_users
  add column if not exists strikes integer not null default 0;

comment on column public.skyhop_users.strikes is
  'Permanent strike count. Owner add/remove only. Player 3 = 1-week ban; mod/advisor 2 = demote to player; admin 1 = demote to moderator.';
