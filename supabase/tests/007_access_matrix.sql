begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

create temporary table expected_application_tables(name text primary key) on commit drop;
insert into expected_application_tables(name) values
  ('profiles'),
  ('privacy_settings'),
  ('subjects'),
  ('goals'),
  ('personal_goal_details'),
  ('shared_goal_details'),
  ('goal_participants'),
  ('goal_pause_intervals'),
  ('study_sessions'),
  ('study_session_segments'),
  ('grades'),
  ('grade_sessions'),
  ('friendships'),
  ('learning_presence'),
  ('study_groups'),
  ('study_group_members'),
  ('shared_study_sessions'),
  ('shared_study_session_participants'),
  ('user_blocks'),
  ('community_rule_acceptances'),
  ('content_reports');

create temporary table expected_authenticated_rpcs(signature text primary key) on commit drop;
insert into expected_authenticated_rpcs(signature) values
  ('public.get_my_profile()'),
  ('public.update_my_profile(text,text,text,text,integer)'),
  ('public.update_privacy_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,integer)'),
  ('public.accept_community_rules(text)'),
  ('public.get_community_rules_acceptance()'),
  ('public.find_profile_by_exact_username(text)'),
  ('public.pull_my_study_changes(bigint)'),
  ('public.upsert_subject(jsonb,uuid)'),
  ('public.soft_delete_subject(uuid,integer,uuid)'),
  ('public.upsert_personal_goal(jsonb,uuid)'),
  ('public.transition_personal_goal(uuid,text,timestamptz,integer,uuid)'),
  ('public.soft_delete_personal_goal(uuid,integer,uuid)'),
  ('public.save_completed_session(jsonb,uuid)'),
  ('public.soft_delete_session(uuid,integer,uuid)'),
  ('public.upsert_grade(jsonb,uuid)'),
  ('public.soft_delete_grade(uuid,integer,uuid)'),
  ('public.begin_local_import(text,text,jsonb)'),
  ('public.stage_local_import_chunk(uuid,integer,text,jsonb)'),
  ('public.finalize_local_import(uuid)'),
  ('public.get_local_import_status(uuid)'),
  ('public.discard_local_import(uuid)'),
  ('public.send_friend_request(text)'),
  ('public.accept_friend_request(uuid)'),
  ('public.decline_friend_request(uuid)'),
  ('public.remove_friendship(uuid)'),
  ('public.list_friend_connections()'),
  ('public.block_user(uuid)'),
  ('public.unblock_user(uuid)'),
  ('public.list_my_blocked_profiles()'),
  ('public.submit_content_report(text,uuid,text,text)'),
  ('public.export_my_data()'),
  ('public.get_friend_overview(uuid)'),
  ('public.list_friend_overviews()'),
  ('public.update_learning_presence(text,timestamptz)'),
  ('public.update_learning_presence(uuid,text,timestamptz)'),
  ('public.create_study_group(jsonb,uuid[],uuid)'),
  ('public.respond_study_group_invitation(uuid,boolean)'),
  ('public.leave_study_group(uuid)'),
  ('public.get_study_group_details(uuid)'),
  ('public.list_study_groups()'),
  ('public.create_shared_study_session(jsonb,uuid[],uuid)'),
  ('public.respond_shared_study_session_invitation(uuid,boolean)'),
  ('public.update_shared_study_session_participant(uuid,text)'),
  ('public.cancel_shared_study_session(uuid)'),
  ('public.get_shared_study_session_details(uuid)'),
  ('public.list_shared_study_sessions()'),
  ('public.create_shared_goal(jsonb,uuid[],uuid)'),
  ('public.respond_shared_goal_invitation(uuid,boolean)'),
  ('public.withdraw_from_shared_goal(uuid)'),
  ('public.get_shared_goal_details(uuid)'),
  ('public.list_shared_goals()'),
  ('public.get_shared_goal_progress(uuid)'),
  ('public.list_shared_goal_progress()'),
  ('public.set_my_avatar(text)'),
  ('public.list_my_stale_avatar_objects()');

select is(
  (select count(*) from expected_application_tables),
  21::bigint,
  'the access matrix covers every public application table'
);
select results_eq(
  $$
    select count(*)::bigint
    from expected_application_tables expected
    left join pg_catalog.pg_class relation on relation.relname = expected.name
    left join pg_catalog.pg_namespace schema_row on schema_row.oid = relation.relnamespace
    where schema_row.nspname is distinct from 'public'
       or relation.relkind not in ('r', 'p')
       or not relation.relrowsecurity
  $$,
  array[0::bigint],
  'every public application table exists and has RLS enabled'
);
select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants grant_row
    join expected_application_tables expected on expected.name = grant_row.table_name
    where grant_row.table_schema = 'public'
      and grant_row.grantee = 'anon'
  $$,
  array[0::bigint],
  'anon has no direct application-table privileges'
);
select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants grant_row
    join expected_application_tables expected on expected.name = grant_row.table_name
    where grant_row.table_schema = 'public'
      and grant_row.grantee = 'PUBLIC'
  $$,
  array[0::bigint],
  'PUBLIC has no direct application-table privileges'
);
select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants grant_row
    join expected_application_tables expected on expected.name = grant_row.table_name
    where grant_row.table_schema = 'public'
      and grant_row.grantee = 'authenticated'
      and grant_row.privilege_type <> 'SELECT'
  $$,
  array[0::bigint],
  'authenticated has no direct application-table write privileges'
);
select is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants grant_row
    join expected_application_tables expected on expected.name = grant_row.table_name
    where grant_row.table_schema = 'public'
      and grant_row.grantee = 'authenticated'
      and grant_row.privilege_type = 'SELECT'
  ),
  12::bigint,
  'only the twelve backwards-compatible owner-filtered tables retain direct reads'
);
select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.grantee = 'authenticated'
      and grant_row.table_name in (
        'shared_goal_details',
        'learning_presence',
        'study_groups',
        'study_group_members',
        'shared_study_sessions',
        'shared_study_session_participants'
      )
  $$,
  array[0::bigint],
  'sensitive collaborative raw tables remain RPC-only'
);
select ok(
  not pg_catalog.has_schema_privilege('anon', 'private', 'usage'),
  'anon has no private-schema usage'
);
select ok(
  not pg_catalog.has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has no private-schema usage'
);
select ok(
  not pg_catalog.has_schema_privilege('authenticated', 'public', 'create'),
  'authenticated cannot create objects in the Data API schema'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace schema_row on schema_row.oid = relation.relnamespace
    where schema_row.nspname = 'private'
      and relation.relkind in ('r', 'p', 'S', 'v', 'm')
      and (
        pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT')
        or pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT')
      )
  $$,
  array[0::bigint],
  'client roles cannot read private relations'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'private'
      and (
        pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      )
  $$,
  array[0::bigint],
  'client roles cannot execute private functions'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'public'
      and pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
  $$,
  array[0::bigint],
  'anon cannot execute any public RPC'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'public'
      and pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and not function_row.prosecdef
  $$,
  array[0::bigint],
  'every authenticated public RPC is SECURITY DEFINER'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'public'
      and pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and position('private.current_actor' in function_row.prosrc) = 0
  $$,
  array[0::bigint],
  'every authenticated public RPC derives the actor server-side'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname in ('public', 'private')
      and function_row.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, array[]::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
  $$,
  array[0::bigint],
  'every SECURITY DEFINER function pins an empty search_path'
);
select is(
  (select count(*) from expected_authenticated_rpcs),
  55::bigint,
  'the authenticated RPC allowlist has the expected size'
);
select results_eq(
  $$
    select count(*)::bigint
    from expected_authenticated_rpcs expected
    where pg_catalog.to_regprocedure(expected.signature) is null
  $$,
  array[0::bigint],
  'every allowlisted RPC signature exists'
);
select results_eq(
  $$
    select count(*)::bigint
    from expected_authenticated_rpcs expected
    where not pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(expected.signature),
      'EXECUTE'
    )
  $$,
  array[0::bigint],
  'authenticated can execute every allowlisted RPC'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'public'
      and pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from expected_authenticated_rpcs expected
        where pg_catalog.to_regprocedure(expected.signature) = function_row.oid
      )
  $$,
  array[0::bigint],
  'authenticated has no execute access outside the RPC allowlist'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies policy_row
    join expected_application_tables expected on expected.name = policy_row.tablename
    where policy_row.schemaname = 'public'
      and policy_row.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  $$,
  array[0::bigint],
  'application-table writes have no direct client policies'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies policy_row
    join expected_application_tables expected on expected.name = policy_row.tablename
    where policy_row.schemaname = 'public'
      and policy_row.cmd = 'SELECT'
      and position('auth.uid()' in policy_row.qual) = 0
  $$,
  array[0::bigint],
  'every direct read policy binds ownership to auth.uid()'
);

select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$
    insert into public.subjects(id, owner_id, name, color, icon)
    values (
      'f3000000-0000-4000-8000-000000000001',
      'f2222222-2222-4222-8222-222222222222',
      'Manipuliert', '#123456', 'book'
    )
  $$,
  '42501',
  'permission denied for table subjects',
  'a manipulated owner_id cannot bypass the RPC boundary'
);
select throws_ok(
  $$
    insert into public.study_sessions(
      id, user_id, subject_id, source, started_at, ended_at,
      duration_seconds, entered_at
    ) values (
      'f3000000-0000-4000-8000-000000000002',
      'f2222222-2222-4222-8222-222222222222',
      'f3000000-0000-4000-8000-000000000003',
      'manual', clock_timestamp() - interval '1 minute', clock_timestamp(),
      60, clock_timestamp()
    )
  $$,
  '42501',
  'permission denied for table study_sessions',
  'a manipulated user_id cannot bypass the RPC boundary'
);
select throws_ok(
  $$
    insert into public.goals(
      id, creator_id, scope, target_type, target_value,
      source_policy, starts_at
    ) values (
      'f3000000-0000-4000-8000-000000000004',
      'f2222222-2222-4222-8222-222222222222',
      'personal', 'duration', 60, 'all', clock_timestamp()
    )
  $$,
  '42501',
  'permission denied for table goals',
  'a manipulated creator_id cannot bypass the RPC boundary'
);

reset role;
select * from finish();
rollback;
