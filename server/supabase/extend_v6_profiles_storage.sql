-- Custom profiles + Supabase Storage bucket (run in SQL Editor after prior migrations).

alter table public.skyhop_users add column if not exists profile_bio text;
alter table public.skyhop_users add column if not exists profile_avatar_path text;

-- Bucket: public read for avatars; max 512 KB; images only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skyhop-profiles',
  'skyhop-profiles',
  true,
  524288,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects (Supabase enables this by default on new projects)
-- Players may only write under their own top-level folder: {skyhop_user_id}/...

create or replace function public.skyhop_profile_folder_id(object_name text)
returns text
language sql
immutable
as $$
  select (string_to_array(object_name, '/'))[1];
$$;

drop policy if exists "skyhop_profiles_public_read" on storage.objects;
create policy "skyhop_profiles_public_read"
on storage.objects for select
to public
using (bucket_id = 'skyhop-profiles');

drop policy if exists "skyhop_profiles_insert_own_folder" on storage.objects;
create policy "skyhop_profiles_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'skyhop-profiles'
  and public.skyhop_profile_folder_id(name) = coalesce(
    auth.jwt() -> 'user_metadata' ->> 'skyhop_user_id',
    auth.uid()::text
  )
);

drop policy if exists "skyhop_profiles_update_own_folder" on storage.objects;
create policy "skyhop_profiles_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'skyhop-profiles'
  and public.skyhop_profile_folder_id(name) = coalesce(
    auth.jwt() -> 'user_metadata' ->> 'skyhop_user_id',
    auth.uid()::text
  )
)
with check (
  bucket_id = 'skyhop-profiles'
  and public.skyhop_profile_folder_id(name) = coalesce(
    auth.jwt() -> 'user_metadata' ->> 'skyhop_user_id',
    auth.uid()::text
  )
);

drop policy if exists "skyhop_profiles_delete_own_folder" on storage.objects;
create policy "skyhop_profiles_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'skyhop-profiles'
  and public.skyhop_profile_folder_id(name) = coalesce(
    auth.jwt() -> 'user_metadata' ->> 'skyhop_user_id',
    auth.uid()::text
  )
);

-- Block anonymous direct uploads (Sky Hop Node uses service role or signed URLs scoped to {userId}/).
drop policy if exists "skyhop_profiles_deny_anon_write" on storage.objects;
create policy "skyhop_profiles_deny_anon_write"
on storage.objects for insert
to anon
with check (bucket_id <> 'skyhop-profiles');

drop policy if exists "skyhop_profiles_deny_anon_update" on storage.objects;
create policy "skyhop_profiles_deny_anon_update"
on storage.objects for update
to anon
using (bucket_id <> 'skyhop-profiles');

drop policy if exists "skyhop_profiles_deny_anon_delete" on storage.objects;
create policy "skyhop_profiles_deny_anon_delete"
on storage.objects for delete
to anon
using (bucket_id <> 'skyhop-profiles');
