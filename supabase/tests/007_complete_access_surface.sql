begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

create temporary table expected_public_tables(name text primary key) on commit drop;
insert into expected_public_tables(name) values
  ('community_rule_acceptances'),
  ('content_reports'),
  ('friendships'),
  ('goal_participants'),
  ('goal_pause_intervals'),
  ('goals'),
  ('grade_sessions'),
  ('grades'),
  ('learning_presence'),
  ('personal_goal_details'),
  ('privacy_settings'),
  ('profiles'),
  ('shared_goal_details'),
  ('shared_study_session_participants'),
  ('shared_study_sessions'),
  ('study_group_members'),
  ('study_groups'),
  ('study_session_segments'),
  ('study_sessions'),
  ('subjects'),
  ('user_blocks');

select results_eq(
  $$
    select c.relname::text collate "C" as name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  $$,
  $$select name collate "C" as name from expected_public_tables order by name$$,
  'every exposed table is explicitly inventoried'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ),
  0,
  'RLS is enabled on every exposed table without relying on a hand-picked subset'
);

select is(
  (
    select count(*)::integer
    from expected_public_tables expected
    where pg_catalog.has_table_privilege(
      'anon', pg_catalog.format('public.%I', expected.name),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ),
  0,
  'anon has no direct application-table privilege'
);

select is(
  (
    select count(*)::integer
    from expected_public_tables expected
    where pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('public.%I', expected.name),
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ),
  0,
  'authenticated cannot write, truncate, reference, or trigger any table directly'
);

select results_eq(
  $$
    select expected.name collate "C" as name
    from expected_public_tables expected
    where pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('public.%I', expected.name), 'SELECT'
    )
    order by name
  $$,
  array[
    'friendships', 'goal_participants', 'goal_pause_intervals', 'goals',
    'grade_sessions', 'grades', 'personal_goal_details', 'privacy_settings',
    'profiles', 'study_session_segments', 'study_sessions', 'subjects'
  ]::text[] collate "C",
  'authenticated raw reads are limited to the reviewed owner-scoped tables'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and cmd <> 'SELECT'
  ),
  0,
  'no direct INSERT, UPDATE, or DELETE RLS policy exists'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
  ),
  0,
  'every SECURITY DEFINER function pins an empty search_path'
);

select results_eq(
  $$
    select distinct p.proname::text collate "C" as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by 1
  $$,
  array[
    'accept_community_rules', 'accept_friend_request', 'begin_local_import', 'block_user',
    'cancel_shared_study_session',
    'create_shared_goal', 'create_shared_study_session', 'create_study_group',
    'decline_friend_request', 'discard_local_import', 'finalize_local_import',
    'export_my_data', 'find_profile_by_exact_username', 'get_community_rules_acceptance',
    'get_friend_overview', 'get_local_import_status', 'get_my_profile',
    'get_shared_goal_details', 'get_shared_goal_progress',
    'get_shared_study_session_details', 'get_study_group_details', 'leave_study_group',
    'list_friend_connections', 'list_friend_overviews', 'list_my_blocked_profiles',
    'list_my_stale_avatar_objects',
    'list_shared_goal_progress', 'list_shared_goals', 'list_shared_study_sessions',
    'list_study_groups', 'moderate_content_report', 'prepare_account_deletion',
    'pull_my_study_changes', 'remove_friendship',
    'respond_shared_goal_invitation', 'respond_shared_study_session_invitation',
    'respond_study_group_invitation', 'save_completed_session', 'send_friend_request',
    'set_my_avatar', 'soft_delete_grade', 'soft_delete_personal_goal',
    'soft_delete_session', 'soft_delete_subject', 'stage_local_import_chunk',
    'submit_content_report',
    'transition_personal_goal', 'update_learning_presence', 'update_my_profile',
    'update_privacy_settings', 'update_shared_study_session_participant',
    'unblock_user', 'upsert_grade', 'upsert_personal_goal', 'upsert_subject',
    'withdraw_from_shared_goal'
  ]::text[] collate "C",
  'every public function name is explicitly inventoried'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  57,
  'the function inventory includes authenticated and service-role-only RPCs'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname not in ('moderate_content_report', 'prepare_account_deletion')
  ),
  0,
  'authenticated can execute each client RPC'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.moderate_content_report(uuid,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.prepare_account_deletion(uuid)', 'EXECUTE'
  ),
  'administrative moderation and deletion preparation remain service-role-only'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname in ('public', 'private')
      and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or acl.grantee = 'anon'::regrole)
  ),
  0,
  'neither PUBLIC nor anon can execute application functions'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  0,
  'authenticated cannot execute private helpers'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and (
        pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
      )
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  ),
  0,
  'no exposed view runs with owner privileges'
);

select ok(
  not pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
  and not pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE'),
  'client roles cannot resolve private objects'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and p.prosrc ~* '(^|[^a-z_])execute([^a-z_]|$)'
  ),
  0,
  'SECURITY DEFINER functions contain no dynamic SQL execution'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname in ('public', 'private')
      and constraint_row.conname in (
        'rpc_rate_limits_action_format', 'goals_security_target_bounds',
        'goals_security_date_bounds', 'study_sessions_security_date_bounds',
        'study_sessions_duration_within_window', 'study_session_segments_count_limit',
        'study_session_segments_security_date_bounds', 'grades_assessment_date_bounds',
        'shared_study_sessions_date_bounds'
      )
  ),
  9,
  'release bounds are present at the table layer'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class table_row on table_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public' and not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'study_groups_quota_before_insert', 'shared_study_sessions_quota_before_insert',
        'shared_goals_quota_before_insert', 'friendships_quota_before_insert',
        'study_group_members_quota_before_insert',
        'shared_session_participants_quota_before_insert',
        'goal_participants_quota_before_insert', 'profiles_rate_limit_before_update'
      )
  ),
  8,
  'abuse quotas are enforced by database triggers'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.consume_rate_limit(uuid,text,integer,interval)', 'EXECUTE'
  ),
  'the rate-limit primitive cannot be called by a client'
);

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values (
  'f1111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'surface-owner@example.test',
  '{"username":"surfaceowner","display_name":"Surface Owner","time_zone":"UTC"}',
  now(), now()
);
insert into public.subjects(id, owner_id, name, color, icon)
values (
  'f2111111-1111-4111-8111-111111111111',
  'f1111111-1111-4111-8111-111111111111',
  'Surface subject', '#123456', 'book'
);

select throws_ok(
  $$do $block$ begin
    insert into public.goals(
      id, creator_id, scope, target_type, target_value, source_policy, starts_at
    ) values (
      'f3111111-1111-4111-8111-111111111111',
      'f1111111-1111-4111-8111-111111111111',
      'personal', 'duration', 31536001, 'all', now()
    );
  exception when check_violation then
    raise exception using errcode = '23514', message = 'goal_bounds_rejected';
  end $block$;$$,
  '23514', 'goal_bounds_rejected',
  'extreme goal values are rejected by a CHECK constraint'
);

select throws_ok(
  $$do $block$ begin
    insert into public.goals(
      id, creator_id, scope, target_type, target_value, source_policy, starts_at
    ) values (
      'f3111111-1111-4111-8111-111111111112',
      'f1111111-1111-4111-8111-111111111111',
      'personal', 'duration', 60, 'all', '2150-01-01 00:00:00+00'
    );
  exception when check_violation then
    raise exception using errcode = '23514', message = 'goal_date_rejected';
  end $block$;$$,
  '23514', 'goal_date_rejected',
  'out-of-policy goal dates are rejected'
);

select throws_ok(
  $$do $block$ begin
    insert into public.study_sessions(
      id, user_id, subject_id, source, started_at, ended_at,
      duration_seconds, entered_at
    ) values (
      'f4111111-1111-4111-8111-111111111111',
      'f1111111-1111-4111-8111-111111111111',
      'f2111111-1111-4111-8111-111111111111',
      'manual', now() - interval '1 second', now(), 600, now()
    );
  exception when check_violation then
    raise exception using errcode = '23514', message = 'session_duration_rejected';
  end $block$;$$,
  '23514', 'session_duration_rejected',
  'a manipulated duration cannot exceed the session wall-clock window'
);

select throws_ok(
  $$do $block$ begin
    insert into public.grades(
      id, user_id, subject_id, assessment_type, assessment_date, points
    ) values (
      'f5111111-1111-4111-8111-111111111111',
      'f1111111-1111-4111-8111-111111111111',
      'f2111111-1111-4111-8111-111111111111',
      'exam', date '1900-01-01', 10
    );
  exception when check_violation then
    raise exception using errcode = '23514', message = 'grade_date_rejected';
  end $block$;$$,
  '23514', 'grade_date_rejected',
  'invalid grade dates are rejected'
);

insert into public.study_sessions(
  id, user_id, subject_id, source, started_at, ended_at, duration_seconds
) values (
  'f4111111-1111-4111-8111-111111111112',
  'f1111111-1111-4111-8111-111111111111',
  'f2111111-1111-4111-8111-111111111111',
  'timer', now() - interval '10 minutes', now(), 600
);
select throws_ok(
  $$do $block$ begin
    insert into public.study_session_segments(
      session_id, ordinal, user_id, started_at, ended_at
    ) values (
      'f4111111-1111-4111-8111-111111111112', 1440,
      'f1111111-1111-4111-8111-111111111111',
      now() - interval '10 minutes', now()
    );
  exception when check_violation then
    raise exception using errcode = '23514', message = 'segment_count_rejected';
  end $block$;$$,
  '23514', 'segment_count_rejected',
  'excessive session segments are rejected'
);

select lives_ok(
  $$select private.consume_rate_limit(
    'f1111111-1111-4111-8111-111111111111', 'surface_test', 2, interval '1 hour'
  )$$,
  'the first bounded action is accepted'
);
select lives_ok(
  $$select private.consume_rate_limit(
    'f1111111-1111-4111-8111-111111111111', 'surface_test', 2, interval '1 hour'
  )$$,
  'the second bounded action is accepted'
);
select throws_ok(
  $$select private.consume_rate_limit(
    'f1111111-1111-4111-8111-111111111111', 'surface_test', 2, interval '1 hour'
  )$$,
  'P0003', 'rate_limit_exceeded',
  'the server rejects an action beyond its rate limit'
);

select * from finish();
rollback;
