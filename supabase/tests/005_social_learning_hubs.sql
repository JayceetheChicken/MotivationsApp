begin;

create extension if not exists pgtap with schema extensions;
select plan(85);

select has_table('public', 'learning_presence', 'learning presence exists');
select results_eq(
  $$
    select c.column_name::text
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'learning_presence'
    order by c.ordinal_position
  $$,
  array[
    'user_id'::text, 'state', 'active_since', 'last_study_at',
    'last_seen_at', 'expires_at'
  ],
  'learning presence stores no subject, task, note or private goal fields'
);
select has_table('public', 'study_groups', 'study groups exist');
select has_table('public', 'study_group_members', 'study group memberships exist');
select has_table('public', 'shared_study_sessions', 'shared study sessions exist');
select has_table(
  'public', 'shared_study_session_participants',
  'shared study session participants exist'
);
select has_column(
  'public', 'shared_goal_details', 'cadence',
  'shared goals store their cadence'
);
select has_column(
  'public', 'shared_goal_details', 'group_id',
  'shared goals can belong to a study group'
);
select has_column(
  'public', 'study_sessions', 'shared_session_id',
  'private sessions can explicitly bind to one shared session'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'learning_presence', 'study_groups', 'study_group_members',
        'shared_study_sessions', 'shared_study_session_participants'
      )
      and not c.relrowsecurity
  $$,
  array[0::bigint],
  'RLS is enabled on every new social table'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.get_friend_profile_stats(uuid)', 'execute'
  ),
  'authenticated users can no longer execute the detailed friend statistics RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.get_friend_overview(uuid)', 'execute'
  ),
  'authenticated users can execute the redacted friend overview RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.friend_overview_read_model(uuid,uuid)', 'execute'
  ),
  'authenticated users cannot spoof the actor of the private friend overview helper'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.learning_presence', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.study_groups', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.study_group_members', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.shared_study_sessions', 'select')
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.shared_study_session_participants', 'select'
  ),
  'new social tables are RPC-only for authenticated clients'
);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values
  (
    'a1111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'anna-hubs@example.test',
    '{"username":"annahubs","display_name":"Anna Hubs","time_zone":"UTC"}',
    now(), now()
  ),
  (
    'b2222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'ben-hubs@example.test',
    '{"username":"benhubs","display_name":"Ben Hubs","time_zone":"UTC"}',
    now(), now()
  ),
  (
    'c3333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'cara-hubs@example.test',
    '{"username":"carahubs","display_name":"Cara Hubs","time_zone":"UTC"}',
    now(), now()
  ),
  (
    'd4444444-4444-4444-8444-444444444444',
    'authenticated', 'authenticated', 'dora-hubs@example.test',
    '{"username":"dorahubs","display_name":"Dora Hubs","time_zone":"UTC"}',
    now(), now()
  );

insert into public.friendships(
  id, requester_id, addressee_id, status, responded_at
) values
  (
    'fa111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111',
    'b2222222-2222-4222-8222-222222222222',
    'accepted', now()
  ),
  (
    'fa222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    'c3333333-3333-4333-8333-333333333333',
    'accepted', now()
  );

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  public.update_learning_presence(
    'learning', clock_timestamp() - interval '10 minutes'
  ) ->> 'state',
  'learning',
  'a user can publish only a learning presence state'
);
select ok(
  (
    public.update_learning_presence(
      'learning', clock_timestamp() - interval '10 minutes'
    ) ->> 'expires_at'
  )::timestamptz > clock_timestamp() + interval '4 minutes',
  'learning presence receives a five-minute TTL with heartbeat jitter tolerance'
);
select throws_ok(
  $$select public.update_learning_presence('studying-mathematics', null)$$,
  '22023',
  'invalid_presence_state',
  'presence rejects states that could encode private learning details'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
    -> 'friend' ->> 'id',
  'b2222222-2222-4222-8222-222222222222',
  'friend overview returns the requested friend'
);
select is(
  public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'learning',
  'fresh learning presence is projected as learning'
);
select ok(
  position('time_zone' in public.get_friend_overview(
    'b2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and position('periods' in public.get_friend_overview(
    'b2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and position('goal_reached' in public.get_friend_overview(
    'b2222222-2222-4222-8222-222222222222'
  )::text) = 0
  and not (
    public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
      ?| array['last_study_at', 'week_minutes', 'streak_days', 'active_since']
  ),
  'friend overview omits private study activity, statistics and goal status'
);
reset role;
select is(
  (public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
    ->> 'last_active_at')::timestamptz,
  (
    select lp.last_seen_at
    from public.learning_presence lp
    where lp.user_id = 'b2222222-2222-4222-8222-222222222222'
  ),
  'friend overview exposes server-observed last activity instead of study history'
);
set local role authenticated;
select is(
  public.list_friend_overviews() -> 'friends' -> 0 -> 'friend' ->> 'id',
  'b2222222-2222-4222-8222-222222222222',
  'actively learning friends are ordered first'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select public.update_learning_presence('idle', null);
select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'online',
  'fresh idle presence is projected as online'
);

reset role;
update public.learning_presence
set expires_at = clock_timestamp() - interval '1 second'
where user_id = 'b2222222-2222-4222-8222-222222222222';
set local role authenticated;
select is(
  public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
    ->> 'presence_status',
  'offline',
  'expired presence is projected as offline'
);

select set_config(
  'request.jwt.claim.sub', 'd4444444-4444-4444-8444-444444444444', true
);
select throws_ok(
  $$select public.get_friend_overview('b2222222-2222-4222-8222-222222222222')$$,
  '42501',
  'friendship_required',
  'non-friends cannot read a friend overview'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.create_study_group(
    '{"id":"a5100000-0000-4000-8000-000000000001","name":"Pruefungsgruppe","icon":"book"}'::jsonb,
    array[
      'b2222222-2222-4222-8222-222222222222'::uuid,
      'c3333333-3333-4333-8333-333333333333'::uuid
    ],
    'a5100000-0000-4000-8000-000000000002'::uuid
  ) -> 'group' ->> 'id',
  'a5100000-0000-4000-8000-000000000001',
  'a user can create a group with confirmed friends'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select ok(
  not public.get_study_group_details(
    'a5100000-0000-4000-8000-000000000001'
  ) ? 'members',
  'an invited group member cannot see the member roster'
);
select is(
  public.get_study_group_details(
    'a5100000-0000-4000-8000-000000000001'
  ) -> 'creator' ->> 'id',
  'a1111111-1111-4111-8111-111111111111',
  'an invited group member can identify only the group creator'
);
select is(
  public.get_study_group_details(
    'a5100000-0000-4000-8000-000000000001'
  ) -> 'self_membership' ->> 'user_id',
  'b2222222-2222-4222-8222-222222222222',
  'an invited group member receives their own invitation state'
);
select ok(
  position(
    'c3333333-3333-4333-8333-333333333333'
    in public.get_study_group_details(
      'a5100000-0000-4000-8000-000000000001'
    )::text
  ) = 0,
  'an invited group member cannot discover another invitee'
);
select is(
  jsonb_array_length(
    public.respond_study_group_invitation(
      'a5100000-0000-4000-8000-000000000001', true
    ) -> 'members'
  ),
  2,
  'after acceptance only accepted group members are visible'
);

select set_config(
  'request.jwt.claim.sub', 'c3333333-3333-4333-8333-333333333333', true
);
select is(
  public.respond_study_group_invitation(
    'a5100000-0000-4000-8000-000000000001', false
  ) ->> 'status',
  'declined',
  'a group invitation can be declined with a tombstone response'
);
select throws_ok(
  $$select public.get_study_group_details('a5100000-0000-4000-8000-000000000001')$$,
  '42501',
  'study_group_membership_required',
  'declined group members immediately lose detail access'
);

select set_config(
  'request.jwt.claim.sub', 'd4444444-4444-4444-8444-444444444444', true
);
select throws_ok(
  $$
    select public.create_study_group(
      '{"id":"d5400000-0000-4000-8000-000000000001","name":"Unzulaessig"}'::jsonb,
      array['b2222222-2222-4222-8222-222222222222'::uuid],
      'd5400000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  '42501',
  'group_member_must_be_friend',
  'group creation rejects users who are not confirmed friends'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.create_shared_study_session(
    jsonb_build_object(
      'id', 'a6100000-0000-4000-8000-000000000001',
      'title', 'Gemeinsam fokussieren',
      'starts_at', clock_timestamp(),
      'planned_duration_minutes', 60,
      'start_now', false
    ),
    array[
      'b2222222-2222-4222-8222-222222222222'::uuid,
      'c3333333-3333-4333-8333-333333333333'::uuid
    ],
    'a6100000-0000-4000-8000-000000000002'::uuid
  ) -> 'session' ->> 'id',
  'a6100000-0000-4000-8000-000000000001',
  'a shared study session can be created with friends'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select ok(
  not public.get_shared_study_session_details(
    'a6100000-0000-4000-8000-000000000001'
  ) ? 'participants',
  'an invited session participant cannot see the participant roster'
);
select is(
  public.get_shared_study_session_details(
    'a6100000-0000-4000-8000-000000000001'
  ) -> 'creator' ->> 'id',
  'a1111111-1111-4111-8111-111111111111',
  'an invited session participant can identify only the session creator'
);
select is(
  public.get_shared_study_session_details(
    'a6100000-0000-4000-8000-000000000001'
  ) -> 'self_participant' ->> 'user_id',
  'b2222222-2222-4222-8222-222222222222',
  'an invited session participant receives their own invitation state'
);
select ok(
  position(
    'c3333333-3333-4333-8333-333333333333'
    in public.get_shared_study_session_details(
      'a6100000-0000-4000-8000-000000000001'
    )::text
  ) = 0,
  'an invited session participant cannot discover another invitee'
);
select is(
  jsonb_array_length(
    public.respond_shared_study_session_invitation(
      'a6100000-0000-4000-8000-000000000001', true
    ) -> 'participants'
  ),
  2,
  'accepted session participants see only joined participants'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'start'
  ) -> 'self_participant' ->> 'status',
  'active',
  'a joined participant can start learning'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'start'
  ) -> 'self_participant' ->> 'status',
  'active',
  'a retried start action is idempotent'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'pause'
  ) -> 'self_participant' ->> 'status',
  'paused',
  'an active participant can pause'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'pause'
  ) -> 'self_participant' ->> 'status',
  'paused',
  'a retried pause action is idempotent'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'resume'
  ) -> 'self_participant' ->> 'status',
  'active',
  'a paused participant can resume'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'resume'
  ) -> 'self_participant' ->> 'status',
  'active',
  'a retried resume action is idempotent'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'finish'
  ) -> 'self_participant' ->> 'status',
  'finished',
  'an active participant can finish independently'
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'finish'
  ) -> 'self_participant' ->> 'status',
  'finished',
  'a retried finish action is idempotent'
);

select set_config(
  'request.jwt.claim.sub', 'c3333333-3333-4333-8333-333333333333', true
);
select is(
  public.respond_shared_study_session_invitation(
    'a6100000-0000-4000-8000-000000000001', false
  ) ->> 'status',
  'declined',
  'a shared session invitation can be declined'
);
select throws_ok(
  $$select public.get_shared_study_session_details('a6100000-0000-4000-8000-000000000001')$$,
  '42501',
  'shared_session_participation_required',
  'declined session invitees immediately lose detail access'
);

select set_config(
  'request.jwt.claim.sub', 'd4444444-4444-4444-8444-444444444444', true
);
select throws_ok(
  $$select public.get_shared_study_session_details('a6100000-0000-4000-8000-000000000001')$$,
  '42501',
  'shared_session_participation_required',
  'non-participants cannot read a shared session'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.create_shared_study_session(
    jsonb_build_object(
      'id', 'a6200000-0000-4000-8000-000000000001',
      'title', 'Gruppenfokus',
      'group_id', 'a5100000-0000-4000-8000-000000000001',
      'starts_at', clock_timestamp(),
      'planned_duration_minutes', 30,
      'start_now', true
    ),
    array['b2222222-2222-4222-8222-222222222222'::uuid],
    'a6200000-0000-4000-8000-000000000002'::uuid
  ) -> 'session' ->> 'id',
  'a6200000-0000-4000-8000-000000000001',
  'a group session can invite an accepted group member'
);
select throws_ok(
  $$
    select public.create_shared_study_session(
      jsonb_build_object(
        'id', 'a6300000-0000-4000-8000-000000000001',
        'title', 'Verbotene Gruppensession',
        'group_id', 'a5100000-0000-4000-8000-000000000001',
        'starts_at', clock_timestamp(),
        'planned_duration_minutes', 30,
        'start_now', false
      ),
      array['c3333333-3333-4333-8333-333333333333'::uuid],
      'a6300000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  '42501',
  'session_invitee_must_be_group_member',
  'a declined group member cannot be invited to a group session'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select throws_ok(
  $$select public.cancel_shared_study_session('a6200000-0000-4000-8000-000000000001')$$,
  '42501',
  'shared_session_not_cancellable',
  'only the creator can cancel a shared session'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  public.cancel_shared_study_session(
    'a6200000-0000-4000-8000-000000000001'
  ) -> 'session' ->> 'status',
  'cancelled',
  'the creator can cancel a shared session'
);
select lives_ok(
  $$
    select public.upsert_subject(
      '{"id":"a6400000-0000-4000-8000-000000000001","name":"Privates Fach A","color":"#334455","icon":"book"}'::jsonb,
      'a6400000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'the creator can create a private subject after cancelling a shared session'
);
select is(
  public.save_completed_session(
    jsonb_build_object(
      'id', 'a6400000-0000-4000-8000-000000000003',
      'subjectId', 'a6400000-0000-4000-8000-000000000001',
      'sharedSessionId', 'a6200000-0000-4000-8000-000000000001',
      'source', 'manual',
      'startedAt', clock_timestamp() - interval '5 minutes',
      'endedAt', clock_timestamp(),
      'enteredAt', clock_timestamp()
    ),
    'a6400000-0000-4000-8000-000000000004'::uuid
  ) ->> 'shared_session_id',
  'a6200000-0000-4000-8000-000000000001',
  'a queued private completion can link after the shared session was cancelled'
);

select is(
  public.create_shared_goal(
    jsonb_build_object(
      'id', 'a7100000-0000-4000-8000-000000000001',
      'title', 'Taeglich gemeinsam',
      'description', 'Nur aggregierter Fortschritt',
      'type', 'duration',
      'mode', 'per_participant',
      'targetMinutes', 30,
      'sourcePolicy', 'all',
      'period', 'custom',
      'cadence', 'daily',
      'group_id', 'a5100000-0000-4000-8000-000000000001',
      'startsAt', clock_timestamp() - interval '2 days',
      'endsAt', clock_timestamp() + interval '2 days'
    ),
    array['b2222222-2222-4222-8222-222222222222'::uuid],
    'a7100000-0000-4000-8000-000000000002'::uuid
  ) -> 'goal' ->> 'id',
  'a7100000-0000-4000-8000-000000000001',
  'a group goal stores a custom window and cadence'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select ok(
  not public.get_shared_goal_details(
    'a7100000-0000-4000-8000-000000000001'
  ) ? 'participants',
  'an invited goal participant cannot see the participant roster'
);
select is(
  jsonb_array_length(
    public.respond_shared_goal_invitation(
      'a7100000-0000-4000-8000-000000000001', true
    ) -> 'participants'
  ),
  2,
  'accepted goal participants see only accepted participants'
);
select lives_ok(
  $$
    select public.upsert_subject(
      '{"id":"b8100000-0000-4000-8000-000000000001","name":"Privates Fach","color":"#112233","icon":"book"}'::jsonb,
      'b8100000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'the participant can create a private subject for a linked session'
);
select lives_ok(
  $$
    select public.save_completed_session(
      jsonb_build_object(
        'id', 'b8200000-0000-4000-8000-000000000003',
        'subjectId', 'b8100000-0000-4000-8000-000000000001',
        'goalId', 'a7100000-0000-4000-8000-000000000001',
        'sharedSessionId', 'a6100000-0000-4000-8000-000000000001',
        'source', 'manual',
        'startedAt', clock_timestamp() - interval '26 hours',
        'endedAt', clock_timestamp() - interval '25 hours 55 minutes',
        'enteredAt', clock_timestamp()
      ),
      'b8200000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  'a goal-bound session can exist outside the current daily cadence window'
);
select is(
  (
    public.get_shared_goal_progress('a7100000-0000-4000-8000-000000000001')
      -> 'participants' -> 1 ->> 'contribution'
  )::numeric,
  0::numeric,
  'the previous daily cadence contributes nothing to the current cadence'
);
select is(
  public.save_completed_session(
    jsonb_build_object(
      'id', 'b8200000-0000-4000-8000-000000000001',
      'subjectId', 'b8100000-0000-4000-8000-000000000001',
      'goalId', 'a7100000-0000-4000-8000-000000000001',
      'sharedSessionId', 'a6100000-0000-4000-8000-000000000001',
      'source', 'manual',
      'startedAt', greatest(
        clock_timestamp() - interval '5 minutes',
        date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC'
      ),
      'endedAt', clock_timestamp(),
      'enteredAt', clock_timestamp(),
      'subjectNameSnapshot', 'Privates Fach',
      'legacyNote', 'Geheime Notiz'
    ),
    'b8200000-0000-4000-8000-000000000002'::uuid
  ) ->> 'shared_session_id',
  'a6100000-0000-4000-8000-000000000001',
  'an owner can privately link a completed session to an accepted shared session'
);
select is(
  public.get_shared_goal_progress(
    'a7100000-0000-4000-8000-000000000001'
  ) ->> 'cadence',
  'daily',
  'shared goal progress reports the current cadence period'
);
select ok(
  (
    public.get_shared_goal_progress('a7100000-0000-4000-8000-000000000001')
      -> 'participants' -> 1 ->> 'contribution'
  )::numeric > 0
  and (
    public.get_shared_goal_progress('a7100000-0000-4000-8000-000000000001')
      -> 'participants' -> 1 ->> 'contribution'
  )::numeric <= 5,
  'daily progress counts only goal-bound time inside the current cadence window'
);
select ok(
  position(
    'subject' in public.get_shared_goal_progress(
      'a7100000-0000-4000-8000-000000000001'
    )::text
  ) = 0
  and position(
    'note' in public.get_shared_goal_progress(
      'a7100000-0000-4000-8000-000000000001'
    )::text
  ) = 0
  and position(
    'title_snapshot' in public.get_shared_goal_progress(
      'a7100000-0000-4000-8000-000000000001'
    )::text
  ) = 0,
  'shared goal progress never exposes private session metadata'
);
select is(
  jsonb_array_length(public.list_shared_goal_progress() -> 'progress'),
  1,
  'accepted participants can list their shared goal progress'
);
select is(
  public.create_shared_goal(
    jsonb_build_object(
      'id', 'b7300000-0000-4000-8000-000000000001',
      'title', 'Woechentlich gemeinsam',
      'description', '',
      'type', 'duration',
      'mode', 'per_participant',
      'targetMinutes', 60,
      'sourcePolicy', 'all',
      'period', 'custom',
      'cadence', 'weekly',
      'startsAt', clock_timestamp() - interval '14 days',
      'endsAt', clock_timestamp() + interval '14 days'
    ),
    array['a1111111-1111-4111-8111-111111111111'::uuid],
    'b7300000-0000-4000-8000-000000000002'::uuid
  ) -> 'goal' ->> 'id',
  'b7300000-0000-4000-8000-000000000001',
  'a weekly shared goal can be created with a confirmed friend'
);
select lives_ok(
  $$
    select public.save_completed_session(
      jsonb_build_object(
        'id', 'b8300000-0000-4000-8000-000000000001',
        'subjectId', 'b8100000-0000-4000-8000-000000000001',
        'goalId', 'b7300000-0000-4000-8000-000000000001',
        'source', 'manual',
        'startedAt', clock_timestamp() - interval '8 days',
        'endedAt', clock_timestamp() - interval '7 days 23 hours 55 minutes',
        'enteredAt', clock_timestamp()
      ),
      'b8300000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'a goal-bound session can exist outside the current weekly cadence window'
);
select is(
  (
    public.get_shared_goal_progress('b7300000-0000-4000-8000-000000000001')
      -> 'participants' -> 0 ->> 'contribution'
  )::numeric,
  0::numeric,
  'the previous weekly cadence contributes nothing to the current cadence'
);
select lives_ok(
  $$
    select public.save_completed_session(
      jsonb_build_object(
        'id', 'b8300000-0000-4000-8000-000000000003',
        'subjectId', 'b8100000-0000-4000-8000-000000000001',
        'goalId', 'b7300000-0000-4000-8000-000000000001',
        'source', 'manual',
        'startedAt', greatest(
          clock_timestamp() - interval '5 minutes',
          date_trunc('week', clock_timestamp() at time zone 'UTC') at time zone 'UTC'
        ),
        'endedAt', clock_timestamp(),
        'enteredAt', clock_timestamp()
      ),
      'b8300000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  'a goal-bound session inside the current weekly cadence can be saved'
);
select is(
  public.get_shared_goal_progress(
    'b7300000-0000-4000-8000-000000000001'
  ) ->> 'cadence',
  'weekly',
  'shared goal progress reports a weekly cadence period'
);
select ok(
  (
    public.get_shared_goal_progress('b7300000-0000-4000-8000-000000000001')
      -> 'participants' -> 0 ->> 'contribution'
  )::numeric > 0
  and (
    public.get_shared_goal_progress('b7300000-0000-4000-8000-000000000001')
      -> 'participants' -> 0 ->> 'contribution'
  )::numeric <= 5,
  'weekly progress counts only goal-bound time inside the current cadence window'
);

select set_config(
  'request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true
);
select is(
  (
    select count(*)
    from public.study_sessions ss
    where ss.user_id = 'b2222222-2222-4222-8222-222222222222'
  ),
  0::bigint,
  'RLS hides another user''s private session rows'
);
select ok(
  (
    public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
      -> 'shared_group_ids'
  ) @> '["a5100000-0000-4000-8000-000000000001"]'::jsonb,
  'friend overview includes only a genuinely shared group id'
);
select ok(
  (
    public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
      -> 'shared_session_ids'
  ) @> '["a6100000-0000-4000-8000-000000000001"]'::jsonb,
  'friend overview includes only a genuinely shared session id'
);
select ok(
  (
    public.get_friend_overview('b2222222-2222-4222-8222-222222222222')
      -> 'shared_goal_ids'
  ) @> '["a7100000-0000-4000-8000-000000000001"]'::jsonb,
  'friend overview includes only a genuinely shared goal id'
);
select is(
  public.create_shared_goal(
    jsonb_build_object(
      'id', 'a7200000-0000-4000-8000-000000000001',
      'title', 'Ablehnbares Ziel',
      'description', '',
      'type', 'sessions',
      'mode', 'per_participant',
      'targetSessions', 1,
      'minimumSessionMinutes', 1,
      'sourcePolicy', 'all',
      'period', 'custom',
      'cadence', 'weekly',
      'startsAt', clock_timestamp() - interval '1 hour',
      'endsAt', clock_timestamp() + interval '1 day'
    ),
    array['c3333333-3333-4333-8333-333333333333'::uuid],
    'a7200000-0000-4000-8000-000000000002'::uuid
  ) -> 'goal' ->> 'id',
  'a7200000-0000-4000-8000-000000000001',
  'a non-group shared goal can invite a confirmed friend'
);

select set_config(
  'request.jwt.claim.sub', 'c3333333-3333-4333-8333-333333333333', true
);
select is(
  public.respond_shared_goal_invitation(
    'a7200000-0000-4000-8000-000000000001', false
  ) ->> 'status',
  'declined',
  'declining a shared goal returns only a tombstone'
);
select throws_ok(
  $$select public.get_shared_goal_details('a7200000-0000-4000-8000-000000000001')$$,
  '42501',
  'accepted_or_invited_participation_required',
  'declined shared-goal invitees immediately lose detail access'
);

select set_config(
  'request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true
);
select is(
  public.update_shared_study_session_participant(
    'a6100000-0000-4000-8000-000000000001', 'leave'
  ) ->> 'status',
  'left',
  'an accepted participant can leave a shared session with a tombstone response'
);
select throws_ok(
  $$select public.get_shared_study_session_details('a6100000-0000-4000-8000-000000000001')$$,
  '42501',
  'shared_session_participation_required',
  'a participant loses shared session access after leaving'
);
select is(
  public.leave_study_group('a5100000-0000-4000-8000-000000000001') ->> 'status',
  'left',
  'an accepted member can leave a study group with a tombstone response'
);
select throws_ok(
  $$select public.get_study_group_details('a5100000-0000-4000-8000-000000000001')$$,
  '42501',
  'study_group_membership_required',
  'a member loses study group access after leaving'
);

reset role;
select * from finish();
rollback;
