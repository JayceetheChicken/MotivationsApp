begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  (
    'a8111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'alice-privacy@example.test',
    '{"username":"alice8","display_name":"Alice","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'b8222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'bob-privacy@example.test',
    '{"username":"bob8","display_name":"Bob","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'c8333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
    'cara-privacy@example.test',
    '{"username":"cara8","display_name":"Cara","time_zone":"Europe/Berlin"}',
    clock_timestamp(), clock_timestamp()
  );

update public.profiles
set avatar_url = 'https://project.example/storage/v1/object/public/avatars/b8222222-2222-4222-8222-222222222222/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg?v=test'
where id = 'b8222222-2222-4222-8222-222222222222';

update public.privacy_settings
set share_currently_learning = true,
    share_pause_status = false,
    share_last_active_at = false,
    share_today_activity = false,
    share_weekly_minutes = true,
    share_avatar = false,
    discoverable_by_username = true
where user_id = 'b8222222-2222-4222-8222-222222222222';

insert into public.friendships(id, requester_id, addressee_id, status, responded_at)
values
  (
    'f8111111-1111-4111-8111-111111111111',
    'a8111111-1111-4111-8111-111111111111',
    'b8222222-2222-4222-8222-222222222222',
    'accepted', clock_timestamp()
  ),
  (
    'f8222222-2222-4222-8222-222222222222',
    'c8333333-3333-4333-8333-333333333333',
    'b8222222-2222-4222-8222-222222222222',
    'accepted', clock_timestamp()
  );

insert into public.learning_presence(
  user_id, state, active_since, last_study_at, last_seen_at, expires_at, device_id
) values (
  'b8222222-2222-4222-8222-222222222222', 'paused',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '2 minutes',
  clock_timestamp(), clock_timestamp() + interval '5 minutes',
  'b8000000-0000-4000-8000-000000000001'
);

select is(
  (select count(*)::integer from public.privacy_settings ps
   where ps.user_id = 'c8333333-3333-4333-8333-333333333333'
     and not ps.share_currently_learning and not ps.share_pause_status
     and not ps.share_last_active_at and not ps.share_today_activity
     and not ps.share_weekly_minutes and not ps.share_avatar
     and not ps.discoverable_by_username),
  1,
  'new granular privacy settings default to opt-in false'
);

select set_config('request.jwt.claim.sub', 'a8111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'presence_status',
  'online',
  'a hidden pause state is reduced to a neutral online category'
);
select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'last_active_at',
  null::text,
  'last activity is null when not shared'
);
select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'today_minutes',
  null::text,
  'today activity is null when not shared'
);
select is(
  (public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'week_minutes')::integer,
  0,
  'weekly activity is aggregated server-side only when shared'
);
select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'streak_days',
  null::text,
  'streak is null when not shared'
);
select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') -> 'friend' ->> 'avatar_url',
  null::text,
  'avatar URL is omitted by the server when not shared'
);

reset role;
update public.privacy_settings
set share_pause_status = true,
    share_last_active_at = true,
    share_today_activity = true,
    share_avatar = true
where user_id = 'b8222222-2222-4222-8222-222222222222';
set local role authenticated;

select is(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'presence_status',
  'paused',
  'pause state is returned after explicit sharing'
);
select isnt(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'last_active_at',
  null::text,
  'last activity is returned after explicit sharing'
);
select is(
  (public.get_friend_overview('b8222222-2222-4222-8222-222222222222') ->> 'today_minutes')::integer,
  0,
  'today activity is returned as an aggregate after explicit sharing'
);
select ok(
  public.get_friend_overview('b8222222-2222-4222-8222-222222222222')
    -> 'friend' ->> 'avatar_url' like 'https://project.example/%',
  'avatar URL is returned only after explicit sharing'
);

select is(
  public.create_study_group(
    '{"id":"a8100000-0000-4000-8000-000000000001","name":"Privacy Team","icon":"book"}'::jsonb,
    array['b8222222-2222-4222-8222-222222222222'::uuid],
    'a8100000-0000-4000-8000-000000000002'
  ) -> 'group' ->> 'id',
  'a8100000-0000-4000-8000-000000000001',
  'shared group is created for the deletion transfer test'
);
select is(
  public.create_shared_goal(
    jsonb_build_object(
      'id', 'a8200000-0000-4000-8000-000000000001',
      'title', 'Shared deletion goal', 'description', 'aggregate only',
      'type', 'duration', 'mode', 'shared', 'targetMinutes', 30,
      'sourcePolicy', 'all', 'period', 'custom', 'cadence', 'weekly',
      'startsAt', clock_timestamp() - interval '1 hour',
      'endsAt', clock_timestamp() + interval '1 day'
    ),
    array['b8222222-2222-4222-8222-222222222222'::uuid],
    'a8200000-0000-4000-8000-000000000002'
  ) -> 'goal' ->> 'id',
  'a8200000-0000-4000-8000-000000000001',
  'shared goal is created for the deletion transfer test'
);
select is(
  public.create_shared_study_session(
    jsonb_build_object(
      'id', 'a8300000-0000-4000-8000-000000000001',
      'title', 'Shared deletion session', 'starts_at', clock_timestamp(),
      'planned_duration_minutes', 30, 'start_now', false
    ),
    array['b8222222-2222-4222-8222-222222222222'::uuid],
    'a8300000-0000-4000-8000-000000000002'
  ) -> 'session' ->> 'id',
  'a8300000-0000-4000-8000-000000000001',
  'shared session is created for the deletion transfer test'
);

select set_config('request.jwt.claim.sub', 'b8222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$do $block$ begin
    perform public.respond_study_group_invitation('a8100000-0000-4000-8000-000000000001', true);
    perform public.respond_shared_goal_invitation('a8200000-0000-4000-8000-000000000001', true);
    perform public.respond_shared_study_session_invitation('a8300000-0000-4000-8000-000000000001', true);
  end $block$;$$,
  'remaining participant accepts every shared object'
);

select set_config('request.jwt.claim.sub', 'a8111111-1111-4111-8111-111111111111', true);
select is(
  public.block_user('b8222222-2222-4222-8222-222222222222') ->> 'blocked',
  'true',
  'a user can block a separate user without deleting accepted shared content'
);
select is(
  public.find_profile_by_exact_username('bob8'),
  null::jsonb,
  'blocked users disappear from exact username search'
);
select throws_ok(
  $$select public.send_friend_request('bob8')$$,
  'P0001', 'profile_not_found',
  'blocked users cannot send a new friendship request'
);
select is(
  jsonb_array_length(public.list_friend_overviews() -> 'friends'),
  0,
  'blocked relationships expose no presence or activity overview'
);
select is(
  jsonb_array_length(public.list_my_blocked_profiles() -> 'blocked_profiles'),
  1,
  'only the blocker can list their own block entry'
);
select is(
  public.submit_content_report(
    'profile', 'b8222222-2222-4222-8222-222222222222', 'privacy', 'Minimal test report'
  ) ->> 'status',
  'open',
  'a visible or blocked profile can be reported with a minimal receipt'
);
select throws_ok(
  $$select * from public.content_reports$$,
  '42501', 'permission denied for table content_reports',
  'authenticated users cannot read raw report or moderation metadata'
);
select ok(
  jsonb_array_length(public.export_my_data() -> 'reports') = 1
  and position('resolution_note' in public.export_my_data()::text) = 0
  and position('moderator_reference' in public.export_my_data()::text) = 0,
  'the account export includes only the callers safe report projection'
);

select set_config('request.jwt.claim.sub', 'c8333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.create_study_group(
    '{"id":"c8100000-0000-4000-8000-000000000001","name":"Rules required","icon":"book"}'::jsonb,
    array['b8222222-2222-4222-8222-222222222222'::uuid],
    'c8100000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'community_rules_acceptance_required',
  'shared user content is rejected before explicit community-rules acceptance'
);
select is(
  public.accept_community_rules('2026-08-02') ->> 'accepted',
  'true',
  'the current rules version can be accepted explicitly'
);
select ok(
  jsonb_array_length(public.export_my_data() -> 'reports') = 0
  and jsonb_array_length(public.export_my_data() -> 'blocks') = 0,
  'another users export contains neither reports nor blocks from Alice'
);
select throws_ok(
  $$select public.prepare_account_deletion('a8111111-1111-4111-8111-111111111111')$$,
  '42501', 'permission denied for function prepare_account_deletion',
  'an authenticated user cannot prepare another account for deletion'
);

reset role;
insert into public.subjects(id, owner_id, name, color, icon)
values (
  'a8400000-0000-4000-8000-000000000001',
  'a8111111-1111-4111-8111-111111111111',
  'Private deletion subject', '#123456', 'book'
);

select is(
  public.prepare_account_deletion('a8111111-1111-4111-8111-111111111111') ->> 'prepared',
  'true',
  'the service preparation path completes before auth deletion'
);
select ok(
  (select creator_id = 'b8222222-2222-4222-8222-222222222222' from public.study_groups where id = 'a8100000-0000-4000-8000-000000000001')
  and (select creator_id = 'b8222222-2222-4222-8222-222222222222' from public.goals where id = 'a8200000-0000-4000-8000-000000000001')
  and (select creator_id = 'b8222222-2222-4222-8222-222222222222' from public.shared_study_sessions where id = 'a8300000-0000-4000-8000-000000000001'),
  'group, shared goal and shared session ownership transfer deterministically'
);
select lives_ok(
  $$delete from auth.users where id = 'a8111111-1111-4111-8111-111111111111'$$,
  'auth-user deletion cascades after shared ownership transfer'
);
select ok(
  not exists (select 1 from public.subjects where owner_id = 'a8111111-1111-4111-8111-111111111111')
  and exists (select 1 from public.study_groups where id = 'a8100000-0000-4000-8000-000000000001')
  and exists (select 1 from public.goals where id = 'a8200000-0000-4000-8000-000000000001')
  and exists (select 1 from public.shared_study_sessions where id = 'a8300000-0000-4000-8000-000000000001'),
  'private data is deleted while shared objects remain for other participants'
);
select ok(
  not exists (select 1 from public.study_group_members where user_id = 'a8111111-1111-4111-8111-111111111111')
  and not exists (select 1 from public.goal_participants where user_id = 'a8111111-1111-4111-8111-111111111111')
  and not exists (select 1 from public.shared_study_session_participants where user_id = 'a8111111-1111-4111-8111-111111111111'),
  'deleted-account participant references are removed from shared objects'
);

select * from finish();
rollback;
