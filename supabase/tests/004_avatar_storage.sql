begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select is(
  (select count(*)::integer from storage.buckets where id = 'avatars' and name = 'avatars'),
  1,
  'avatars bucket exists'
);
select is(
  (select public from storage.buckets where id = 'avatars'),
  true,
  'avatars bucket is public'
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
        (policyname = 'Avatar images are publicly readable'
          and cmd = 'SELECT' and roles = array['public']::name[])
        or (policyname = 'Users can upload their own avatar'
          and cmd = 'INSERT' and roles = array['authenticated']::name[])
        or (policyname = 'Users can update their own avatar'
          and cmd = 'UPDATE' and roles = array['authenticated']::name[])
        or (policyname = 'Users can delete their own avatar'
          and cmd = 'DELETE' and roles = array['authenticated']::name[])
      )
  ),
  4,
  'avatar policies expose public reads and authenticated writes only'
);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values (
  '55555555-5555-4555-8555-555555555555',
  'authenticated', 'authenticated', 'avatar@example.test',
  '{"username":"avataruser","display_name":"Avatar User"}', now(), now()
);

insert into storage.objects(bucket_id, name, metadata)
values (
  'avatars',
  '66666666-6666-4666-8666-666666666666/avatar.jpg',
  '{"marker":"foreign-original"}'::jsonb
);

set local role anon;
select is(
  (select count(*)::integer
   from storage.objects
   where bucket_id = 'avatars'
     and name = '66666666-6666-4666-8666-666666666666/avatar.jpg'),
  1,
  'anonymous users can read public avatars'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name)
    values ('avatars', '55555555-5555-4555-8555-555555555555/anon.jpg')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anonymous users cannot upload avatars'
);

reset role;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      '55555555-5555-4555-8555-555555555555/profile/avatar.jpg',
      '{"marker":"own-original"}'::jsonb
    )$$,
  'authenticated users can upload below their own UID folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name)
    values ('avatars', '55555555-5555-4555-8555-555555555555')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an avatar key must be below, not equal to, the UID folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name)
    values ('avatars', '66666666-6666-4666-8666-666666666666/forbidden.jpg')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'authenticated users cannot upload into another user folder'
);
select throws_ok(
  $$update storage.objects
    set name = '66666666-6666-4666-8666-666666666666/moved.jpg'
    where bucket_id = 'avatars'
      and name = '55555555-5555-4555-8555-555555555555/profile/avatar.jpg'$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'authenticated users cannot move their own avatar into another user folder'
);
update storage.objects
set metadata = '{"marker":"own-updated"}'::jsonb
where bucket_id = 'avatars'
  and name = '55555555-5555-4555-8555-555555555555/profile/avatar.jpg';
select is(
  (select metadata ->> 'marker'
   from storage.objects
   where bucket_id = 'avatars'
     and name = '55555555-5555-4555-8555-555555555555/profile/avatar.jpg'),
  'own-updated',
  'authenticated users can replace an avatar in their own UID folder'
);
update storage.objects
set metadata = '{"marker":"foreign-tampered"}'::jsonb
where bucket_id = 'avatars'
  and name = '66666666-6666-4666-8666-666666666666/avatar.jpg';
select is(
  (select metadata ->> 'marker'
   from storage.objects
   where bucket_id = 'avatars'
     and name = '66666666-6666-4666-8666-666666666666/avatar.jpg'),
  'foreign-original',
  'authenticated users cannot replace an avatar in another user folder'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can delete their own avatar'
      and cmd = 'DELETE'
      and roles = array['authenticated']::name[]
      and qual like '%bucket_id = ''avatars''%'
      and qual like '%storage.foldername(name)%'
      and qual like '%auth.uid()%'
  ),
  'delete policy permits authenticated users only in their own UID folder'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can update their own avatar'
      and qual is not null
      and with_check is not null
      and qual = with_check
  ),
  'update policy applies the same UID folder predicate before and after replacement'
);

reset role;
select is(
  (select metadata ->> 'marker'
   from storage.objects
   where bucket_id = 'avatars'
     and name = '66666666-6666-4666-8666-666666666666/avatar.jpg'),
  'foreign-original',
  'foreign avatar remains unchanged after the forbidden update attempt'
);

select * from finish();
rollback;
