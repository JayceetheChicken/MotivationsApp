begin;

-- Storage checks INSERT policies before the backend upload is complete. At
-- that point it exposes the declared byte count as `contentLength`; completed
-- objects expose their verified byte count as `size`.
drop policy if exists "Users can upload their own avatar" on storage.objects;

create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (storage.foldername(name))[2] = 'profile'
  and array_length(storage.foldername(name), 1) = 2
  and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
  and case
    when coalesce(metadata ->> 'contentLength', metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
      then coalesce(metadata ->> 'contentLength', metadata ->> 'size')::bigint
    else 0
  end between 1 and 5242880
  and (
    (name ~ '\.jpg$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/jpeg')
    or (name ~ '\.png$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/png')
    or (name ~ '\.webp$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/webp')
  )
);

commit;
