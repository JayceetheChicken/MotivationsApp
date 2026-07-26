begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select is(
  (select count(*)::integer from storage.buckets where id = 'avatars' and name = 'avatars'),
  1,
  'avatars bucket exists'
);
select is(
  (select public from storage.buckets where id = 'avatars'),
  true,
  'avatars bucket remains public for direct image delivery'
);
select is(
  (select file_size_limit from storage.buckets where id = 'avatars'),
  5242880::bigint,
  'avatar uploads are limited to five MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'avatars'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'avatar bucket accepts only the supported raster MIME types'
);
select ok(
  (select c.relrowsecurity
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects'),
  'storage object RLS remains enabled'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        (policyname = 'Users can read their own avatar metadata'
          and cmd = 'SELECT' and roles = array['authenticated']::name[])
        or (policyname = 'Users can upload their own avatar'
          and cmd = 'INSERT' and roles = array['authenticated']::name[])
        or (policyname = 'Users can delete their own avatar'
          and cmd = 'DELETE' and roles = array['authenticated']::name[])
      )
  ),
  3,
  'avatar metadata, immutable inserts and deletes use three authenticated policies'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Avatar images are publicly readable'
  ),
  0,
  'anonymous users receive no storage metadata listing policy'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can update their own avatar'
  ),
  0,
  'avatar objects are immutable and have no update policy'
);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values (
  '55555555-5555-4555-8555-555555555555',
  'authenticated', 'authenticated', 'avatar@example.test',
  '{"username":"avataruser","display_name":"Avatar User"}', now(), now()
);

-- Seed one foreign canonical object and one legacy own object as the database
-- owner. The authenticated test user may see/delete only their own legacy row.
insert into storage.objects(bucket_id, name, metadata)
values
  (
    'avatars',
    '66666666-6666-4666-8666-666666666666/profile/88888888-8888-4888-8888-888888888888.jpg',
    '{"marker":"foreign-original","mimetype":"image/jpeg","size":128}'::jsonb
  ),
  (
    'avatars',
    '55555555-5555-4555-8555-555555555555/avatar.jpg',
    '{"marker":"legacy-own","mimetype":"image/jpeg","size":128}'::jsonb
  );

set local role anon;
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'avatars'),
  0,
  'anonymous users cannot list avatar object metadata'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg',
      '{"mimetype":"image/jpeg","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anonymous users cannot upload an otherwise valid avatar'
);

reset role;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg',
      '{"marker":"own-original","mimetype":"image/jpeg","size":128}'::jsonb
    )$$,
  'authenticated users can upload a UUID-v4 avatar below their profile folder'
);
select is(
  (select count(*)::integer
   from storage.objects
   where bucket_id = 'avatars'
     and name like '55555555-5555-4555-8555-555555555555/%'),
  2,
  'authenticated users can list their canonical and legacy avatar metadata'
);
select is(
  (select count(*)::integer
   from storage.objects
   where bucket_id = 'avatars'
     and name like '66666666-6666-4666-8666-666666666666/%'),
  0,
  'authenticated users cannot list another users avatar metadata'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/avatar.jpg',
      '{"mimetype":"image/jpeg","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar filenames must be UUID v4 values'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/nested/99999999-9999-4999-8999-999999999999.jpg',
      '{"mimetype":"image/jpeg","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar keys cannot add folders below the canonical profile folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/99999999-9999-4999-8999-999999999999.gif',
      '{"mimetype":"image/jpeg","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar paths reject unsupported file extensions'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/other/99999999-9999-4999-8999-999999999999.png',
      '{"mimetype":"image/png","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar uploads are restricted to the profile folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '66666666-6666-4666-8666-666666666666/profile/99999999-9999-4999-8999-999999999999.webp',
      '{"mimetype":"image/webp","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'authenticated users cannot upload into another users folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      '{"mimetype":"image/png","size":128}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar MIME type must match the filename extension'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
      '{"mimetype":"image/jpeg","size":5242881}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'avatar insert policy rejects files above the five MiB limit'
);

with updated as (
  update storage.objects
  set metadata = '{"marker":"own-tampered","mimetype":"image/jpeg","size":256}'::jsonb
  where bucket_id = 'avatars'
    and name = '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg'
  returning 1
)
select is(
  (select count(*)::integer from updated),
  0,
  'authenticated users cannot mutate an uploaded avatar object'
);
select is(
  (select metadata ->> 'marker'
   from storage.objects
   where bucket_id = 'avatars'
     and name = '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg'),
  'own-original',
  'the immutable own avatar remains unchanged after an update attempt'
);
with updated as (
  update storage.objects
  set metadata = '{"marker":"foreign-tampered"}'::jsonb
  where bucket_id = 'avatars'
    and name = '66666666-6666-4666-8666-666666666666/profile/88888888-8888-4888-8888-888888888888.jpg'
  returning 1
)
select is(
  (select count(*)::integer from updated),
  0,
  'authenticated users cannot update another users avatar'
);
select set_config(
  'request.jwt.claim.iss',
  'http://127.0.0.1:54321/auth/v1',
  true
);
select lives_ok(
  $$select public.set_my_avatar(
    '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg'
  )$$,
  'an uploaded canonical object can become the current avatar'
);
select set_config('storage.allow_delete_query', 'true', true);
with deleted as (
  delete from storage.objects
  where bucket_id = 'avatars'
    and name = '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  0,
  'the Storage delete policy protects the current avatar from delayed cleanup'
);
select lives_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
      '{"marker":"replacement","mimetype":"image/png","size":128}'::jsonb
    )$$,
  'a replacement avatar can be uploaded while the current object is protected'
);
select lives_ok(
  $$select public.set_my_avatar(
    '55555555-5555-4555-8555-555555555555/profile/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
  )$$,
  'the replacement can atomically become the current avatar'
);
with deleted as (
  delete from storage.objects
  where bucket_id = 'avatars'
    and name = '55555555-5555-4555-8555-555555555555/avatar.jpg'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  1,
  'authenticated users can delete their own legacy avatar during replacement'
);
with deleted as (
  delete from storage.objects
  where bucket_id = 'avatars'
    and name = '55555555-5555-4555-8555-555555555555/profile/77777777-7777-4777-8777-777777777777.jpg'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  1,
  'authenticated users can delete their own canonical avatar'
);
select is(
  (select count(*)::integer
   from storage.objects
   where bucket_id = 'avatars'
     and name like '55555555-5555-4555-8555-555555555555/%'),
  1,
  'cleanup removes old metadata while retaining the protected current avatar'
);
with deleted as (
  delete from storage.objects
  where bucket_id = 'avatars'
    and name = '66666666-6666-4666-8666-666666666666/profile/88888888-8888-4888-8888-888888888888.jpg'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  0,
  'authenticated users cannot delete another users avatar'
);

reset role;
select is(
  (select metadata ->> 'marker'
   from storage.objects
   where bucket_id = 'avatars'
     and name = '66666666-6666-4666-8666-666666666666/profile/88888888-8888-4888-8888-888888888888.jpg'),
  'foreign-original',
  'the foreign avatar remains unchanged after forbidden update and delete attempts'
);

select * from finish();
rollback;
