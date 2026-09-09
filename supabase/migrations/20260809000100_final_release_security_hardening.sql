begin;

-- Study-group images are not currently part of the product flow. Persisting an
-- arbitrary remote URL would nevertheless make every viewer contact a third
-- party chosen by another user. Remove legacy values and fail closed until the
-- product has an owned Storage-backed group-image flow.
update public.study_groups
set image_url = null
where image_url is not null;

update private.mutation_receipts receipt
set result = jsonb_set(
  receipt.result, '{group,image_url}', 'null'::jsonb, false
)
where receipt.function_name = 'create_study_group'
  and receipt.result #> '{group,image_url}' is not null
  and receipt.result #> '{group,image_url}' <> 'null'::jsonb;

alter table public.study_groups
  drop constraint if exists study_groups_image_url;
alter table public.study_groups
  add constraint study_groups_image_url check (image_url is null);

-- Display names are rendered in social and collaborative contexts. Strip any
-- legacy terminal/control or bidirectional-formatting characters, then reject
-- them on every future profile write (including the Auth metadata trigger).
-- PostgreSQL text cannot contain U+0000; the expression covers the remainder
-- of U+0000-001F plus DEL/C1 and the Unicode bidi controls rejected by clients.
with cleaned_profiles as (
  select
    p.id,
    btrim(regexp_replace(
      p.display_name,
      U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]',
      '',
      'g'
    )) as display_name
  from public.profiles p
  where p.display_name ~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
)
update public.profiles p
set display_name = case
  when char_length(cleaned.display_name) between 2 and 50
    then cleaned.display_name
  else 'Lernende Person'
end
from cleaned_profiles cleaned
where cleaned.id = p.id;

create or replace function private.validate_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.username := lower(btrim(new.username));
  new.display_name := btrim(new.display_name);

  if new.display_name ~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]' then
    raise exception using
      errcode = '22023',
      message = 'display_name_contains_disallowed_characters';
  end if;

  begin
    perform now() at time zone new.time_zone;
  exception when invalid_parameter_value then
    raise exception using
      errcode = '22023',
      message = 'invalid_time_zone';
  end;

  return new;
end;
$$;

alter table public.profiles
  drop constraint if exists profiles_display_name_safe_text;
alter table public.profiles
  add constraint profiles_display_name_safe_text check (
    display_name !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
  );

-- Storage deletion is an external operation, so fence new avatar writes before
-- an account-deletion worker starts traversing the bucket. The FK removes the
-- marker with a successful Auth deletion. Both marker changes and avatar
-- inserts take the same transaction-scoped lock, making the handoff linear:
-- an upload either commits before begin returns (and is traversed) or waits and
-- is rejected after the marker becomes visible.
create table private.account_deletion_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp()
);

alter table private.account_deletion_intents enable row level security;
revoke all on table private.account_deletion_intents
from public, anon, authenticated, service_role;

create or replace function private.begin_account_deletion_intent(p_user_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deletion_started_at timestamptz;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
  end if;

  perform u.id
  from auth.users u
  where u.id = p_user_id
  for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('avatar-objects:' || p_user_id::text, 0)
  );
  insert into private.account_deletion_intents(user_id, started_at)
  values (p_user_id, clock_timestamp())
  on conflict (user_id) do nothing;
  select intent.started_at into deletion_started_at
  from private.account_deletion_intents intent
  where intent.user_id = p_user_id;

  return deletion_started_at;
end;
$$;

revoke all on function private.begin_account_deletion_intent(uuid)
from public, anon, authenticated, service_role;

-- Canonical avatar uploads use a unique object name. Serialize the per-account
-- count so concurrent uploads cannot race past a generous ceiling. A trigger
-- keeps this primitive non-executable by client roles while the INSERT policy
-- remains the canonical owner/path/content gate. The current client normally
-- retains one object and removes its predecessor; one hundred leaves ample
-- room for interrupted cleanup without permitting unbounded Storage growth.
create or replace function private.enforce_avatar_object_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  existing_count integer;
begin
  if new.bucket_id <> 'avatars'
     or coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  actor := auth.uid();
  if actor is null
     or (storage.foldername(new.name))[1] is distinct from actor::text then
    -- The authenticated INSERT policy reports the canonical RLS failure.
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('avatar-objects:' || actor::text, 0)
  );
  if exists (
    select 1
    from private.account_deletion_intents intent
    where intent.user_id = actor
  ) then
    raise exception using
      errcode = 'P0003', message = 'account_deletion_in_progress';
  end if;

  select count(*) into existing_count
  from storage.objects object_row
  where object_row.bucket_id = 'avatars'
    and object_row.name like actor::text || '/%';

  if existing_count >= 100 then
    raise exception using errcode = 'P0003', message = 'avatar_object_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists avatar_objects_quota_before_insert on storage.objects;
create trigger avatar_objects_quota_before_insert
before insert on storage.objects
for each row execute function private.enforce_avatar_object_quota();

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (storage.foldername(name))[2] = 'profile'
  and array_length(storage.foldername(name), 1) = 2
  and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
  and case
    when coalesce(metadata ->> 'contentLength', metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
      then coalesce(metadata ->> 'contentLength', metadata ->> 'size')::bigint
    else 0
  end between 1 and 5242880
  and (
    (name ~ '\.jpg$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/jpeg')
    or (name ~ '\.png$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/png')
    or (name ~ '\.webp$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/webp')
  )
  and coalesce(
    (public.get_community_rules_acceptance() ->> 'accepted')::boolean,
    false
  )
);

revoke all on function private.enforce_avatar_object_quota()
from public, anon, authenticated;

-- Shared-goal progress is a participant-scoped projection, but profile-image
-- privacy still applies inside that projection. A participant always sees
-- their own avatar; every other avatar requires the owner's explicit opt-in
-- and remains hidden across a block relationship.
create or replace function private.shared_goal_progress_read_model(
  p_goal_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  shared_goal public.goals%rowtype;
  shared_details public.shared_goal_details%rowtype;
  creator_time_zone text;
  reference_at timestamptz;
  cadence_start timestamptz;
  cadence_end timestamptz;
  contribution_end timestamptz;
  participants jsonb;
  team_contribution numeric;
  target_display numeric;
begin
  if not private.is_goal_participant(p_goal_id, p_actor, true) then
    raise exception using errcode = '42501', message = 'accepted_participation_required';
  end if;

  select g.* into shared_goal
  from public.goals g
  where g.id = p_goal_id and g.scope = 'shared' and g.deleted_at is null;
  select * into shared_details
  from public.shared_goal_details sgd where sgd.goal_id = p_goal_id;
  if shared_goal.id is null or shared_details.goal_id is null then
    raise exception using errcode = 'P0001', message = 'shared_goal_not_found';
  end if;

  select p.time_zone into creator_time_zone
  from public.profiles p where p.id = shared_goal.creator_id;
  reference_at := greatest(
    shared_goal.starts_at,
    least(
      clock_timestamp(),
      coalesce(shared_goal.ends_at - interval '1 microsecond', clock_timestamp())
    )
  );

  if shared_details.cadence = 'daily' then
    cadence_start := date_trunc(
      'day', reference_at at time zone creator_time_zone
    ) at time zone creator_time_zone;
    cadence_end := (
      date_trunc('day', reference_at at time zone creator_time_zone) + interval '1 day'
    ) at time zone creator_time_zone;
  else
    cadence_start := date_trunc(
      'week', reference_at at time zone creator_time_zone
    ) at time zone creator_time_zone;
    cadence_end := (
      date_trunc('week', reference_at at time zone creator_time_zone) + interval '1 week'
    ) at time zone creator_time_zone;
  end if;

  cadence_start := greatest(cadence_start, shared_goal.starts_at);
  cadence_end := least(cadence_end, coalesce(shared_goal.ends_at, cadence_end));
  contribution_end := least(
    cadence_end,
    greatest(cadence_start, clock_timestamp())
  );
  target_display := case when shared_goal.target_type = 'duration'
    then shared_goal.target_value / 60.0 else shared_goal.target_value end;

  with participant_values as (
    select
      gp.user_id,
      gp.role,
      p.username,
      p.display_name,
      case
        when gp.user_id = p_actor then p.avatar_url
        when coalesce(ps.share_avatar, false)
          and not private.is_blocked_between(gp.user_id, p_actor)
          then p.avatar_url
        else null
      end as avatar_url,
      case when shared_goal.target_type = 'duration' then coalesce((
        select sum(private.session_contribution_seconds(
          ss.id, cadence_start, contribution_end
        )) / 60.0
        from public.study_sessions ss
        where ss.goal_id = p_goal_id
          and ss.user_id = gp.user_id
          and ss.deleted_at is null
          and (shared_goal.source_policy = 'all' or ss.source = 'timer')
      ), 0)
      else coalesce((
        select count(*)::numeric
        from public.study_sessions ss
        where ss.goal_id = p_goal_id
          and ss.user_id = gp.user_id
          and ss.deleted_at is null
          and ss.started_at >= cadence_start
          and ss.started_at < contribution_end
          and ss.duration_seconds >= shared_goal.minimum_session_seconds
          and (shared_goal.source_policy = 'all' or ss.source = 'timer')
      ), 0) end as contribution
    from public.goal_participants gp
    join public.profiles p on p.id = gp.user_id
    left join public.privacy_settings ps on ps.user_id = gp.user_id
    where gp.goal_id = p_goal_id and gp.status = 'accepted'
  )
  select
    coalesce(sum(pv.contribution), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', pv.user_id,
      'status', 'accepted',
      'user', jsonb_build_object(
        'id', pv.user_id,
        'username', pv.username,
        'display_name', pv.display_name,
        'avatar_url', pv.avatar_url
      ),
      'contribution', round(pv.contribution, 1),
      'progress_percent', case when shared_details.mode = 'per_participant'
        then round(pv.contribution / target_display * 100, 1) else null end,
      'remaining', case when shared_details.mode = 'per_participant'
        then round(greatest(0, target_display - pv.contribution), 1) else null end,
      'achieved', case when shared_details.mode = 'per_participant'
        then pv.contribution >= target_display else null end,
      'excess', case when shared_details.mode = 'per_participant'
        then round(greatest(0, pv.contribution - target_display), 1) else null end
    ) order by pv.role, pv.user_id), '[]'::jsonb)
  into team_contribution, participants
  from participant_values pv;

  return jsonb_build_object(
    'goal_id', shared_goal.id,
    'type', shared_goal.target_type,
    'mode', shared_details.mode,
    'cadence', shared_details.cadence,
    'group_id', shared_details.group_id,
    'source_policy', shared_goal.source_policy,
    'starts_at', shared_goal.starts_at,
    'ends_at', shared_goal.ends_at,
    'period_starts_at', cadence_start,
    'period_ends_at', cadence_end,
    'revision', shared_goal.revision,
    'calculated_at', clock_timestamp(),
    'target', round(target_display, 1),
    'unit', case when shared_goal.target_type = 'duration' then 'minutes' else 'sessions' end,
    'participants', participants,
    'team', case when shared_details.mode = 'shared' then jsonb_build_object(
      'contribution', round(team_contribution, 1),
      'target', round(target_display, 1),
      'progress_percent', round(team_contribution / target_display * 100, 1),
      'remaining', round(greatest(0, target_display - team_contribution), 1),
      'achieved', team_contribution >= target_display,
      'excess', round(greatest(0, team_contribution - target_display), 1)
    ) else null end
  );
end;
$$;

revoke all on function private.shared_goal_progress_read_model(uuid, uuid)
from public, anon, authenticated;

-- The original per-goal broadcast topic authorizes only at channel join time.
-- A participant removed afterward could therefore continue receiving traffic
-- until reconnect. All affected rows already publish opaque invalidations to
-- each account's own inbox, whose authorization is identity-only.
drop trigger if exists study_sessions_broadcast_shared_goal on public.study_sessions;
drop trigger if exists goal_participants_broadcast_shared_goal on public.goal_participants;
drop trigger if exists goals_broadcast_shared_goal on public.goals;
drop policy if exists shared_goal_participants_can_receive on realtime.messages;
drop function if exists private.broadcast_shared_goal_invalidation();
drop function if exists private.broadcast_shared_goal_update();

-- Entity-aware messages let multiple progress listeners share the one inbox
-- without treating every social invalidation as a change to every open goal.
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
  if p_recipient is null or p_entity_id is null then return; end if;
  perform realtime.send(
    jsonb_build_object(
      'kind', coalesce(nullif(p_kind, ''), 'social'),
      'entity_id', p_entity_id
    ),
    'social_invalidated',
    'social:user:' || p_recipient::text,
    true
  );
end;
$$;

create or replace function private.notify_shared_goal_participants(
  p_goal_id uuid,
  p_kind text,
  p_additional_user uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare recipient uuid;
begin
  for recipient in
    select distinct candidates.user_id
    from (
      select gp.user_id
      from public.goal_participants gp
      where gp.goal_id = p_goal_id and gp.status in ('invited', 'accepted')
      union all select p_additional_user
    ) candidates
    where candidates.user_id is not null
  loop
    perform private.send_social_invalidation(recipient, p_kind, p_goal_id);
  end loop;
end;
$$;

create or replace function private.broadcast_shared_goal_participant_social()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_goal uuid := case when tg_op = 'DELETE' then old.goal_id else new.goal_id end;
  affected_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if tg_op = 'DELETE' then
    perform private.send_social_invalidation(
      affected_user, 'shared_goal', affected_goal
    );
  end if;
  if exists (
    select 1 from public.goals g
    where g.id = affected_goal and g.scope = 'shared'
  ) then
    perform private.notify_shared_goal_participants(
      affected_goal, 'shared_goal', affected_user
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.send_social_invalidation(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function private.notify_shared_goal_participants(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function private.broadcast_shared_goal_participant_social()
from public, anon, authenticated;

-- Presence invalidations are sent only when the recipient can legitimately
-- observe at least one presence-derived field. This prevents blocked users and
-- privacy-off friendships from learning activity timing through message flow.
create or replace function private.can_receive_presence_invalidation(
  p_owner uuid,
  p_recipient uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner is not null
    and p_recipient is not null
    and p_owner <> p_recipient
    and not private.is_blocked_between(p_owner, p_recipient)
    and exists (
      select 1
      from public.friendships f
      where f.pair_low = least(p_owner, p_recipient)
        and f.pair_high = greatest(p_owner, p_recipient)
        and f.status = 'accepted'
        and f.deleted_at is null
    )
    and exists (
      select 1
      from public.privacy_settings ps
      where ps.user_id = p_owner
        and (
          ps.share_currently_learning
          or ps.share_pause_status
          or ps.share_last_active_at
        )
    );
$$;

create or replace function private.broadcast_presence_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  recipient uuid;
begin
  for recipient in
    select distinct candidate.user_id
    from (
      select case
        when f.requester_id = affected_user then f.addressee_id
        else f.requester_id
      end as user_id
      from public.friendships f
      where (f.requester_id = affected_user or f.addressee_id = affected_user)
        and f.status = 'accepted'
        and f.deleted_at is null
    ) candidate
    where private.can_receive_presence_invalidation(affected_user, candidate.user_id)
  loop
    perform private.send_social_invalidation(recipient, 'presence');
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.can_receive_presence_invalidation(uuid, uuid)
from public, anon, authenticated;
revoke all on function private.broadcast_presence_invalidation()
from public, anon, authenticated;

-- A visibility opt-out must invalidate already-cached projections even when
-- future presence writes are intentionally silent. Notify every still-relevant
-- social peer through that peer's private inbox. Shared-goal peers also receive
-- an entity-aware progress invalidation so a multiplexed listener can refresh
-- only the affected goal and immediately redact a withdrawn avatar.
create or replace function private.broadcast_privacy_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  shared_goal record;
begin
  perform private.send_social_invalidation(new.user_id, 'privacy');

  for recipient in
    select distinct candidates.user_id
    from (
      select case
        when f.requester_id = new.user_id then f.addressee_id
        else f.requester_id
      end as user_id
      from public.friendships f
      where (f.requester_id = new.user_id or f.addressee_id = new.user_id)
        and f.status in ('pending', 'accepted')
        and f.deleted_at is null
      union all
      select peers.user_id
      from public.goal_participants mine
      join public.goal_participants peers on peers.goal_id = mine.goal_id
      join public.goals g on g.id = mine.goal_id and g.scope = 'shared'
      where mine.user_id = new.user_id
        and mine.status in ('invited', 'accepted')
        and peers.status in ('invited', 'accepted')
      union all
      select peers.user_id
      from public.shared_study_session_participants mine
      join public.shared_study_session_participants peers
        on peers.session_id = mine.session_id
      where mine.user_id = new.user_id
        and mine.status not in ('declined', 'left')
        and peers.status not in ('declined', 'left')
      union all
      select peers.user_id
      from public.study_group_members mine
      join public.study_group_members peers on peers.group_id = mine.group_id
      where mine.user_id = new.user_id
        and mine.status in ('invited', 'accepted')
        and peers.status in ('invited', 'accepted')
    ) candidates
    where candidates.user_id <> new.user_id
      and not private.is_blocked_between(new.user_id, candidates.user_id)
  loop
    perform private.send_social_invalidation(recipient, 'privacy');
  end loop;

  for shared_goal in
    select distinct peers.user_id, mine.goal_id
    from public.goal_participants mine
    join public.goal_participants peers on peers.goal_id = mine.goal_id
    join public.goals g
      on g.id = mine.goal_id and g.scope = 'shared' and g.deleted_at is null
    where mine.user_id = new.user_id
      and mine.status = 'accepted'
      and peers.user_id <> new.user_id
      and peers.status = 'accepted'
      and not private.is_blocked_between(new.user_id, peers.user_id)
  loop
    perform private.send_social_invalidation(
      shared_goal.user_id,
      'shared_goal_progress',
      shared_goal.goal_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists privacy_settings_broadcast_social
on public.privacy_settings;
create trigger privacy_settings_broadcast_social
after update of
  share_timer_stats,
  share_manual_stats,
  share_goal_progress,
  share_streak,
  share_currently_learning,
  share_pause_status,
  share_last_active_at,
  share_today_activity,
  share_weekly_minutes,
  share_avatar,
  discoverable_by_username
on public.privacy_settings
for each row
when (
  row(
    old.share_timer_stats,
    old.share_manual_stats,
    old.share_goal_progress,
    old.share_streak,
    old.share_currently_learning,
    old.share_pause_status,
    old.share_last_active_at,
    old.share_today_activity,
    old.share_weekly_minutes,
    old.share_avatar,
    old.discoverable_by_username
  ) is distinct from row(
    new.share_timer_stats,
    new.share_manual_stats,
    new.share_goal_progress,
    new.share_streak,
    new.share_currently_learning,
    new.share_pause_status,
    new.share_last_active_at,
    new.share_today_activity,
    new.share_weekly_minutes,
    new.share_avatar,
    new.discoverable_by_username
  )
)
execute function private.broadcast_privacy_invalidation();

revoke all on function private.broadcast_privacy_invalidation()
from public, anon, authenticated;

-- A block changes the readable social graph immediately. Notify both private
-- inboxes so either client can discard cached profile/presence projections.
create or replace function private.broadcast_block_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  blocker uuid := case when tg_op = 'DELETE' then old.blocker_id else new.blocker_id end;
  blocked uuid := case when tg_op = 'DELETE' then old.blocked_id else new.blocked_id end;
begin
  perform private.send_social_invalidation(blocker, 'block');
  perform private.send_social_invalidation(blocked, 'block');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists user_blocks_broadcast_social on public.user_blocks;
create trigger user_blocks_broadcast_social
after insert or delete on public.user_blocks
for each row execute function private.broadcast_block_invalidation();

revoke all on function private.broadcast_block_invalidation()
from public, anon, authenticated;

-- The existing retention contract is ninety days, but cleanup previously ran
-- only when a local import happened. Apply the same retention on every receipt
-- write so accounts that never import cannot grow this table indefinitely.
create or replace function private.write_mutation_receipt(
  p_user_id uuid,
  p_operation_id uuid,
  p_function_name text,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Far above legitimate interactive or sync volume while bounding deliberate
  -- operation-id churn. Normal duplicate replays return from
  -- read_mutation_receipt() before reaching this writer.
  perform private.consume_rate_limit(
    p_user_id, 'mutation_receipt_write', 10000, interval '1 day'
  );

  delete from private.mutation_receipts r
  where r.user_id = p_user_id
    and r.created_at < clock_timestamp() - interval '90 days';

  insert into private.mutation_receipts(user_id, operation_id, function_name, result)
  values (p_user_id, p_operation_id, p_function_name, p_result)
  on conflict (user_id, operation_id, function_name) do nothing;

  return (
    select r.result
    from private.mutation_receipts r
    where r.user_id = p_user_id
      and r.operation_id = p_operation_id
      and r.function_name = p_function_name
  );
end;
$$;

revoke all on function private.write_mutation_receipt(uuid, uuid, text, jsonb)
from public, anon, authenticated;

-- Export only user-facing account data. Explicit projections prevent future
-- columns (moderation state, sync internals, audit metadata, or service data)
-- from silently becoming downloadable API fields.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
begin
  perform private.consume_rate_limit(actor, 'data_export', 5, interval '1 day');

  return jsonb_build_object(
    'schema_version', 2,
    'exported_at', clock_timestamp(),
    'profile', (
      select jsonb_build_object(
        'account_id', p.id,
        'email', u.email,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'time_zone', p.time_zone,
        'created_at', p.created_at
      )
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.id = actor
    ),
    'privacy_settings', (
      select jsonb_build_object(
        'share_timer_stats', ps.share_timer_stats,
        'share_manual_stats', ps.share_manual_stats,
        'share_goal_progress', ps.share_goal_progress,
        'share_streak', ps.share_streak,
        'share_currently_learning', ps.share_currently_learning,
        'share_pause_status', ps.share_pause_status,
        'share_last_active_at', ps.share_last_active_at,
        'share_today_activity', ps.share_today_activity,
        'share_weekly_minutes', ps.share_weekly_minutes,
        'share_avatar', ps.share_avatar,
        'discoverable_by_username', ps.discoverable_by_username
      )
      from public.privacy_settings ps
      where ps.user_id = actor
    ),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'color', s.color,
        'icon', s.icon,
        'archived_at', s.archived_at,
        'created_at', s.created_at
      ) order by s.created_at)
      from public.subjects s
      where s.owner_id = actor and s.deleted_at is null
    ), '[]'::jsonb),
    'study_sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'subject_id', s.subject_id,
        'goal_id', s.goal_id,
        'source', s.source,
        'started_at', s.started_at,
        'ended_at', s.ended_at,
        'duration_seconds', s.duration_seconds,
        'planned_duration_seconds', s.planned_duration_seconds,
        'entered_at', s.entered_at,
        'subject_name_snapshot', s.subject_name_snapshot,
        'goal_title_snapshot', s.goal_title_snapshot,
        'note', s.legacy_note,
        'created_at', s.created_at,
        'segments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'ordinal', seg.ordinal,
            'started_at', seg.started_at,
            'ended_at', seg.ended_at
          ) order by seg.ordinal)
          from public.study_session_segments seg
          where seg.session_id = s.id and seg.user_id = actor
        ), '[]'::jsonb)
      ) order by s.started_at)
      from public.study_sessions s
      where s.user_id = actor and s.deleted_at is null
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'subject_id', g.subject_id,
        'assessment_type', g.assessment_type,
        'title', g.title,
        'assessment_date', g.assessment_date,
        'points', g.points,
        'additional_study_seconds', g.additional_study_seconds,
        'subject_name_snapshot', g.subject_name_snapshot,
        'created_at', g.created_at,
        'session_ids', coalesce((
          select jsonb_agg(gs.session_id order by gs.created_at)
          from public.grade_sessions gs
          where gs.grade_id = g.id and gs.user_id = actor
        ), '[]'::jsonb)
      ) order by g.created_at)
      from public.grades g
      where g.user_id = actor and g.deleted_at is null
    ), '[]'::jsonb),
    'personal_goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'title', g.title,
        'target_type', g.target_type,
        'target_value', g.target_value,
        'minimum_session_seconds', g.minimum_session_seconds,
        'source_policy', g.source_policy,
        'starts_at', g.starts_at,
        'ends_at', g.ends_at,
        'status', g.status,
        'completed_at', g.completed_at,
        'archived_at', g.archived_at,
        'created_at', g.created_at,
        'details', jsonb_build_object(
          'subject_id', pgd.subject_id,
          'period', pgd.period
        ),
        'pause_intervals', coalesce((
          select jsonb_agg(jsonb_build_object(
            'started_at', pause.started_at,
            'ended_at', pause.ended_at
          ) order by pause.started_at)
          from public.goal_pause_intervals pause
          where pause.goal_id = g.id
        ), '[]'::jsonb)
      ) order by g.created_at)
      from public.goals g
      join public.personal_goal_details pgd on pgd.goal_id = g.id
      where pgd.owner_id = actor and g.deleted_at is null
    ), '[]'::jsonb),
    'shared_goal_contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'goal', jsonb_build_object(
          'id', g.id,
          'title', g.title,
          'status', g.status,
          'starts_at', g.starts_at,
          'ends_at', g.ends_at
        ),
        'participation', jsonb_build_object(
          'role', gp.role,
          'status', gp.status,
          'invited_at', gp.invited_at,
          'responded_at', gp.responded_at,
          'accepted_at', gp.accepted_at,
          'withdrawn_at', gp.withdrawn_at
        )
      ) order by gp.created_at)
      from public.goal_participants gp
      join public.goals g on g.id = gp.goal_id
      where gp.user_id = actor and g.scope = 'shared' and g.deleted_at is null
    ), '[]'::jsonb),
    'shared_session_contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session', jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'status', s.status,
          'starts_at', s.starts_at,
          'planned_duration_seconds', s.planned_duration_seconds
        ),
        'participation', jsonb_build_object(
          'role', sp.role,
          'status', sp.status,
          'invited_at', sp.invited_at,
          'responded_at', sp.responded_at,
          'joined_at', sp.joined_at,
          'elapsed_seconds', sp.elapsed_seconds,
          'finished_at', sp.finished_at,
          'left_at', sp.left_at
        )
      ) order by sp.created_at)
      from public.shared_study_session_participants sp
      join public.shared_study_sessions s on s.id = sp.session_id
      where sp.user_id = actor
    ), '[]'::jsonb),
    'group_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group', jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'icon', g.icon,
          'created_at', g.created_at
        ),
        'membership', jsonb_build_object(
          'role', gm.role,
          'status', gm.status,
          'invited_at', gm.invited_at,
          'responded_at', gm.responded_at,
          'accepted_at', gm.accepted_at,
          'left_at', gm.left_at
        )
      ) order by gm.created_at)
      from public.study_group_members gm
      join public.study_groups g on g.id = gm.group_id
      where gm.user_id = actor
    ), '[]'::jsonb),
    'friendships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'other_user_id', case
          when f.requester_id = actor then f.addressee_id else f.requester_id
        end,
        'direction', case
          when f.requester_id = actor then 'outgoing' else 'incoming'
        end,
        'status', f.status,
        'created_at', f.created_at,
        'responded_at', f.responded_at
      ) order by f.created_at)
      from public.friendships f
      where (f.requester_id = actor or f.addressee_id = actor)
        and f.deleted_at is null
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'blocked_user_id', b.blocked_id,
        'created_at', b.created_at
      ) order by b.created_at)
      from public.user_blocks b
      where b.blocker_id = actor
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'entity_type', r.entity_type,
        'entity_id', r.entity_id,
        'reason', r.reason,
        'description', r.description,
        'status', r.status,
        'created_at', r.created_at
      ) order by r.created_at)
      from public.content_reports r
      where r.reporter_id = actor
    ), '[]'::jsonb),
    'community_rule_acceptances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', a.version,
        'accepted_at', a.accepted_at
      ) order by a.accepted_at)
      from public.community_rule_acceptances a
      where a.user_id = actor
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.export_my_data()
from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;

-- Ownership preparation now runs from a BEFORE DELETE trigger on auth.users.
-- Because it shares the Auth row deletion transaction, any later failure rolls
-- back every ownership change. Successors are selected only from accepted
-- participants of the object being transferred; group ownership alone never
-- grants ownership of a goal or session the user did not join.
create or replace function private.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  group_row record;
  child_goal_row record;
  child_session_row record;
  goal_row record;
  session_row record;
  successor uuid;
  transferred_groups integer := 0;
  transferred_goals integer := 0;
  transferred_sessions integer := 0;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-deletion:' || p_user_id::text, 0)
  );
  perform p.id
  from public.profiles p
  where p.id = p_user_id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('avatar-objects:' || p_user_id::text, 0)
  );
  if not exists (
    select 1
    from private.account_deletion_intents intent
    where intent.user_id = p_user_id
  ) then
    raise exception using
      errcode = 'P0003', message = 'account_deletion_fence_required';
  end if;

  for group_row in
    select g.id
    from public.study_groups g
    where g.creator_id = p_user_id
    order by g.id
    for update
  loop
    successor := null;
    select gm.user_id into successor
    from public.study_group_members gm
    where gm.group_id = group_row.id
      and gm.user_id <> p_user_id
      and gm.status = 'accepted'
    order by gm.accepted_at nulls last, gm.created_at, gm.user_id
    limit 1
    for update;

    if successor is null then
      -- A former group member can still be an accepted participant of an
      -- attached child. Preserve each such child independently of the group
      -- membership state, then detach it before the group is removed.
      for child_goal_row in
        select g.id, g.creator_id
        from public.goals g
        join public.shared_goal_details sgd on sgd.goal_id = g.id
        where sgd.group_id = group_row.id
        order by g.id
        for update of g, sgd
      loop
        if child_goal_row.creator_id = p_user_id then
          successor := null;
          select gp.user_id into successor
          from public.goal_participants gp
          where gp.goal_id = child_goal_row.id
            and gp.user_id <> p_user_id
            and gp.status = 'accepted'
          order by gp.accepted_at nulls last, gp.created_at, gp.user_id
          limit 1
          for update;

          if successor is null then
            delete from public.goals g where g.id = child_goal_row.id;
          else
            update public.goal_participants gp
            set role = 'creator'
            where gp.goal_id = child_goal_row.id and gp.user_id = successor;
            update public.goals g
            set creator_id = successor
            where g.id = child_goal_row.id;
            update public.goal_participants gp
            set role = 'member'
            where gp.goal_id = child_goal_row.id and gp.user_id = p_user_id;
            update public.shared_goal_details sgd
            set group_id = null
            where sgd.goal_id = child_goal_row.id;
            transferred_goals := transferred_goals + 1;
          end if;
        else
          update public.shared_goal_details sgd
          set group_id = null
          where sgd.goal_id = child_goal_row.id;
        end if;
      end loop;

      for child_session_row in
        select s.id, s.creator_id
        from public.shared_study_sessions s
        where s.group_id = group_row.id
        order by s.id
        for update
      loop
        if child_session_row.creator_id = p_user_id then
          successor := null;
          select sp.user_id into successor
          from public.shared_study_session_participants sp
          where sp.session_id = child_session_row.id
            and sp.user_id <> p_user_id
            and sp.status in ('joined', 'active', 'paused', 'finished')
          order by sp.joined_at nulls last, sp.created_at, sp.user_id
          limit 1
          for update;

          if successor is null then
            delete from public.shared_study_sessions s
            where s.id = child_session_row.id;
          else
            update public.shared_study_session_participants sp
            set role = 'creator'
            where sp.session_id = child_session_row.id
              and sp.user_id = successor;
            update public.shared_study_sessions s
            set creator_id = successor,
                group_id = null
            where s.id = child_session_row.id;
            update public.shared_study_session_participants sp
            set role = 'member'
            where sp.session_id = child_session_row.id
              and sp.user_id = p_user_id;
            transferred_sessions := transferred_sessions + 1;
          end if;
        else
          update public.shared_study_sessions s
          set group_id = null
          where s.id = child_session_row.id;
        end if;
      end loop;

      delete from public.study_groups g
      where g.id = group_row.id;
    else
      update public.study_group_members gm
      set role = 'creator'
      where gm.group_id = group_row.id and gm.user_id = successor;
      update public.study_groups g
      set creator_id = successor
      where g.id = group_row.id;
      update public.study_group_members gm
      set role = 'member'
      where gm.group_id = group_row.id and gm.user_id = p_user_id;
      transferred_groups := transferred_groups + 1;
    end if;
  end loop;

  for goal_row in
    select g.id
    from public.goals g
    join public.shared_goal_details sgd on sgd.goal_id = g.id
    where g.creator_id = p_user_id
      and g.scope = 'shared'
      and g.deleted_at is null
    order by g.id
    for update of g
  loop
    successor := null;
    select gp.user_id into successor
    from public.goal_participants gp
    where gp.goal_id = goal_row.id
      and gp.user_id <> p_user_id
      and gp.status = 'accepted'
    order by gp.accepted_at nulls last, gp.created_at, gp.user_id
    limit 1
    for update;

    if successor is null then
      delete from public.goals g where g.id = goal_row.id;
    else
      update public.goal_participants gp
      set role = 'creator'
      where gp.goal_id = goal_row.id and gp.user_id = successor;
      update public.goals g
      set creator_id = successor
      where g.id = goal_row.id;
      update public.goal_participants gp
      set role = 'member'
      where gp.goal_id = goal_row.id and gp.user_id = p_user_id;
      transferred_goals := transferred_goals + 1;
    end if;
  end loop;

  for session_row in
    select s.id
    from public.shared_study_sessions s
    where s.creator_id = p_user_id
    order by s.id
    for update
  loop
    successor := null;
    select sp.user_id into successor
    from public.shared_study_session_participants sp
    where sp.session_id = session_row.id
      and sp.user_id <> p_user_id
      and sp.status in ('joined', 'active', 'paused', 'finished')
    order by sp.joined_at nulls last, sp.created_at, sp.user_id
    limit 1
    for update;

    if successor is null then
      delete from public.shared_study_sessions s
      where s.id = session_row.id;
    else
      update public.shared_study_session_participants sp
      set role = 'creator'
      where sp.session_id = session_row.id and sp.user_id = successor;
      update public.shared_study_sessions s
      set creator_id = successor
      where s.id = session_row.id;
      update public.shared_study_session_participants sp
      set role = 'member'
      where sp.session_id = session_row.id and sp.user_id = p_user_id;
      transferred_sessions := transferred_sessions + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'prepared', true,
    'transferred_groups', transferred_groups,
    'transferred_goals', transferred_goals,
    'transferred_sessions', transferred_sessions
  );
end;
$$;

create or replace function private.prepare_account_deletion_before_auth_delete()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.prepare_account_deletion(old.id);
  return old;
end;
$$;

drop trigger if exists account_deletion_prepare_before_delete on auth.users;
create trigger account_deletion_prepare_before_delete
before delete on auth.users
for each row execute function private.prepare_account_deletion_before_auth_delete();

-- New workers establish this service-role-only fence before traversing
-- Storage. Retries idempotently reuse it and never clear it; only successful
-- Auth deletion cascades the row. Ownership preparation remains exclusively
-- inside the Auth deletion transaction.
create or replace function public.begin_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deletion_started_at timestamptz;
begin
  deletion_started_at := private.begin_account_deletion_intent(p_user_id);
  return jsonb_build_object(
    'prepared', true,
    'trigger_managed', true,
    'storage_fenced', true,
    'user_id', p_user_id,
    'started_at', deletion_started_at
  );
end;
$$;

-- The legacy worker traverses Storage before calling this RPC, so it cannot
-- establish the upload fence safely. Fail closed during version skew and
-- require the worker that calls begin_account_deletion() before traversal.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'account_deletion_edge_upgrade_required';
end;
$$;

revoke all on function private.prepare_account_deletion(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.prepare_account_deletion_before_auth_delete()
from public, anon, authenticated, service_role;
revoke all on function public.begin_account_deletion(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.prepare_account_deletion(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

commit;
