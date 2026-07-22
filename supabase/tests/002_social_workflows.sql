begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

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

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (public.get_my_profile() -> 'profile' ->> 'username'),
  'anna',
  'profile RPC returns the actor profile'
);
select is(
  (public.update_my_profile(
    'anna',
    'Anna',
    'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg',
    'UTC',
    1
  ) ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg',
  'profile update persists the uploaded public avatar URL'
);
select is(
  (public.get_my_profile() -> 'profile' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg',
  'the updated avatar is immediately visible in the actor profile'
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
select is(
  (public.find_profile_by_exact_username('ben') -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
  'exact username search projects the other user avatar URL'
);
select is(
  (public.send_friend_request('ben') ->> 'status'),
  'pending',
  'friend request is outgoing for requester'
);
select is(
  (public.send_friend_request('ben') -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
  'friend request response projects the addressee avatar URL'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.list_friend_connections() -> 'connections' -> 0 ->> 'status'),
  'pending',
  'friend request is incoming for addressee'
);
select is(
  (public.list_friend_connections() -> 'connections' -> 0 -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg',
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
  (public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'permissions' ->> 'timer')::boolean,
  true,
  'friend stats expose granted timer permission'
);
select is(
  (public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'friend' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
  'friend profile projects the friend avatar URL'
);
select is(
  (public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'permissions' ->> 'manual')::boolean,
  false,
  'friend stats keep manual permission closed'
);
select ok(
  (public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'periods' -> 0 -> 'timer_minutes') <> 'null'::jsonb,
  'granted timer value is present'
);
select is(
  public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'periods' -> 0 -> 'manual_minutes',
  'null'::jsonb,
  'ungranted manual value is redacted instead of zero'
);
select is(
  public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')
    -> 'periods' -> 0 -> 'total_minutes',
  'null'::jsonb,
  'total is redacted unless both sources are shared'
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
select is(
  (public.get_shared_goal_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'participants' -> 0 -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg',
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
select is(
  (public.get_shared_goal_progress('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    -> 'participants' -> 1 -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
  'shared goal progress projects participant avatar URLs'
);
select is(
  (public.list_shared_goals() -> 'shared_goals' -> 0 -> 'goal' ->> 'id')::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
  'shared invitations survive through secure list projection'
);
select is(
  (public.list_shared_goals() -> 'shared_goals' -> 0
    -> 'participants' -> 1 -> 'user' ->> 'avatar_url'),
  'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
  'shared goal list projects participant avatar URLs'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.get_friend_profile_stats('22222222-2222-4222-8222-222222222222')$$,
  '42501',
  'friendship_required',
  'non-friends cannot read aggregate statistics'
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
