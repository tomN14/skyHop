-- Static company and organization sites. The game server uploads with the service role.
-- Run in the Supabase SQL editor. The server also creates this bucket on the first deploy if it is missing.

insert into storage.buckets (id, name, public, file_size_limit)
values ('skyhop-sites', 'skyhop-sites', false, 307200)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
