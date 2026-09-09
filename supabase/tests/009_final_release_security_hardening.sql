begin;

create extension if not exists pgtap with schema extensions;
select plan(47);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'account_deletion_prepare_before_delete'
      and not t.tgisinternal
      and (t.tgtype & 2) = 2
      and (t.tgtype & 8) = 8
  ),
  1,
  'account preparation is a row-level BEFORE DELETE trigger on auth.users'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies p
    where p.schemaname = 'realtime'
      and p.tablename = 'messages'
      and p.policyname = 'shared_goal_participants_can_receive'
  ),
  0,
  'the revocation-prone per-goal Realtime policy is removed'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger t
    where not t.tgisinternal
      and t.tgname in (
        'study_sessions_broadcast_shared_goal',
        'goal_participants_broadcast_shared_goal',
        'goals_broadcast_shared_goal'
      )
  ),
  0,
  'all legacy shared-goal topic publishers are removed'
);

select ok(
  position(
    'entity_id' in pg_catalog.pg_get_functiondef(
      'private.send_social_invalidation(uuid,text,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'p_goal_id' in pg_catalog.pg_get_functiondef(
      'private.notify_shared_goal_participants(uuid,text,uuid)'::regprocedure
    )
  ) > 0,
  'per-user shared-goal inbox invalidations include the affected entity id'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies p
    where p.schemaname = 'realtime'
      and p.tablename = 'messages'
      and p.policyname = 'social_user_can_receive'
      and p.cmd = 'SELECT'
      and p.roles = array['authenticated']::name[]
      and position('social:user:' in p.qual::text) > 0
      and position('auth.uid()' in p.qual::text) > 0
  ),
  1,
  'the authenticated client retains only its identity-bound social inbox'
);

select ok(
  coalesce((
    select position('storage.foldername' in p.with_check) > 0
      and position('auth.uid()' in p.with_check) > 0
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'Users can upload their own avatar'
      and p.cmd = 'INSERT'
  ), false),
  'the authenticated avatar INSERT policy retains its canonical owner/path gate'
);

select ok(
  position(
    'pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
      'private.enforce_avatar_object_quota()'::regprocedure
    )
  ) > 0
  and position(
    'existing_count >= 100' in pg_catalog.pg_get_functiondef(
      'private.enforce_avatar_object_quota()'::regprocedure
    )
  ) > 0,
  'the non-client-executable avatar trigger serializes and caps each account at one hundred objects'
);

select ok(
  (with definition as (
    select lower(pg_catalog.pg_get_functiondef(
      'private.enforce_avatar_object_quota()'::regprocedure
    )) value
  )
  select position('pg_advisory_xact_lock' in value) > 0
    and position('account_deletion_intents' in value)
      > position('pg_advisory_xact_lock' in value)
    and position('account_deletion_in_progress' in value)
      > position('account_deletion_intents' in value)
  from definition),
  'avatar inserts lock before reading the account-deletion fence'
);

select ok(
  has_function_privilege(
    'service_role', 'public.begin_account_deletion(uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.begin_account_deletion(uuid)', 'execute'
  ),
  'only the service role can begin the persistent Storage deletion fence'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.privacy_settings'::regclass
      and t.tgname = 'privacy_settings_broadcast_social'
      and not t.tgisinternal
  )
  and position(
    'shared_goal_progress' in pg_catalog.pg_get_functiondef(
      'private.broadcast_privacy_invalidation()'::regprocedure
    )
  ) > 0,
  'privacy visibility changes invalidate social peers and entity-aware shared-goal progress'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.conname = 'profiles_display_name_safe_text'
      and constraint_row.contype = 'c'
  )
  and position(
    'display_name_contains_disallowed_characters'
    in pg_catalog.pg_get_functiondef(
      'private.validate_profile()'::regprocedure
    )
  ) > 0,
  'profile writes enforce the server-side display-name control and bidi filter'
);

select ok(
  (with definition as (
    select lower(pg_catalog.pg_get_functiondef(
      'private.prepare_account_deletion(uuid)'::regprocedure
    )) value
  )
  select position('from public.profiles' in value) > 0
    and position('for update' in value) > 0
    and position('from public.profiles' in value)
      < position('for group_row in' in value)
    and position('for update' in value)
      < position('for group_row in' in value)
  from definition),
  'account deletion locks the profile row before scanning FK-backed shared data'
);

select throws_ok(
  $$insert into auth.users(
      id, aud, role, email, raw_user_meta_data, created_at, updated_at
    ) values (
      'd9777777-7777-4777-8777-777777777777',
      'authenticated',
      'authenticated',
      'unsafe-name-final@example.test',
      jsonb_build_object(
        'username', 'unsafe9',
        'display_name', 'Unsafe' || U&'\202E' || 'Name',
        'time_zone', 'Europe/Berlin'
      ),
      clock_timestamp(),
      clock_timestamp()
    )$$,
  '22023',
  'display_name_contains_disallowed_characters',
  'the Auth signup metadata path rejects bidirectional display-name controls'
);

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  (
    'd9111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'alice-final@example.test',
    '{"username":"alice9","display_name":"Alice","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'bob-final@example.test',
    '{"username":"bob9","display_name":"Bob","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
    'cara-final@example.test',
    '{"username":"cara9","display_name":"Cara","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
    'delete-final@example.test',
    '{"username":"delete9","display_name":"Delete Me","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated',
    'rollback-final@example.test',
    '{"username":"rollback9","display_name":"Rollback Me","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated',
    'orphan-group-final@example.test',
    '{"username":"orphan9","display_name":"Detached Child","time_zone":"Europe/Berlin","community_rules_version":"2026-08-02","community_rules_accepted_at":"2026-08-02T10:00:00Z"}',
    clock_timestamp(), clock_timestamp()
  );

select throws_ok(
  $$insert into public.study_groups(id, creator_id, name, icon, image_url)
    values (
      'd9000000-0000-4000-8000-000000000001',
      'd9111111-1111-4111-8111-111111111111',
      'Tracking image', 'book', 'https://tracker.example/pixel.png'
    )$$,
  '23514',
  'new row for relation "study_groups" violates check constraint "study_groups_image_url"',
  'study groups reject arbitrary remote image URLs'
);

update public.profiles
set avatar_url = 'https://project.example/storage/v1/object/public/avatars/d9222222-2222-4222-8222-222222222222/profile/d9222222-2222-4222-8222-222222222222.jpg?v=test'
where id = 'd9222222-2222-4222-8222-222222222222';

insert into public.goals(
  id, creator_id, scope, title, target_type, target_value,
  source_policy, starts_at, ends_at
) values (
  'd9100000-0000-4000-8000-000000000001',
  'd9111111-1111-4111-8111-111111111111',
  'shared', 'Avatar privacy goal', 'duration', 1800,
  'all', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
);
insert into public.shared_goal_details(goal_id, description, mode, period, cadence)
values (
  'd9100000-0000-4000-8000-000000000001', '', 'shared', 'custom', 'weekly'
);
insert into public.goal_participants(
  goal_id, user_id, role, status, invited_by, responded_at, accepted_at
) values
  (
    'd9100000-0000-4000-8000-000000000001',
    'd9111111-1111-4111-8111-111111111111',
    'creator', 'accepted', 'd9111111-1111-4111-8111-111111111111',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9100000-0000-4000-8000-000000000001',
    'd9222222-2222-4222-8222-222222222222',
    'member', 'accepted', 'd9111111-1111-4111-8111-111111111111',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9100000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'accepted', 'd9111111-1111-4111-8111-111111111111',
    clock_timestamp(), clock_timestamp()
  );

insert into public.friendships(
  id, requester_id, addressee_id, status, responded_at
) values (
  'd9f00000-0000-4000-8000-000000000001',
  'd9111111-1111-4111-8111-111111111111',
  'd9222222-2222-4222-8222-222222222222',
  'accepted', clock_timestamp()
);

select set_config('request.jwt.claim.sub', 'd9111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'test.alice_profile_revision',
  (
    select p.revision::text from public.profiles p
    where p.id = 'd9111111-1111-4111-8111-111111111111'
  ),
  true
);
set local role authenticated;

select throws_ok(
  $$select public.update_my_profile(
    'alice9',
    'Alice' || U&'\0085' || 'Injected',
    null,
    'Europe/Berlin',
    current_setting('test.alice_profile_revision')::integer
  )$$,
  '22023',
  'display_name_contains_disallowed_characters',
  'the profile RPC cannot bypass the C1 display-name filter'
);

select throws_ok(
  $$select public.update_my_profile(
    'alice9',
    'Alice' || U&'\001F' || 'Injected',
    null,
    'Europe/Berlin',
    current_setting('test.alice_profile_revision')::integer
  )$$,
  '22023',
  'display_name_contains_disallowed_characters',
  'the profile RPC cannot bypass the C0 display-name filter'
);

select is(
  (
    select participant -> 'user' ->> 'avatar_url'
    from jsonb_array_elements(
      public.get_shared_goal_progress('d9100000-0000-4000-8000-000000000001')
        -> 'participants'
    ) participant
    where participant ->> 'user_id' = 'd9222222-2222-4222-8222-222222222222'
  ),
  null::text,
  'shared-goal progress hides another participant avatar by default'
);

reset role;
update public.privacy_settings
set share_avatar = true,
    share_currently_learning = true,
    share_last_active_at = true
where user_id = 'd9222222-2222-4222-8222-222222222222';
set local role authenticated;

select ok(
  (
    select participant -> 'user' ->> 'avatar_url' like 'https://project.example/%'
    from jsonb_array_elements(
      public.get_shared_goal_progress('d9100000-0000-4000-8000-000000000001')
        -> 'participants'
    ) participant
    where participant ->> 'user_id' = 'd9222222-2222-4222-8222-222222222222'
  ),
  'shared-goal progress returns an avatar only after explicit sharing'
);

reset role;
select ok(
  private.can_receive_presence_invalidation(
    'd9222222-2222-4222-8222-222222222222',
    'd9111111-1111-4111-8111-111111111111'
  ),
  'an unblocked friend receives presence invalidation when a field is shared'
);

insert into public.user_blocks(blocker_id, blocked_id)
values (
  'd9111111-1111-4111-8111-111111111111',
  'd9222222-2222-4222-8222-222222222222'
);

select ok(
  not private.can_receive_presence_invalidation(
    'd9222222-2222-4222-8222-222222222222',
    'd9111111-1111-4111-8111-111111111111'
  ),
  'a block immediately excludes the recipient from presence invalidations'
);

set local role authenticated;
select is(
  (
    select participant -> 'user' ->> 'avatar_url'
    from jsonb_array_elements(
      public.get_shared_goal_progress('d9100000-0000-4000-8000-000000000001')
        -> 'participants'
    ) participant
    where participant ->> 'user_id' = 'd9222222-2222-4222-8222-222222222222'
  ),
  null::text,
  'a block hides a previously shared avatar in collaborative progress'
);

reset role;
delete from public.user_blocks
where blocker_id = 'd9111111-1111-4111-8111-111111111111'
  and blocked_id = 'd9222222-2222-4222-8222-222222222222';

insert into public.learning_presence(
  user_id, device_id, state, active_since, last_study_at, last_seen_at, expires_at
) values (
  'd9222222-2222-4222-8222-222222222222',
  'd9333333-3333-4333-8333-333333333333',
  'learning',
  clock_timestamp() - interval '5 minutes',
  clock_timestamp() - interval '1 minute',
  clock_timestamp(),
  clock_timestamp() + interval '10 minutes'
);

create temporary table privacy_invalidation_log (
  recipient uuid not null,
  kind text not null,
  entity_id uuid
) on commit drop;

create or replace function private.send_social_invalidation(
  p_recipient uuid,
  p_kind text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_recipient is not null then
    insert into pg_temp.privacy_invalidation_log(recipient, kind)
    values (p_recipient, coalesce(nullif(p_kind, ''), 'social'));
  end if;
end;
$$;

create or replace function private.send_social_invalidation(
  p_recipient uuid,
  p_kind text,
  p_entity_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_recipient is not null and p_entity_id is not null then
    insert into pg_temp.privacy_invalidation_log(recipient, kind, entity_id)
    values (
      p_recipient,
      coalesce(nullif(p_kind, ''), 'social'),
      p_entity_id
    );
  end if;
end;
$$;

update public.privacy_settings
set share_avatar = false,
    share_currently_learning = false,
    share_pause_status = false,
    share_last_active_at = false
where user_id = 'd9222222-2222-4222-8222-222222222222';

select ok(
  exists (
    select 1 from pg_temp.privacy_invalidation_log log
    where log.recipient = 'd9111111-1111-4111-8111-111111111111'
      and log.kind = 'privacy' and log.entity_id is null
  )
  and exists (
    select 1 from pg_temp.privacy_invalidation_log log
    where log.recipient = 'd9333333-3333-4333-8333-333333333333'
      and log.kind = 'privacy' and log.entity_id is null
  )
  and exists (
    select 1 from pg_temp.privacy_invalidation_log log
    where log.recipient = 'd9111111-1111-4111-8111-111111111111'
      and log.kind = 'shared_goal_progress'
      and log.entity_id = 'd9100000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from pg_temp.privacy_invalidation_log log
    where log.recipient = 'd9333333-3333-4333-8333-333333333333'
      and log.kind = 'shared_goal_progress'
      and log.entity_id = 'd9100000-0000-4000-8000-000000000001'
  ),
  'a visibility opt-out invalidates both friends and shared-goal collaborators'
);

update public.learning_presence
set last_seen_at = clock_timestamp(),
    expires_at = clock_timestamp() + interval '10 minutes'
where user_id = 'd9222222-2222-4222-8222-222222222222';

select ok(
  not private.can_receive_presence_invalidation(
    'd9222222-2222-4222-8222-222222222222',
    'd9111111-1111-4111-8111-111111111111'
  )
  and not exists (
    select 1 from pg_temp.privacy_invalidation_log log
    where log.kind = 'presence'
  ),
  'privacy-off presence writes emit no activity-timing invalidation'
);

set local role authenticated;
select ok(
  (with overviews as (
    select overview value
    from jsonb_array_elements(
      public.list_friend_overviews() -> 'friends'
    ) overview
    where overview -> 'friend' ->> 'id'
      = 'd9222222-2222-4222-8222-222222222222'
  )
  select value ->> 'presence_status' = 'offline'
    and value ->> 'last_active_at' is null
    and value -> 'friend' ->> 'avatar_url' is null
  from overviews)
  and (
    select participant -> 'user' ->> 'avatar_url' is null
    from jsonb_array_elements(
      public.get_shared_goal_progress(
        'd9100000-0000-4000-8000-000000000001'
      ) -> 'participants'
    ) participant
    where participant ->> 'user_id'
      = 'd9222222-2222-4222-8222-222222222222'
  ),
  'privacy opt-out immediately redacts cached presence and avatar projections'
);
reset role;

insert into storage.objects(bucket_id, name, metadata)
select
  'avatars',
  'd9111111-1111-4111-8111-111111111111/profile/'
    || lpad(to_hex(value), 8, '0')
    || '-0000-4000-8000-'
    || lpad(to_hex(value), 12, '0')
    || '.jpg',
  '{"mimetype":"image/jpeg","size":128}'::jsonb
from generate_series(1, 99) value;

set local role authenticated;
select lives_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      'd9111111-1111-4111-8111-111111111111/profile/00000064-0000-4000-8000-000000000064.jpg',
      '{"mimetype":"image/jpeg","contentLength":128,"size":128}'::jsonb
    )$$,
  'the serialized avatar quota permits the one-hundredth object'
);

select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      'd9111111-1111-4111-8111-111111111111/profile/00000065-0000-4000-8000-000000000065.jpg',
      '{"mimetype":"image/jpeg","contentLength":128,"size":128}'::jsonb
    )$$,
  'P0003',
  'avatar_object_limit',
  'the serialized avatar quota rejects a one-hundred-and-first object'
);
reset role;

-- Observe the side effect in a new statement snapshot. A CTE and its sibling
-- EXISTS share the snapshot taken before the volatile RPC inserts the fence.
create temporary table deletion_fence_result as
select public.begin_account_deletion(
  'd9111111-1111-4111-8111-111111111111'
) value;

select ok(
  (
  select value ->> 'prepared' = 'true'
    and value ->> 'trigger_managed' = 'true'
    and value ->> 'storage_fenced' = 'true'
    and exists (
      select 1 from private.account_deletion_intents intent
      where intent.user_id = 'd9111111-1111-4111-8111-111111111111'
    )
  from pg_temp.deletion_fence_result),
  'begin_account_deletion establishes the persistent Storage fence'
);

select ok(
  (with retry as (
    select public.begin_account_deletion(
      'd9111111-1111-4111-8111-111111111111'
    ) value
  )
  select value ->> 'storage_fenced' = 'true'
    and (
      select count(*) = 1
      from private.account_deletion_intents intent
      where intent.user_id = 'd9111111-1111-4111-8111-111111111111'
    )
  from retry),
  'a retry idempotently reuses one fence without reopening avatar uploads'
);

set local role authenticated;
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'avatars',
      'd9111111-1111-4111-8111-111111111111/profile/00000066-0000-4000-8000-000000000066.jpg',
      '{"mimetype":"image/jpeg","contentLength":128,"size":128}'::jsonb
    )$$,
  'P0003',
  'account_deletion_in_progress',
  'the deletion fence rejects a new authenticated avatar before quota evaluation'
);
reset role;

insert into public.content_reports(
  id, reporter_id, entity_type, entity_id, reason, description,
  status, moderation_action, resolution_note, moderator_reference,
  moderated_at
) values (
  'd9e00000-0000-4000-8000-000000000001',
  'd9111111-1111-4111-8111-111111111111',
  'profile', 'd9222222-2222-4222-8222-222222222222',
  'privacy', 'User-visible report text', 'resolved', 'hide',
  'INTERNAL_RESOLUTION_SECRET', 'INTERNAL_MODERATOR_REFERENCE',
  clock_timestamp()
);

set local role authenticated;
select ok(
  (with exported as (select public.export_my_data() value)
   select value ->> 'schema_version' = '2'
     and value -> 'profile' ->> 'email' = 'alice-final@example.test'
     and position('bob-final@example.test' in value::text) = 0
   from exported),
  'the minimized export is versioned and contains only the callers email'
);

select ok(
  (with exported as (select public.export_my_data() value)
   select position('"revision"' in value::text) = 0
     and position('"sync_version"' in value::text) = 0
     and position('"deleted_at"' in value::text) = 0
     and position('"username_needs_review"' in value::text) = 0
     and position('"reporter_id"' in value::text) = 0
     and position('"resolution_note"' in value::text) = 0
     and position('"moderator_reference"' in value::text) = 0
     and position('INTERNAL_RESOLUTION_SECRET' in value::text) = 0
     and position('INTERNAL_MODERATOR_REFERENCE' in value::text) = 0
   from exported),
  'the export contains no sync, deletion, review, or moderation internals'
);

select is(
  (with exported as (select public.export_my_data() value)
   select jsonb_array_length(value -> 'reports')
   from exported),
  1,
  'the caller still receives the safe user-facing projection of their report'
);
reset role;

insert into private.mutation_receipts(
  user_id, operation_id, function_name, result, created_at
) values
  (
    'd9111111-1111-4111-8111-111111111111',
    'd9d00000-0000-4000-8000-000000000001',
    'old_test_receipt', '{"old":true}', clock_timestamp() - interval '91 days'
  ),
  (
    'd9111111-1111-4111-8111-111111111111',
    'd9d00000-0000-4000-8000-000000000002',
    'recent_test_receipt', '{"recent":true}', clock_timestamp() - interval '1 day'
  );

select is(
  private.write_mutation_receipt(
    'd9111111-1111-4111-8111-111111111111',
    'd9d00000-0000-4000-8000-000000000003',
    'new_test_receipt',
    '{"ok":true}'::jsonb
  ),
  '{"ok":true}'::jsonb,
  'a mutation receipt write retains its idempotent result'
);

select ok(
  position(
    'consume_rate_limit' in pg_catalog.pg_get_functiondef(
      'private.write_mutation_receipt(uuid,uuid,text,jsonb)'::regprocedure
    )
  ) > 0
  and position(
    '10000' in pg_catalog.pg_get_functiondef(
      'private.write_mutation_receipt(uuid,uuid,text,jsonb)'::regprocedure
    )
  ) > 0,
  'receipt writes enforce a generous per-user daily burst ceiling'
);

select ok(
  not exists (
    select 1 from private.mutation_receipts r
    where r.operation_id = 'd9d00000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from private.mutation_receipts r
    where r.operation_id = 'd9d00000-0000-4000-8000-000000000002'
  )
  and exists (
    select 1 from private.mutation_receipts r
    where r.operation_id = 'd9d00000-0000-4000-8000-000000000003'
  ),
  'receipt writes enforce the established ninety-day retention window'
);

insert into public.study_groups(id, creator_id, name, icon)
values (
  'd9400000-0000-4000-8000-000000000001',
  'd9444444-4444-4444-8444-444444444444',
  'Deletion transfer group', 'book'
);
insert into public.study_group_members(
  group_id, user_id, role, status, invited_by, responded_at, accepted_at
) values
  (
    'd9400000-0000-4000-8000-000000000001',
    'd9444444-4444-4444-8444-444444444444',
    'creator', 'accepted', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), '2026-08-01T10:00:00Z'
  ),
  (
    'd9400000-0000-4000-8000-000000000001',
    'd9111111-1111-4111-8111-111111111111',
    'member', 'accepted', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), '2026-08-02T10:00:00Z'
  ),
  (
    'd9400000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'accepted', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), '2026-08-03T10:00:00Z'
  );

insert into public.goals(
  id, creator_id, scope, title, target_type, target_value,
  source_policy, starts_at, ends_at
) values (
  'd9410000-0000-4000-8000-000000000001',
  'd9444444-4444-4444-8444-444444444444',
  'shared', 'Participant-safe transfer goal', 'duration', 1800,
  'all', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
);
insert into public.shared_goal_details(
  goal_id, description, mode, period, cadence, group_id
) values (
  'd9410000-0000-4000-8000-000000000001', '', 'shared', 'custom', 'weekly',
  'd9400000-0000-4000-8000-000000000001'
);
insert into public.goal_participants(
  goal_id, user_id, role, status, invited_by, responded_at, accepted_at
) values
  (
    'd9410000-0000-4000-8000-000000000001',
    'd9444444-4444-4444-8444-444444444444',
    'creator', 'accepted', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9410000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'accepted', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), clock_timestamp()
  );

insert into public.shared_study_sessions(
  id, creator_id, group_id, title, starts_at,
  planned_duration_seconds, status
) values (
  'd9420000-0000-4000-8000-000000000001',
  'd9444444-4444-4444-8444-444444444444',
  'd9400000-0000-4000-8000-000000000001',
  'Participant-safe transfer session', clock_timestamp(), 1800, 'planned'
);
insert into public.shared_study_session_participants(
  session_id, user_id, role, status, invited_by, responded_at, joined_at
) values
  (
    'd9420000-0000-4000-8000-000000000001',
    'd9444444-4444-4444-8444-444444444444',
    'creator', 'joined', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9420000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'joined', 'd9444444-4444-4444-8444-444444444444',
    clock_timestamp(), clock_timestamp()
  );

set constraints all immediate;
select throws_ok(
  $$delete from auth.users
    where id = 'd9444444-4444-4444-8444-444444444444'$$,
  'P0003',
  'account_deletion_fence_required',
  'Auth deletion cannot bypass the pre-traversal Storage fence'
);

select public.begin_account_deletion(
  'd9444444-4444-4444-8444-444444444444'
);
select lives_ok(
  $$delete from auth.users
    where id = 'd9444444-4444-4444-8444-444444444444'$$,
  'Auth deletion and ownership preparation complete in one transaction'
);

select is(
  (
    select g.creator_id
    from public.study_groups g
    where g.id = 'd9400000-0000-4000-8000-000000000001'
  ),
  'd9111111-1111-4111-8111-111111111111'::uuid,
  'group ownership transfers to the earliest accepted group member'
);

select ok(
  (
    select g.creator_id = 'd9333333-3333-4333-8333-333333333333'
    from public.goals g
    where g.id = 'd9410000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.goal_participants gp
    where gp.goal_id = 'd9410000-0000-4000-8000-000000000001'
      and gp.user_id = 'd9333333-3333-4333-8333-333333333333'
      and gp.role = 'creator' and gp.status = 'accepted'
  ),
  'goal ownership transfers only to an accepted goal participant'
);

select ok(
  (
    select s.creator_id = 'd9333333-3333-4333-8333-333333333333'
    from public.shared_study_sessions s
    where s.id = 'd9420000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.shared_study_session_participants sp
    where sp.session_id = 'd9420000-0000-4000-8000-000000000001'
      and sp.user_id = 'd9333333-3333-4333-8333-333333333333'
      and sp.role = 'creator' and sp.status = 'joined'
  ),
  'session ownership transfers only to a joined session participant'
);

select ok(
  not exists (
    select 1 from public.profiles p
    where p.id = 'd9444444-4444-4444-8444-444444444444'
  )
  and not exists (
    select 1 from public.study_group_members gm
    where gm.user_id = 'd9444444-4444-4444-8444-444444444444'
  )
  and not exists (
    select 1 from public.goal_participants gp
    where gp.user_id = 'd9444444-4444-4444-8444-444444444444'
  )
  and not exists (
    select 1 from public.shared_study_session_participants sp
    where sp.user_id = 'd9444444-4444-4444-8444-444444444444'
  ),
  'the deleted account leaves no profile or participant references'
);

set constraints all deferred;
insert into public.study_groups(id, creator_id, name, icon)
values (
  'd9600000-0000-4000-8000-000000000001',
  'd9666666-6666-4666-8666-666666666666',
  'Group without accepted successor', 'book'
);
insert into public.study_group_members(
  group_id, user_id, role, status, invited_by,
  responded_at, accepted_at, left_at
) values
  (
    'd9600000-0000-4000-8000-000000000001',
    'd9666666-6666-4666-8666-666666666666',
    'creator', 'accepted', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp(), null
  ),
  (
    'd9600000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'left', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp(), clock_timestamp()
  );

insert into public.goals(
  id, creator_id, scope, title, target_type, target_value,
  source_policy, starts_at, ends_at
) values (
  'd9610000-0000-4000-8000-000000000001',
  'd9666666-6666-4666-8666-666666666666',
  'shared', 'Detached surviving goal', 'duration', 1800,
  'all', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
);
insert into public.shared_goal_details(
  goal_id, description, mode, period, cadence, group_id
) values (
  'd9610000-0000-4000-8000-000000000001', '', 'shared', 'custom', 'weekly',
  'd9600000-0000-4000-8000-000000000001'
);
insert into public.goal_participants(
  goal_id, user_id, role, status, invited_by, responded_at, accepted_at
) values
  (
    'd9610000-0000-4000-8000-000000000001',
    'd9666666-6666-4666-8666-666666666666',
    'creator', 'accepted', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9610000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'accepted', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp()
  );

insert into public.shared_study_sessions(
  id, creator_id, group_id, title, starts_at,
  planned_duration_seconds, status
) values (
  'd9620000-0000-4000-8000-000000000001',
  'd9666666-6666-4666-8666-666666666666',
  'd9600000-0000-4000-8000-000000000001',
  'Detached surviving session', clock_timestamp(), 1800, 'planned'
);
insert into public.shared_study_session_participants(
  session_id, user_id, role, status, invited_by, responded_at, joined_at
) values
  (
    'd9620000-0000-4000-8000-000000000001',
    'd9666666-6666-4666-8666-666666666666',
    'creator', 'joined', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9620000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'joined', 'd9666666-6666-4666-8666-666666666666',
    clock_timestamp(), clock_timestamp()
  );

set constraints all immediate;
select public.begin_account_deletion(
  'd9666666-6666-4666-8666-666666666666'
);
select lives_ok(
  $$delete from auth.users
    where id = 'd9666666-6666-4666-8666-666666666666'$$,
  'a group without an accepted successor preserves eligible child participants'
);

select ok(
  not exists (
    select 1 from public.study_groups g
    where g.id = 'd9600000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.profiles p
    where p.id = 'd9666666-6666-4666-8666-666666666666'
  ),
  'the successorless group and deleting profile are removed'
);

select ok(
  exists (
    select 1
    from public.goals g
    join public.shared_goal_details sgd on sgd.goal_id = g.id
    join public.goal_participants gp
      on gp.goal_id = g.id and gp.user_id = g.creator_id
    where g.id = 'd9610000-0000-4000-8000-000000000001'
      and g.creator_id = 'd9333333-3333-4333-8333-333333333333'
      and sgd.group_id is null
      and gp.role = 'creator' and gp.status = 'accepted'
  ),
  'a reachable accepted child-goal participant inherits a detached goal'
);

select ok(
  exists (
    select 1
    from public.shared_study_sessions s
    join public.shared_study_session_participants sp
      on sp.session_id = s.id and sp.user_id = s.creator_id
    where s.id = 'd9620000-0000-4000-8000-000000000001'
      and s.creator_id = 'd9333333-3333-4333-8333-333333333333'
      and s.group_id is null
      and sp.role = 'creator' and sp.status = 'joined'
  ),
  'a reachable joined child-session participant inherits a detached session'
);

set constraints all deferred;
insert into public.goals(
  id, creator_id, scope, title, target_type, target_value,
  source_policy, starts_at, ends_at
) values (
  'd9510000-0000-4000-8000-000000000001',
  'd9555555-5555-4555-8555-555555555555',
  'shared', 'Rollback transfer goal', 'duration', 1800,
  'all', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
);
insert into public.shared_goal_details(goal_id, description, mode, period, cadence)
values (
  'd9510000-0000-4000-8000-000000000001', '', 'shared', 'custom', 'weekly'
);
insert into public.goal_participants(
  goal_id, user_id, role, status, invited_by, responded_at, accepted_at
) values
  (
    'd9510000-0000-4000-8000-000000000001',
    'd9555555-5555-4555-8555-555555555555',
    'creator', 'accepted', 'd9555555-5555-4555-8555-555555555555',
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd9510000-0000-4000-8000-000000000001',
    'd9333333-3333-4333-8333-333333333333',
    'member', 'accepted', 'd9555555-5555-4555-8555-555555555555',
    clock_timestamp(), clock_timestamp()
  );

select public.begin_account_deletion(
  'd9555555-5555-4555-8555-555555555555'
);

create function pg_temp.reject_auth_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'forced_auth_delete_failure';
end;
$$;

create trigger zz_test_reject_auth_delete
before delete on auth.users
for each row execute function pg_temp.reject_auth_delete();

select throws_ok(
  $$delete from auth.users
    where id = 'd9555555-5555-4555-8555-555555555555'$$,
  'P0001',
  'forced_auth_delete_failure',
  'a later Auth deletion failure aborts the statement'
);

drop trigger zz_test_reject_auth_delete on auth.users;

select ok(
  exists (
    select 1 from auth.users u
    where u.id = 'd9555555-5555-4555-8555-555555555555'
  )
  and exists (
    select 1 from public.profiles p
    where p.id = 'd9555555-5555-4555-8555-555555555555'
  )
  and exists (
    select 1 from private.account_deletion_intents intent
    where intent.user_id = 'd9555555-5555-4555-8555-555555555555'
  )
  and (
    select g.creator_id = 'd9555555-5555-4555-8555-555555555555'
    from public.goals g
    where g.id = 'd9510000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.goal_participants gp
    where gp.goal_id = 'd9510000-0000-4000-8000-000000000001'
      and gp.user_id = 'd9555555-5555-4555-8555-555555555555'
      and gp.role = 'creator'
  )
  and exists (
    select 1 from public.goal_participants gp
    where gp.goal_id = 'd9510000-0000-4000-8000-000000000001'
      and gp.user_id = 'd9333333-3333-4333-8333-333333333333'
      and gp.role = 'member'
  ),
  'failed Auth deletion rolls back every ownership and participant mutation'
);

set constraints all immediate;
select * from finish();
rollback;
