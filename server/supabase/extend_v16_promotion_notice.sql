-- One-time promotion congratulations (from → to). Demotion is silent.
-- Run after extend_v15.

do $$
begin
  if to_regclass('public.skyhop_users') is null then
    raise exception
      'Missing public.skyhop_users. Run schema.sql, then extend_v2 through extend_v15, then this file.';
  end if;
end $$;

alter table public.skyhop_users
  add column if not exists promotion_from text,
  add column if not exists promotion_to text;
