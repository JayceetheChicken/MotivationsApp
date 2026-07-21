-- Public avatar storage for account profile pictures.
--
-- storage.objects is a Supabase-managed table: RLS is already enabled on it,
-- so this migration only creates the bucket and the scoped access policies.
-- It never runs `alter table storage.objects ...` or changes ownership.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- Anyone may read avatars: the bucket is public and other users render
-- friend.avatarUrl directly from the returned public URL.
drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
on storage.objects for select
to public
using (bucket_id = 'avatars');

-- Uploads are restricted to the caller's own folder (e.g. `<uid>/avatar.jpg`).
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Overwriting the existing avatar (upsert) requires the same folder ownership.
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Deleting is likewise limited to the caller's own folder.
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
