begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'privacy_settings', 'privacy settings exist');
select has_table('public', 'subjects', 'subjects exist');
select has_table('public', 'goals', 'canonical goals exist');
select has_table('public', 'personal_goal_details', 'personal goal details exist');
select has_table('public', 'shared_goal_details', 'shared goal details exist');
select has_table('public', 'goal_participants', 'goal participants exist');
select has_table('public', 'goal_pause_intervals', 'goal pause intervals exist');
select has_table('public', 'study_sessions', 'study sessions exist');
select has_table('public', 'study_session_segments', 'session segments exist');
select has_table('public', 'grades', 'grades exist');
select has_table('public', 'grade_sessions', 'grade/session links exist');
select has_table('public', 'friendships', 'friendships exist');
select has_table('private', 'import_batches', 'private import batches exist');
select has_table('private', 'import_chunks', 'private import chunks exist');
select has_table('private', 'local_id_map', 'private local id map exists');
select has_table('private', 'mutation_receipts', 'private mutation receipts exist');
select has_table('private', 'rpc_rate_limits', 'private rate limits exist');
select has_table('private', 'account_sync_state', 'transactional account sync watermarks exist');

select col_is_pk('public', 'profiles', 'id', 'profile id is primary key');
select col_is_pk('public', 'goal_participants', array['goal_id', 'user_id'], 'participant key is composite');
select col_is_pk('public', 'study_session_segments', array['session_id', 'ordinal'], 'segment key is composite');

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'privacy_settings', 'subjects', 'goals',
        'personal_goal_details', 'shared_goal_details', 'goal_participants',
        'goal_pause_intervals', 'study_sessions', 'study_session_segments',
        'grades', 'grade_sessions', 'friendships'
      )
      and not c.relrowsecurity
  $$,
  array[0::bigint],
  'RLS is enabled on every exposed application table'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.get_my_profile()', 'execute'),
  'anon cannot execute profile RPC'
);
select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.get_my_profile()', 'execute'),
  'authenticated can execute profile RPC'
);
select ok(
  not pg_catalog.has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has no private schema visibility'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.import_batches', 'select'),
  'authenticated cannot read private import data'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
  $$,
  array[0::bigint],
  'every security definer function pins an empty search_path'
);

select has_index('public', 'profiles', 'profiles_username_unique', 'username uniqueness is indexed');
select has_index('public', 'friendships', 'friendships_one_active_pair', 'active friendship pair is unique');
select has_index('public', 'study_sessions', 'study_sessions_goal_time_idx', 'goal progress lookup is indexed');

select has_check(
  'public', 'profiles', 'profiles_username_format',
  'profile username format is enforced by a named constraint'
);

select * from finish();
rollback;
