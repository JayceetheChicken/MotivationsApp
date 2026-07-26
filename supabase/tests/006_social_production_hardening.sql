begin;

create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values
  (
    'e1111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'hardening-anna@example.test',
    jsonb_build_object(
      'username', 'hardeninganna',
      'display_name', 'Hardening Anna',
      'time_zone', 'UTC',
      'avatar_url', 'https://tracker.example.test/untrusted-avatar.jpg',
      'picture', 'https://tracker.example.test/untrusted-picture.jpg'
    ),
    now(), now()
  ),
  (
    'e2222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'hardening-ben@example.test',
    '{"username":"hardeningben","display_name":"Hardening Ben","time_zone":"UTC"}',
    now(), now()
  ),
  (
    'e3333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'hardening-cara@example.test',
    '{"username":"hardeningcara","display_name":"Hardening Cara","time_zone":"UTC"}',
    now(), now()
  );

select is(
  (select avatar_url from public.profiles where id = 'e1111111-1111-4111-8111-111111111111'),
  null,
  'untrusted signup avatar metadata never becomes a profile avatar'
);

insert into public.friendships(
  id, requester_id, addressee_id, status, responded_at
) values (
  'e5111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111111',
  'e2222222-2222-4222-8222-222222222222',
  'accepted', clock_timestamp()
);

-- Storage rows are seeded as the database owner. set_my_avatar must still
-- independently validate ownership, MIME/extension agreement and size.
insert into storage.objects(bucket_id, name, metadata, created_at)
values
  (
    'avatars',
    'e1111111-1111-4111-8111-111111111111/profile/f1111111-1111-4111-8111-111111111111.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb,
    clock_timestamp()
  ),
  (
    'avatars',
    'e2222222-2222-4222-8222-222222222222/profile/f4444444-4444-4444-8444-444444444444.png',
    '{"mimetype":"image/png","size":1024}'::jsonb,
    clock_timestamp()
  ),
  (
    'avatars',
    'e1111111-1111-4111-8111-111111111111/profile/f2222222-2222-4222-8222-222222222222.jpg',
    '{"mimetype":"image/png","size":1024}'::jsonb,
    clock_timestamp()
  ),
  (
    'avatars',
    'e1111111-1111-4111-8111-111111111111/profile/f3333333-3333-4333-8333-333333333333.webp',
    '{"mimetype":"image/webp","size":5242881}'::jsonb,
    clock_timestamp()
  ),
  (
    'avatars',
    'e1111111-1111-4111-8111-111111111111/profile/f5555555-5555-4555-8555-555555555555.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb,
    clock_timestamp() - interval '25 hours'
  ),
  (
    'avatars',
    'e1111111-1111-4111-8111-111111111111/profile/f6666666-6666-4666-8666-666666666666.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb,
    clock_timestamp()
  );

-- Ben owns representative private study data. Anna is an accepted friend, but
-- that relationship must not weaken the owner-only policies below.
insert into public.subjects(id, owner_id, name, color, icon)
values (
  'e4100000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'PRIVATE_SUBJECT_E6', '#123456', 'book'
);
insert into public.goals(
  id, creator_id, scope, title, target_type, target_value, source_policy, starts_at
) values (
  'e4200000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'personal', 'PRIVATE_GOAL_E6', 'duration', 3600, 'all',
  clock_timestamp() - interval '1 day'
);
insert into public.personal_goal_details(goal_id, owner_id, subject_id, period)
values (
  'e4200000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'e4100000-0000-4000-8000-000000000001',
  'week'
);
insert into public.goal_participants(
  goal_id, user_id, role, status, invited_by, responded_at, accepted_at
) values (
  'e4200000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'creator', 'accepted', 'e2222222-2222-4222-8222-222222222222',
  clock_timestamp(), clock_timestamp()
);
insert into public.study_sessions(
  id, user_id, subject_id, source, started_at, ended_at, duration_seconds,
  entered_at, subject_name_snapshot, legacy_note
) values (
  'e4300000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'e4100000-0000-4000-8000-000000000001',
  'manual', clock_timestamp() - interval '10 minutes', clock_timestamp(), 600,
  clock_timestamp(), 'PRIVATE_SUBJECT_E6', 'PRIVATE_NOTE_E6'
);
insert into public.grades(
  id, user_id, subject_id, assessment_type, title, assessment_date, points,
  subject_name_snapshot
) values (
  'e4400000-0000-4000-8000-000000000001',
  'e2222222-2222-4222-8222-222222222222',
  'e4100000-0000-4000-8000-000000000001',
  'exam', 'PRIVATE_GRADE_E6', current_date, 13, 'PRIVATE_SUBJECT_E6'
);
set constraints all immediate;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'social_user_can_receive'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ),
  1,
  'private social invalidations have one authenticated receive policy'
);
select ok(
  coalesce((
    select qual::text ~ 'realtime\.topic\(\)[[:space:]]*='
      and position('social:user:' in qual::text) > 0
      and position('auth.uid()' in qual::text) > 0
      and position('~~' in qual::text) = 0
      and position('similar' in lower(qual::text)) = 0
    from pg_catalog.pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'social_user_can_receive'
  ), false),
  'private realtime authorization requires equality with the exact own user topic'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_friend_profile_stats'
  ),
  0,
  'the detailed friend statistics RPC no longer exists'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.iss', 'https://project.supabase.co/auth/v1', true);
set local role authenticated;

select ok(
  (select
    result ->> 'object_path' =
      'e1111111-1111-4111-8111-111111111111/profile/f1111111-1111-4111-8111-111111111111.jpg'
    and result -> 'previous_avatar_url' = 'null'::jsonb
   from (
     select public.set_my_avatar(
       'e1111111-1111-4111-8111-111111111111/profile/f1111111-1111-4111-8111-111111111111.jpg'
     ) as result
   ) avatar_result),
  'set_my_avatar accepts an own object and returns the exact prior avatar for safe cleanup'
);
select ok(
  public.get_my_profile() -> 'profile' ->> 'avatar_url' ~ (
    '^https://project\.supabase\.co/storage/v1/object/public/avatars/'
    || 'e1111111-1111-4111-8111-111111111111/profile/'
    || 'f1111111-1111-4111-8111-111111111111\.jpg[?]v='
    || '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  'set_my_avatar stores a canonical project URL with a cache version'
);
select is(
  public.list_my_stale_avatar_objects() -> 'object_paths',
  jsonb_build_array(
    'e1111111-1111-4111-8111-111111111111/profile/f5555555-5555-4555-8555-555555555555.jpg'
  ),
  'server cleanup exposes only non-current avatar objects older than 24 hours'
);
select throws_ok(
  $$select public.set_my_avatar(
    'e2222222-2222-4222-8222-222222222222/profile/f4444444-4444-4444-8444-444444444444.png'
  )$$,
  '22023',
  'invalid_avatar_object_path',
  'set_my_avatar rejects another users storage path'
);
select throws_ok(
  $$select public.set_my_avatar(
    'e1111111-1111-4111-8111-111111111111/profile/f2222222-2222-4222-8222-222222222222.jpg'
  )$$,
  '22023',
  'invalid_avatar_object',
  'set_my_avatar rejects MIME and extension mismatches'
);
select throws_ok(
  $$select public.set_my_avatar(
    'e1111111-1111-4111-8111-111111111111/profile/f3333333-3333-4333-8333-333333333333.webp'
  )$$,
  '22023',
  'invalid_avatar_object',
  'set_my_avatar rejects objects above five MiB'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(
  public.update_learning_presence(
    'b3000000-0000-4000-8000-000000000001',
    'learning', clock_timestamp() - interval '5 minutes'
  ) ->> 'state',
  'learning',
  'one device can publish a learning presence'
);
select is(
  public.update_learning_presence(
    'b3000000-0000-4000-8000-000000000002', 'idle', null
  ) ->> 'state',
  'idle',
  'a second device can independently remain online and idle'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(
  public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'learning',
  'learning wins over an idle online device'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(
  public.update_learning_presence(
    'b3000000-0000-4000-8000-000000000001', 'offline', null
  ) ->> 'state',
  'offline',
  'a learning device can publish an offline tombstone'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(
  public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'online',
  'a fresh idle device keeps the account online after learning stops elsewhere'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(
  public.update_learning_presence(
    'b3000000-0000-4000-8000-000000000002', 'offline', null
  ) ->> 'state',
  'offline',
  'the remaining idle device can publish an offline tombstone'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(
  public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'offline',
  'the account becomes offline only after every device is stale or offline'
);
select ok(
  public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    ->> 'last_active_at' is not null
  and public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    -> 'presence_expires_at' = 'null'::jsonb,
  'offline tombstones retain last active without exposing a fresh expiry'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(
  public.update_learning_presence(
    'b3000000-0000-4000-8000-000000000003', 'learning', clock_timestamp()
  ) ->> 'state',
  'learning',
  'a new device can replace stale tombstones with fresh learning presence'
);

reset role;
update public.learning_presence
set last_seen_at = clock_timestamp() - interval '3 minutes',
    expires_at = clock_timestamp() - interval '1 minute'
where user_id = 'e2222222-2222-4222-8222-222222222222'
  and device_id = 'b3000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select is(
  public.get_friend_overview('e2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'offline',
  'expired learning presence is projected as offline without waiting for cleanup'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e3333333-3333-4333-8333-333333333333","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
do $$
declare
  device_number integer;
  device_key uuid;
begin
  for device_number in 1..16 loop
    device_key := (
      'e3000000-0000-4000-8000-' || lpad(device_number::text, 12, '0')
    )::uuid;
    perform public.update_learning_presence(device_key, 'idle', null);
  end loop;
end;
$$;
select throws_ok(
  $$select public.update_learning_presence(
    'e3000000-0000-4000-8000-000000000017', 'idle', null
  )$$,
  '54000',
  'presence_device_limit',
  'presence rejects a seventeenth fresh device row for one account'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://project.supabase.co/auth/v1"}',
  true
);
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.subjects
   where owner_id = 'e2222222-2222-4222-8222-222222222222'),
  0::bigint,
  'friendship never grants access to another users private subjects'
);
select is(
  (select count(*) from public.goals
   where creator_id = 'e2222222-2222-4222-8222-222222222222'
     and scope = 'personal'),
  0::bigint,
  'friendship never grants access to another users private goals'
);
select is(
  (select count(*) from public.personal_goal_details
   where owner_id = 'e2222222-2222-4222-8222-222222222222'),
  0::bigint,
  'personal goal details remain owner-only'
);
select is(
  (select count(*) from public.study_sessions
   where user_id = 'e2222222-2222-4222-8222-222222222222'),
  0::bigint,
  'friendship never grants access to another users private sessions'
);
select is(
  (select count(*) from public.study_sessions
   where user_id = 'e2222222-2222-4222-8222-222222222222'
     and legacy_note = 'PRIVATE_NOTE_E6'),
  0::bigint,
  'private notes remain hidden with their owner-only session row'
);
select is(
  (select count(*) from public.grades
   where user_id = 'e2222222-2222-4222-8222-222222222222'),
  0::bigint,
  'friendship never grants access to another users grades'
);
select ok(
  position('PRIVATE_SUBJECT_E6' in public.get_friend_overview(
    'e2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and position('PRIVATE_GOAL_E6' in public.get_friend_overview(
    'e2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and position('PRIVATE_NOTE_E6' in public.get_friend_overview(
    'e2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and position('PRIVATE_GRADE_E6' in public.get_friend_overview(
    'e2222222-2222-4222-8222-222222222222'
  )::text) = 0,
  'friend overview never projects private study content'
);

reset role;
select * from finish();
rollback;
