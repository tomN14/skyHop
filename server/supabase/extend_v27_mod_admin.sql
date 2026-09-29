-- Mod Admin expiry. -1 means permanent. Run in the Supabase SQL editor.
alter table public.skyhop_users add column if not exists admin_until_ms bigint;
alter table public.skyhop_users add column if not exists admin_fallback_role text;
