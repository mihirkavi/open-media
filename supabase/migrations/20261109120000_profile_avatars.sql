-- Profile pictures.
--
-- A person's picture is uploaded by them, with metadata already removed on their device, to the
-- public `avatars` Storage bucket under <their id>/<file>. A Gravatar they choose to use is copied
-- here too, so a profile never publishes the hash of their email address. profiles.avatar_url
-- holds the public URL, as before.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: anyone can load a picture by URL. Only its owner can write, inside their folder.
drop policy if exists "Owners read their own avatars" on storage.objects;
create policy "Owners read their own avatars"
on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owners upload their own avatars" on storage.objects;
create policy "Owners upload their own avatars"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owners replace their own avatars" on storage.objects;
create policy "Owners replace their own avatars"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owners delete their own avatars" on storage.objects;
create policy "Owners delete their own avatars"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
