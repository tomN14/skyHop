-- Creators can turn off copying. Existing levels stay copyable.
alter table public.skyhop_user_levels add column if not exists allow_copy boolean not null default true;
