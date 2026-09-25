-- Awarded user levels. Creator receives 300 coins once. Each player receives 25 coins on their first clear.
alter table public.skyhop_user_levels add column if not exists awarded boolean not null default false;
alter table public.skyhop_user_levels add column if not exists award_paid boolean not null default false;
update public.skyhop_user_levels set award_paid = true where awarded = true and award_paid = false;

create table if not exists public.skyhop_awarded_clears (
  user_id bigint not null references public.skyhop_users (id) on delete cascade,
  level_id uuid not null references public.skyhop_user_levels (id) on delete cascade,
  created_at bigint not null default (floor(extract(epoch from now()) * 1000))::bigint,
  primary key (user_id, level_id)
);
