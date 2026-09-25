-- Lets the owner take a level off the awarded list without paying the creator again later.
alter table public.skyhop_user_levels add column if not exists award_paid boolean not null default false;
update public.skyhop_user_levels set award_paid = true where awarded = true and award_paid = false;
