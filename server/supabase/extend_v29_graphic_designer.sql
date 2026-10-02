-- Graphic Designer is a flag, not a staff role. Shop credits are optional.
-- Run in the Supabase SQL editor after extend_v24_shop_items.sql.
alter table public.skyhop_users add column if not exists graphic_designer boolean not null default false;
alter table public.skyhop_shop_items add column if not exists credits text not null default '';
