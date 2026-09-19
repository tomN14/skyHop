-- Use on the LIVE Sky Hop project if Play shows empty levels because a bad
-- built-in campaign was saved to Supabase. After this, the game uses stages.js
-- from the website until you upload a valid campaign again.
--
-- World 1:
update public.skyhop_builtin_campaign
set stages = '[]'::jsonb, updated_at = (floor(extract(epoch from now()) * 1000))::bigint
where id = 1;

-- Optional World 2 (game falls back to bundled stages-world2.js when row empty):
-- update public.skyhop_builtin_world2
-- set stages = '[]'::jsonb, updated_at = (floor(extract(epoch from now()) * 1000))::bigint
-- where id = 1;
