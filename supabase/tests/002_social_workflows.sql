begin;

create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'anna@example.test', '{"username":"anna","display_name":"Anna"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'ben@example.test',
    '{"username":"ben","display_name":"Ben","avatar_url":"https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg"}',
    now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
    'cara@example.test', '{"username":"cara","display_name":"Cara"}', now(), now());

select is((select count(*)::integer from public.profiles), 3, 'auth trigger provisions profiles');
select is(
  (select count(*)::integer from public.privacy_settings
   where not share_timer_stats and not share_manual_stats
     and not share_goal_progress and not share_streak),
  3,
  'privacy starts closed'
);
select is(
  (select avatar_url from public.profiles
   where id = '22222222-2222-4222-8222-222222222222'),
  null,
  'untrusted signup avatar metadata is not copied into the profile'
);

insert into storage.objects(bucket_id, name, metadata)
values
  (
    'avatars',
    '11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '{"mimetype":"image/jpeg","size":128}'::jsonb
  ),
  (
    'avatars',
    '22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp',
    '{"mimetype":"image/webp","size":256}'::jsonb
  );

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (public.get_my_profile() -> 'profile' ->> 'username'),
  'anna',
  'profile RPC returns the actor profile'
);
select set_config('request.jwt.claim.iss', 'https://project.supabase.co/not-auth', true);
select throws_ok(
  $$select public.set_my_avatar(
    '11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
  )$$,
  '22023',
  'invalid_auth_issuer',
  'avatar URLs cannot be derived from a non-auth JWT issuer'
);
select set_config('request.jwt.claim.iss', 'http://127.0.0.1:54321/auth/v1', true);
select ok(
  (public.set_my_avatar(
    '11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
  ) -> 'profile' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg?v=%',
  'set_my_avatar derives a cache-busted URL from the verified auth issuer'
);
select ok(
  (public.get_my_profile() -> 'profile' ->> 'avatar_url') like
  'http://127.0.0.1:54321/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg?v=%',
  'the Storage-backed avatar is immediately visible in the actor profile'
);
select is(
  (select count(*)::integer from public.profiles),
  1,
  'profile RLS hides other users'
);
select throws_ok(
  $$select public.update_my_profile('anna', 'Anna', null, 'UTC', null)$$,
  '22023',
  'expected_revision_required',
  'profile updates cannot bypass optimistic concurrency with null'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select ok(
  (public.set_my_avatar(
    '22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp'
  ) -> 'profile' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'a second user can bind only their own verified Storage object'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select ok(
  (public.find_profile_by_exact_username('ben') -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'exact username search projects the other user avatar URL'
);
select is(
  (public.send_friend_request('ben') ->> 'status'),
  'pending',
  'friend request is outgoing for requester'
);
select ok(
  (public.send_friend_request('ben') -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'friend request response projects the addressee avatar URL'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.list_friend_connections() -> 'connections' -> 0 ->> 'status'),
  'pending',
  'friend request is incoming for addressee'
);
select ok(
  (public.list_friend_connections() -> 'connections' -> 0 -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg?v=%',
  'friend request list projects the requester avatar URL'
);
select is(
  (public.accept_friend_request(
    (public.list_friend_connections() -> 'connections' -> 0 ->> 'id')::uuid
  ) ->> 'status'),
  'accepted',
  'addressee can accept'
);

select is(
  (public.update_privacy_settings(true, false, false, false, 1)
    ->> 'share_timer_stats')::boolean,
  true,
  'timer statistics can be shared independently'
);

select lives_ok(
  $$select public.upsert_subject(
    '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","name":"Mathe","color":"#112233","icon":"calculator"}'::jsonb,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1'::uuid
  )$$,
  'owner can create a subject through RPC'
);
select lives_ok(
  $$select public.save_completed_session(
    jsonb_build_object(
      'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'subjectId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'goalId', null,
      'source', 'timer',
      'startedAt', statement_timestamp() - interval '30 minutes',
      'endedAt', statement_timestamp() - interval '20 minutes',
      'segments', jsonb_build_array(jsonb_build_object(
        'startedAt', statement_timestamp() - interval '30 minutes',
        'endedAt', statement_timestamp() - interval '20 minutes'
      ))
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2'::uuid
  )$$,
  'completed timer session is saved through validated segments'
);
select is(
  jsonb_array_length(
    public.pull_my_study_changes((
      select ss.sync_version
      from public.study_sessions ss
      where ss.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    )) -> 'sessions'
  ),
  1,
  'a child segment version makes its parent session visible after the parent cursor'
);
select lives_ok(
  $$select public.upsert_personal_goal(
    jsonb_build_object(
      'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
      'subjectId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'title', 'Persoenliches Ziel',
      'type', 'duration',
      'targetMinutes', 30,
      'sourcePolicy', 'all',
      'period', 'week',
      'startsAt', clock_timestamp() - interval '1 hour'
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf4'::uuid
  )$$,
  'a personal goal can be created for the owner subject'
);
select lives_ok(
  $$select public.save_completed_session(
    jsonb_build_object(
      'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
      'subjectId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'goalId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
      'source', 'manual',
      'startedAt', clock_timestamp() - interval '5 minutes',
      'endedAt', clock_timestamp(),
      'enteredAt', clock_timestamp()
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf5'::uuid
  )$$,
  'a session can be bound to its matching personal goal'
);
select lives_ok(
  $$select public.upsert_subject(
    '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6","name":"Chemie","color":"#778899","icon":"flask"}'::jsonb,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf6'::uuid
  )$$,
  'a second subject can be created for invariant testing'
);
select throws_ok(
  $$select public.upsert_personal_goal(
    jsonb_build_object(
      'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
      'subjectId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
      'title', 'Persoenliches Ziel',
      'type', 'duration',
      'targetMinutes', 30,
      'sourcePolicy', 'all',
      'period', 'week',
      'startsAt', clock_timestamp() - interval '1 hour',
      'expectedRevision', 1
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf7'::uuid
  )$$,
  '23514',
  'goal_subject_has_bound_sessions',
  'a personal goal cannot change subject while sessions remain bound'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  public.get_friend_overview('22222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'offline',
  'friend overview exposes only the current privacy-safe presence state'
);
select ok(
  (public.get_friend_overview('22222222-2222-4222-8222-222222222222')
    -> 'friend' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'friend overview projects the current Storage-backed avatar URL'
);
select ok(
  not (public.get_friend_overview('22222222-2222-4222-8222-222222222222')
    ? 'permissions'),
  'friend overview does not expose legacy statistics permissions'
);
select ok(
  not (public.get_friend_overview('22222222-2222-4222-8222-222222222222')
    ? 'periods'),
  'friend overview does not expose private period statistics'
);
select ok(
  not (public.get_friend_overview('22222222-2222-4222-8222-222222222222')
    ?| array['timer_minutes', 'manual_minutes', 'streak_days', 'goal_reached']),
  'friend overview contains no private study metrics'
);
select is(
  jsonb_array_length(
    public.get_friend_overview('22222222-2222-4222-8222-222222222222')
      -> 'shared_goal_ids'
  ),
  0,
  'friend overview initially reports no genuinely shared goals'
);

select lives_ok(
  $$select public.upsert_subject(
    '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","name":"Deutsch","color":"#445566","icon":"book"}'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1'::uuid
  )$$,
  'creator can create own subject'
);
select throws_ok(
  $$select public.upsert_subject(
    '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","name":"Deutsch 2","color":"#445566","icon":"book"}'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf9'::uuid
  )$$,
  '22023',
  'expected_revision_required',
  'subject updates cannot omit expected revision'
);
select lives_ok(
  $$select public.create_shared_goal(
    jsonb_build_object(
      'id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'title', 'Gemeinsam lernen',
      'description', 'Integrationstest',
      'type', 'duration',
      'mode', 'shared',
      'targetMinutes', 30,
      'sourcePolicy', 'all',
      'period', 'custom',
      'startsAt', clock_timestamp() - interval '1 hour',
      'endsAt', clock_timestamp() + interval '1 hour'
    ),
    array['22222222-2222-4222-8222-222222222222'::uuid],
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf2'::uuid
  )$$,
  'creator can invite a confirmed friend to a shared goal'
);
select ok(
  (public.get_shared_goal_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'participants' -> 0 -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg?v=%',
  'shared goal details project participant avatar URLs'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.respond_shared_goal_invitation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', true
  ) -> 'participants' -> 1 ->> 'status'),
  'accepted',
  'invitee can accept shared goal'
);
select lives_ok(
  $$select public.save_completed_session(
    jsonb_build_object(
      'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      'subjectId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'goalId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'source', 'manual',
      'startedAt', clock_timestamp() - interval '10 minutes',
      'endedAt', clock_timestamp(),
      'enteredAt', clock_timestamp()
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf3'::uuid
  )$$,
  'accepted participant can bind a session to shared goal'
);
select is(
  (public.get_shared_goal_progress('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'team' ->> 'contribution')::numeric,
  10.0::numeric,
  'team progress is computed from actual bound sessions'
);
select is(
  (public.get_shared_goal_progress('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'team' ->> 'achieved')::boolean,
  false,
  'team target is not prematurely reached'
);
select ok(
  (public.get_shared_goal_progress('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'participants' -> 1 -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'shared goal progress projects participant avatar URLs'
);
select is(
  (public.list_shared_goals() -> 'shared_goals' -> 0 -> 'goal' ->> 'id')::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
  'shared invitations survive through secure list projection'
);
select ok(
  (public.list_shared_goals() -> 'shared_goals' -> 0
    -> 'participants' -> 1 -> 'user' ->> 'avatar_url') like
    'http://127.0.0.1:54321/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp?v=%',
  'shared goal list projects participant avatar URLs'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.get_friend_overview('22222222-2222-4222-8222-222222222222')$$,
  '42501',
  'friendship_required',
  'non-friends cannot read the privacy-safe friend overview'
);
select throws_ok(
  $$select public.get_shared_goal_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$,
  '42501',
  'goal_invitation_required',
  'non-participants cannot read shared goal details'
);

reset role;
select * from finish();
rollback;
