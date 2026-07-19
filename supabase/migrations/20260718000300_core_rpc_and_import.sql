begin;

create or replace function public.get_my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  result jsonb;
begin
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'privacy', to_jsonb(ps)
  ) into result
  from public.profiles p
  join public.privacy_settings ps on ps.user_id = p.id
  where p.id = actor;

  if result is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  return result;
end;
$$;

create or replace function public.update_my_profile(
  p_username text,
  p_display_name text,
  p_avatar_url text,
  p_time_zone text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  updated_profile public.profiles%rowtype;
begin
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  update public.profiles p
  set username = lower(btrim(p_username)),
      display_name = btrim(p_display_name),
      avatar_url = nullif(btrim(p_avatar_url), ''),
      time_zone = p_time_zone,
      username_needs_review = false
  where p.id = actor
    and p.revision = p_expected_revision
  returning p.* into updated_profile;

  if updated_profile.id is null then
    if exists (select 1 from public.profiles where id = actor) then
      raise exception using errcode = 'P0001', message = 'revision_conflict';
    end if;
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  return to_jsonb(updated_profile);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'username_taken';
end;
$$;

create or replace function public.update_privacy_settings(
  p_share_timer_stats boolean,
  p_share_manual_stats boolean,
  p_share_goal_progress boolean,
  p_share_streak boolean,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  updated_privacy public.privacy_settings%rowtype;
begin
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  update public.privacy_settings ps
  set share_timer_stats = p_share_timer_stats,
      share_manual_stats = p_share_manual_stats,
      share_goal_progress = p_share_goal_progress,
      share_streak = p_share_streak
  where ps.user_id = actor
    and ps.revision = p_expected_revision
  returning ps.* into updated_privacy;

  if updated_privacy.user_id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  return to_jsonb(updated_privacy);
end;
$$;

create or replace function public.find_profile_by_exact_username(p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
begin
  if exists (
    select 1 from public.profiles p
    where p.id = actor and p.username_needs_review
  ) then
    raise exception using errcode = 'P0001', message = 'username_review_required';
  end if;

  perform private.consume_rate_limit(actor, 'username_search', 30, interval '1 minute');

  return (
    select jsonb_build_object(
      'user', jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url
      ),
      'connection', (
        select jsonb_build_object(
          'id', f.id,
          'requester_id', f.requester_id,
          'addressee_id', f.addressee_id,
          'status', f.status,
          'direction', case when f.requester_id = actor then 'outgoing' else 'incoming' end
        )
        from public.friendships f
        where f.pair_low = least(actor, p.id)
          and f.pair_high = greatest(actor, p.id)
          and f.deleted_at is null
          and f.status in ('pending', 'accepted')
        limit 1
      )
    )
    from public.profiles p
    where p.username = lower(btrim(p_username))
      and p.id <> actor
      and not p.username_needs_review
    limit 1
  );
end;
$$;

-- Replaced by the social migration. Keeping this helper available from the
-- first cloud migration lets incremental pulls retain a stable response shape.
create or replace function private.my_shared_goals_read_model(p_actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '[]'::jsonb;
$$;

create or replace function public.pull_my_study_changes(p_after_sync_version bigint default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  watermark bigint;
begin
  -- The account counter is transactional. A concurrent writer holds the row
  -- lock until commit, so this statement can only observe a watermark whose
  -- preceding account changes are visible in the same MVCC snapshot.
  select coalesce(s.current_version, 0) into watermark
  from private.account_sync_state s
  where s.user_id = actor;
  watermark := coalesce(watermark, 0);

  return jsonb_build_object(
    'sync_version', watermark,
    'profile', (
      select to_jsonb(p) from public.profiles p
      where p.id = actor and p.sync_version > greatest(p_after_sync_version, 0)
    ),
    'privacy', (
      select to_jsonb(ps) from public.privacy_settings ps
      where ps.user_id = actor and ps.sync_version > greatest(p_after_sync_version, 0)
    ),
    'subjects', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sync_version)
      from public.subjects s
      where s.owner_id = actor and s.sync_version > greatest(p_after_sync_version, 0)
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(
        to_jsonb(g) || jsonb_build_object(
          'period', pgd.period,
          'subject_id', pgd.subject_id,
          'paused_intervals', coalesce((
            select jsonb_agg(to_jsonb(gpi) order by gpi.started_at)
            from public.goal_pause_intervals gpi
            where gpi.goal_id = g.id
          ), '[]'::jsonb)
        ) order by greatest(
          g.sync_version,
          pgd.sync_version,
          coalesce((
            select max(gpi.sync_version)
            from public.goal_pause_intervals gpi
            where gpi.goal_id = g.id
          ), 0)
        )
      )
      from public.goals g
      join public.personal_goal_details pgd on pgd.goal_id = g.id
      where pgd.owner_id = actor
        and greatest(
          g.sync_version,
          pgd.sync_version,
          coalesce((
            select max(gpi.sync_version)
            from public.goal_pause_intervals gpi
            where gpi.goal_id = g.id
          ), 0)
        ) > greatest(p_after_sync_version, 0)
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        to_jsonb(ss) || jsonb_build_object(
          'segments', coalesce((
            select jsonb_agg(to_jsonb(seg) order by seg.ordinal)
            from public.study_session_segments seg
            where seg.session_id = ss.id
          ), '[]'::jsonb)
        ) order by greatest(
          ss.sync_version,
          coalesce((
            select max(seg.sync_version)
            from public.study_session_segments seg
            where seg.session_id = ss.id
          ), 0)
        )
      )
      from public.study_sessions ss
      where ss.user_id = actor
        and greatest(
          ss.sync_version,
          coalesce((
            select max(seg.sync_version)
            from public.study_session_segments seg
            where seg.session_id = ss.id
          ), 0)
        ) > greatest(p_after_sync_version, 0)
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(
        to_jsonb(gr) || jsonb_build_object(
          'session_ids', coalesce((
            select jsonb_agg(gs.session_id order by gs.session_id)
            from public.grade_sessions gs
            where gs.grade_id = gr.id
          ), '[]'::jsonb)
        ) order by greatest(
          gr.sync_version,
          coalesce((
            select max(gs.sync_version)
            from public.grade_sessions gs
            where gs.grade_id = gr.id
          ), 0)
        )
      )
      from public.grades gr
      where gr.user_id = actor
        and greatest(
          gr.sync_version,
          coalesce((
            select max(gs.sync_version)
            from public.grade_sessions gs
            where gs.grade_id = gr.id
          ), 0)
        ) > greatest(p_after_sync_version, 0)
    ), '[]'::jsonb),
    'shared_goals', private.my_shared_goals_read_model(actor)
  );
end;
$$;

create or replace function public.upsert_subject(
  p_subject jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  entity_id uuid := (p_subject ->> 'id')::uuid;
  expected_revision integer := coalesce(
    (p_subject ->> 'expected_revision')::integer,
    (p_subject ->> 'expectedRevision')::integer
  );
  existing public.subjects%rowtype;
  saved public.subjects%rowtype;
  result jsonb;
begin
  if p_operation_id is null or entity_id is null then
    raise exception using errcode = '22023', message = 'invalid_subject_payload';
  end if;

  result := private.read_mutation_receipt(actor, p_operation_id, 'upsert_subject');
  if result is not null then return result; end if;

  select * into existing from public.subjects s where s.id = entity_id for update;

  if existing.id is null then
    insert into public.subjects(id, owner_id, name, color, icon, archived_at)
    values (
      entity_id,
      actor,
      p_subject ->> 'name',
      p_subject ->> 'color',
      p_subject ->> 'icon',
      case when coalesce((p_subject ->> 'archived')::boolean, false)
        then clock_timestamp() else null end
    ) returning * into saved;
  else
    if existing.owner_id <> actor then
      raise exception using errcode = '42501', message = 'subject_forbidden';
    end if;
    if existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'subject_deleted';
    end if;
    if expected_revision is null then
      raise exception using errcode = '22023', message = 'expected_revision_required';
    end if;
    if existing.revision <> expected_revision then
      raise exception using errcode = 'P0001', message = 'revision_conflict';
    end if;

    update public.subjects s
    set name = p_subject ->> 'name',
        color = p_subject ->> 'color',
        icon = p_subject ->> 'icon',
        archived_at = case when coalesce((p_subject ->> 'archived')::boolean, false)
          then coalesce(s.archived_at, clock_timestamp()) else null end
    where s.id = entity_id
    returning * into saved;
  end if;

  return private.write_mutation_receipt(
    actor, p_operation_id, 'upsert_subject', to_jsonb(saved)
  );
end;
$$;

create or replace function public.soft_delete_subject(
  p_id uuid,
  p_expected_revision integer,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.subjects%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'soft_delete_subject');
  if result is not null then return result; end if;

  update public.subjects s
  set deleted_at = coalesce(s.deleted_at, clock_timestamp())
  where s.id = p_id and s.owner_id = actor
    and s.revision = p_expected_revision
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict_or_not_found';
  end if;
  return private.write_mutation_receipt(
    actor, p_operation_id, 'soft_delete_subject', to_jsonb(saved)
  );
end;
$$;

create or replace function public.upsert_personal_goal(
  p_goal jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  entity_id uuid := (p_goal ->> 'id')::uuid;
  subject_id_value uuid := coalesce(p_goal ->> 'subject_id', p_goal ->> 'subjectId')::uuid;
  target_type_value text := p_goal ->> 'type';
  target_value_number integer;
  minimum_seconds_value integer;
  source_policy_value text := coalesce(p_goal ->> 'source_policy', p_goal ->> 'sourcePolicy', 'all');
  period_value text := p_goal ->> 'period';
  expected_revision integer := coalesce(
    (p_goal ->> 'expected_revision')::integer,
    (p_goal ->> 'expectedRevision')::integer
  );
  starts_at_value timestamptz := coalesce(
    (coalesce(p_goal ->> 'starts_at', p_goal ->> 'startsAt'))::timestamptz,
    clock_timestamp()
  );
  ends_at_value timestamptz := nullif(
    coalesce(p_goal ->> 'ends_at', p_goal ->> 'endsAt'), ''
  )::timestamptz;
  existing public.goals%rowtype;
  saved public.goals%rowtype;
  detail public.personal_goal_details%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'upsert_personal_goal');
  if result is not null then return result; end if;

  if target_type_value = 'duration' then
    target_value_number := coalesce(
      (p_goal ->> 'target_value')::integer,
      (p_goal ->> 'targetMinutes')::integer * 60
    );
    minimum_seconds_value := null;
  elsif target_type_value = 'sessions' then
    target_value_number := coalesce(
      (p_goal ->> 'target_value')::integer,
      (p_goal ->> 'targetSessions')::integer
    );
    minimum_seconds_value := coalesce(
      (p_goal ->> 'minimum_session_seconds')::integer,
      (p_goal ->> 'minimumSessionMinutes')::integer * 60
    );
  else
    raise exception using errcode = '22023', message = 'invalid_goal_type';
  end if;

  if entity_id is null or subject_id_value is null then
    raise exception using errcode = '22023', message = 'invalid_goal_payload';
  end if;
  if not exists (
    select 1 from public.subjects s
    where s.id = subject_id_value and s.owner_id = actor and s.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'subject_not_found';
  end if;

  select * into existing from public.goals g where g.id = entity_id for update;
  if existing.id is null then
    insert into public.goals(
      id, creator_id, scope, title, target_type, target_value,
      minimum_session_seconds, source_policy, starts_at, ends_at, status
    ) values (
      entity_id, actor, 'personal', nullif(btrim(p_goal ->> 'title'), ''),
      target_type_value, target_value_number, minimum_seconds_value, source_policy_value,
      starts_at_value, ends_at_value, 'active'
    ) returning * into saved;

    insert into public.personal_goal_details(goal_id, owner_id, subject_id, period)
    values (entity_id, actor, subject_id_value, period_value)
    returning * into detail;

    insert into public.goal_participants(
      goal_id, user_id, role, status, invited_by, responded_at, accepted_at
    ) values (
      entity_id, actor, 'creator', 'accepted', actor,
      clock_timestamp(), clock_timestamp()
    );
  else
    if existing.creator_id <> actor or existing.scope <> 'personal' then
      raise exception using errcode = '42501', message = 'goal_forbidden';
    end if;
    if existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'goal_deleted';
    end if;
    if expected_revision is null then
      raise exception using errcode = '22023', message = 'expected_revision_required';
    end if;
    if existing.revision <> expected_revision then
      raise exception using errcode = 'P0001', message = 'revision_conflict';
    end if;
    if exists (
      select 1
      from public.study_sessions ss
      where ss.goal_id = entity_id
        and ss.user_id = actor
        and ss.subject_id <> subject_id_value
    ) then
      raise exception using errcode = '23514', message = 'goal_subject_has_bound_sessions';
    end if;

    update public.goals g
    set title = nullif(btrim(p_goal ->> 'title'), ''),
        target_type = target_type_value,
        target_value = target_value_number,
        minimum_session_seconds = minimum_seconds_value,
        source_policy = source_policy_value,
        starts_at = starts_at_value,
        ends_at = ends_at_value
    where g.id = entity_id
    returning * into saved;

    update public.personal_goal_details pgd
    set subject_id = subject_id_value,
        period = period_value
    where pgd.goal_id = entity_id
    returning * into detail;
  end if;

  result := jsonb_build_object('goal', to_jsonb(saved), 'details', to_jsonb(detail));
  return private.write_mutation_receipt(
    actor, p_operation_id, 'upsert_personal_goal', result
  );
end;
$$;

create or replace function public.transition_personal_goal(
  p_goal_id uuid,
  p_status text,
  p_at timestamptz,
  p_expected_revision integer,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  transition_at timestamptz := coalesce(p_at, clock_timestamp());
  existing public.goals%rowtype;
  saved public.goals%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'transition_personal_goal');
  if result is not null then return result; end if;

  select g.* into existing
  from public.goals g
  join public.personal_goal_details pgd on pgd.goal_id = g.id
  where g.id = p_goal_id and pgd.owner_id = actor
  for update of g;

  if existing.id is null then
    raise exception using errcode = '42501', message = 'goal_not_found';
  end if;
  if existing.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  if not (
    (existing.status = 'active' and p_status in ('paused', 'completed', 'archived'))
    or (existing.status = 'paused' and p_status in ('active', 'completed', 'archived'))
    or (existing.status = 'completed' and p_status = 'archived')
  ) then
    raise exception using errcode = '22023', message = 'invalid_goal_transition';
  end if;

  if existing.status = 'active' and p_status = 'paused' then
    insert into public.goal_pause_intervals(goal_id, started_at)
    values (p_goal_id, transition_at);
  elsif existing.status = 'paused' then
    update public.goal_pause_intervals gpi
    set ended_at = transition_at
    where gpi.goal_id = p_goal_id and gpi.ended_at is null;
  end if;

  update public.goals g
  set status = p_status,
      completed_at = case when p_status = 'completed' then transition_at else g.completed_at end,
      archived_at = case when p_status = 'archived' then transition_at else g.archived_at end
  where g.id = p_goal_id
  returning * into saved;

  result := jsonb_build_object(
    'goal', to_jsonb(saved),
    'paused_intervals', coalesce((
      select jsonb_agg(to_jsonb(gpi) order by gpi.started_at)
      from public.goal_pause_intervals gpi where gpi.goal_id = p_goal_id
    ), '[]'::jsonb)
  );
  return private.write_mutation_receipt(
    actor, p_operation_id, 'transition_personal_goal', result
  );
end;
$$;

create or replace function private.validate_goal_binding(
  p_actor uuid,
  p_goal_id uuid,
  p_subject_id uuid,
  p_source text,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bound_goal public.goals%rowtype;
  personal_subject uuid;
begin
  if p_goal_id is null then return; end if;

  select g.* into bound_goal
  from public.goals g
  join public.goal_participants gp on gp.goal_id = g.id
  where g.id = p_goal_id
    and gp.user_id = p_actor
    and gp.status = 'accepted'
    and g.deleted_at is null;

  if bound_goal.id is null then
    raise exception using errcode = '42501', message = 'goal_participation_required';
  end if;
  if bound_goal.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'goal_not_active';
  end if;
  if bound_goal.source_policy = 'timer_only' and p_source <> 'timer' then
    raise exception using errcode = '22023', message = 'goal_requires_timer';
  end if;
  if p_ended_at <= bound_goal.starts_at
     or (bound_goal.ends_at is not null and p_started_at >= bound_goal.ends_at) then
    raise exception using errcode = '22023', message = 'session_outside_goal_window';
  end if;

  if bound_goal.scope = 'personal' then
    select pgd.subject_id into personal_subject
    from public.personal_goal_details pgd where pgd.goal_id = p_goal_id;
    if personal_subject is distinct from p_subject_id then
      raise exception using errcode = '23514', message = 'goal_subject_mismatch';
    end if;
  end if;
end;
$$;

create or replace function public.soft_delete_personal_goal(
  p_id uuid,
  p_expected_revision integer,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.goals%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'soft_delete_personal_goal');
  if result is not null then return result; end if;

  update public.goals g
  set deleted_at = coalesce(g.deleted_at, clock_timestamp()),
      archived_at = coalesce(g.archived_at, clock_timestamp()),
      status = 'archived'
  where g.id = p_id
    and g.creator_id = actor
    and g.scope = 'personal'
    and g.revision = p_expected_revision
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict_or_not_found';
  end if;
  return private.write_mutation_receipt(
    actor, p_operation_id, 'soft_delete_personal_goal', to_jsonb(saved)
  );
end;
$$;

create or replace function public.save_completed_session(
  p_session jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  entity_id uuid := (p_session ->> 'id')::uuid;
  subject_id uuid := coalesce(p_session ->> 'subject_id', p_session ->> 'subjectId')::uuid;
  goal_id uuid := nullif(coalesce(p_session ->> 'goal_id', p_session ->> 'goalId'), '')::uuid;
  source_value text := p_session ->> 'source';
  started_at_value timestamptz := coalesce(p_session ->> 'started_at', p_session ->> 'startedAt')::timestamptz;
  ended_at_value timestamptz := coalesce(p_session ->> 'ended_at', p_session ->> 'endedAt')::timestamptz;
  entered_at_value timestamptz := nullif(
    coalesce(p_session ->> 'entered_at', p_session ->> 'enteredAt'), ''
  )::timestamptz;
  duration_value integer;
  planned_value integer := coalesce(
    (p_session ->> 'planned_duration_seconds')::integer,
    (p_session ->> 'plannedDurationMinutes')::integer * 60
  );
  segments jsonb := coalesce(p_session -> 'segments', '[]'::jsonb);
  saved public.study_sessions%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'save_completed_session');
  if result is not null then return result; end if;

  if p_operation_id is null or entity_id is null or subject_id is null
     or source_value not in ('timer', 'manual')
     or started_at_value is null or ended_at_value is null
     or ended_at_value <= started_at_value
     or ended_at_value > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'invalid_session_payload';
  end if;

  if exists (select 1 from public.study_sessions ss where ss.id = entity_id) then
    raise exception using errcode = 'P0001', message = 'session_immutable';
  end if;
  if not exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.owner_id = actor and s.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'subject_not_found';
  end if;

  perform private.validate_goal_binding(
    actor, goal_id, subject_id, source_value, started_at_value, ended_at_value
  );

  if source_value = 'timer' then
    if jsonb_typeof(segments) <> 'array' or jsonb_array_length(segments) = 0 then
      raise exception using errcode = '22023', message = 'timer_segments_required';
    end if;

    with parsed as (
      select
        ordinality,
        (coalesce(value ->> 'started_at', value ->> 'startedAt'))::timestamptz as segment_start,
        (coalesce(value ->> 'ended_at', value ->> 'endedAt'))::timestamptz as segment_end
      from jsonb_array_elements(segments) with ordinality
    ), checked as (
      select *, max(segment_end) over (
        order by segment_start, ordinality
        rows between unbounded preceding and 1 preceding
      ) as previous_end
      from parsed
    )
    select round(sum(extract(epoch from (segment_end - segment_start))))::integer
    into duration_value
    from checked
    where segment_start >= started_at_value
      and segment_end <= ended_at_value
      and segment_end > segment_start
      and (previous_end is null or segment_start >= previous_end);

    if duration_value is null
       or duration_value <= 0
       or duration_value > 604800
       or (select count(*) from jsonb_array_elements(segments)) <> (
         select count(*)
         from (
           select
             (coalesce(value ->> 'started_at', value ->> 'startedAt'))::timestamptz as segment_start,
             (coalesce(value ->> 'ended_at', value ->> 'endedAt'))::timestamptz as segment_end,
             max((coalesce(value ->> 'ended_at', value ->> 'endedAt'))::timestamptz)
               over (
                 order by (coalesce(value ->> 'started_at', value ->> 'startedAt'))::timestamptz, ordinality
                 rows between unbounded preceding and 1 preceding
               ) as previous_end
           from jsonb_array_elements(segments) with ordinality
         ) validated
         where segment_start >= started_at_value
           and segment_end <= ended_at_value
           and segment_end > segment_start
           and (previous_end is null or segment_start >= previous_end)
       ) then
      raise exception using errcode = '22023', message = 'invalid_timer_segments';
    end if;
    entered_at_value := null;
  else
    duration_value := round(extract(epoch from (ended_at_value - started_at_value)))::integer;
    entered_at_value := coalesce(entered_at_value, clock_timestamp());
  end if;

  insert into public.study_sessions(
    id, user_id, subject_id, goal_id, source, started_at, ended_at,
    duration_seconds, planned_duration_seconds, entered_at,
    subject_name_snapshot, goal_title_snapshot
  ) values (
    entity_id, actor, subject_id, goal_id, source_value, started_at_value, ended_at_value,
    duration_value, planned_value, entered_at_value,
    nullif(coalesce(p_session ->> 'subject_name_snapshot', p_session ->> 'subjectNameSnapshot'), ''),
    nullif(coalesce(p_session ->> 'goal_title_snapshot', p_session ->> 'goalTitleSnapshot'), '')
  ) returning * into saved;

  if source_value = 'timer' then
    insert into public.study_session_segments(
      session_id, ordinal, user_id, started_at, ended_at
    )
    select
      entity_id,
      (ordinality - 1)::smallint,
      actor,
      (coalesce(value ->> 'started_at', value ->> 'startedAt'))::timestamptz,
      (coalesce(value ->> 'ended_at', value ->> 'endedAt'))::timestamptz
    from jsonb_array_elements(segments) with ordinality
    order by ordinality;
  end if;

  result := to_jsonb(saved) || jsonb_build_object(
    'segments', case when source_value = 'timer' then segments else '[]'::jsonb end
  );
  return private.write_mutation_receipt(
    actor, p_operation_id, 'save_completed_session', result
  );
end;
$$;

create or replace function public.soft_delete_session(
  p_id uuid,
  p_expected_revision integer,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.study_sessions%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'soft_delete_session');
  if result is not null then return result; end if;

  update public.study_sessions ss
  set deleted_at = coalesce(ss.deleted_at, clock_timestamp())
  where ss.id = p_id and ss.user_id = actor
    and ss.revision = p_expected_revision
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict_or_not_found';
  end if;
  return private.write_mutation_receipt(
    actor, p_operation_id, 'soft_delete_session', to_jsonb(saved)
  );
end;
$$;

create or replace function public.upsert_grade(
  p_grade jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  entity_id uuid := (p_grade ->> 'id')::uuid;
  subject_id_value uuid := coalesce(p_grade ->> 'subject_id', p_grade ->> 'subjectId')::uuid;
  session_ids jsonb := coalesce(p_grade -> 'session_ids', p_grade -> 'sessionIds', '[]'::jsonb);
  expected_revision integer := coalesce(
    (p_grade ->> 'expected_revision')::integer,
    (p_grade ->> 'expectedRevision')::integer
  );
  existing public.grades%rowtype;
  saved public.grades%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'upsert_grade');
  if result is not null then return result; end if;

  if entity_id is null or subject_id_value is null
     or jsonb_typeof(session_ids) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_grade_payload';
  end if;
  if not exists (
    select 1 from public.subjects s
    where s.id = subject_id_value and s.owner_id = actor and s.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'subject_not_found';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(session_ids) requested(id)
    left join public.study_sessions ss
      on ss.id = requested.id::uuid
      and ss.user_id = actor
      and ss.subject_id = subject_id_value
      and ss.deleted_at is null
    where ss.id is null
  ) then
    raise exception using errcode = '23503', message = 'grade_session_mismatch';
  end if;

  select * into existing from public.grades g where g.id = entity_id for update;
  if existing.id is null then
    insert into public.grades(
      id, user_id, subject_id, assessment_type, title, assessment_date,
      points, additional_study_seconds, subject_name_snapshot
    ) values (
      entity_id, actor, subject_id_value,
      coalesce(p_grade ->> 'assessment_type', p_grade ->> 'assessmentType'),
      nullif(btrim(p_grade ->> 'title'), ''),
      nullif(coalesce(p_grade ->> 'assessment_date', p_grade ->> 'assessmentDate'), '')::date,
      (p_grade ->> 'points')::smallint,
      coalesce(
        (p_grade ->> 'additional_study_seconds')::integer,
        (p_grade ->> 'additionalStudyMinutes')::integer * 60,
        0
      ),
      nullif(coalesce(p_grade ->> 'subject_name_snapshot', p_grade ->> 'subjectNameSnapshot'), '')
    ) returning * into saved;
  else
    if existing.user_id <> actor then
      raise exception using errcode = '42501', message = 'grade_forbidden';
    end if;
    if existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'grade_deleted';
    end if;
    if expected_revision is null then
      raise exception using errcode = '22023', message = 'expected_revision_required';
    end if;
    if existing.revision <> expected_revision then
      raise exception using errcode = 'P0001', message = 'revision_conflict';
    end if;

    update public.grades g
    set subject_id = subject_id_value,
        assessment_type = coalesce(p_grade ->> 'assessment_type', p_grade ->> 'assessmentType'),
        title = nullif(btrim(p_grade ->> 'title'), ''),
        assessment_date = nullif(coalesce(p_grade ->> 'assessment_date', p_grade ->> 'assessmentDate'), '')::date,
        points = (p_grade ->> 'points')::smallint,
        additional_study_seconds = coalesce(
          (p_grade ->> 'additional_study_seconds')::integer,
          (p_grade ->> 'additionalStudyMinutes')::integer * 60,
          0
        ),
        subject_name_snapshot = nullif(
          coalesce(p_grade ->> 'subject_name_snapshot', p_grade ->> 'subjectNameSnapshot'), ''
        )
    where g.id = entity_id
    returning * into saved;

    delete from public.grade_sessions gs where gs.grade_id = entity_id;
  end if;

  insert into public.grade_sessions(grade_id, session_id, user_id, subject_id)
  select entity_id, value::uuid, actor, subject_id_value
  from jsonb_array_elements_text(session_ids)
  on conflict do nothing;

  result := to_jsonb(saved) || jsonb_build_object('session_ids', session_ids);
  return private.write_mutation_receipt(actor, p_operation_id, 'upsert_grade', result);
end;
$$;

create or replace function public.soft_delete_grade(
  p_id uuid,
  p_expected_revision integer,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.grades%rowtype;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'soft_delete_grade');
  if result is not null then return result; end if;

  update public.grades g
  set deleted_at = coalesce(g.deleted_at, clock_timestamp())
  where g.id = p_id and g.user_id = actor
    and g.revision = p_expected_revision
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict_or_not_found';
  end if;
  return private.write_mutation_receipt(
    actor, p_operation_id, 'soft_delete_grade', to_jsonb(saved)
  );
end;
$$;

create or replace function private.cleanup_stale_imports(p_user_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from private.import_batches b
  where (p_user_id is null or b.user_id = p_user_id)
    and (
      (b.status = 'staging' and b.updated_at < clock_timestamp() - interval '24 hours')
      or (
        b.status in ('completed', 'completed_with_conflicts')
        and b.finalized_at < clock_timestamp() - interval '90 days'
      )
    );

  delete from private.mutation_receipts r
  where (p_user_id is null or r.user_id = p_user_id)
    and r.created_at < clock_timestamp() - interval '90 days';
end;
$$;

create or replace function public.begin_local_import(
  p_device_fingerprint text,
  p_payload_hash text,
  p_expected_counts jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  batch private.import_batches%rowtype;
  counts jsonb := coalesce(p_expected_counts, '{}'::jsonb);
begin
  if char_length(coalesce(p_device_fingerprint, '')) not between 8 and 200
     or lower(coalesce(p_payload_hash, '')) !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(counts) <> 'object'
     or (select count(*) from jsonb_object_keys(counts)) not between 4 and 5
     or not (counts ?& array['subjects', 'goals', 'sessions', 'grades'])
     or exists (
       select 1 from jsonb_each(counts) entry
       where entry.key not in (
         'subjects', 'goals', 'sessions', 'grades', 'gradeSessionLinks'
       )
         or jsonb_typeof(entry.value) <> 'number'
         or entry.value::text !~ '^[0-9]+$'
     )
     or coalesce((counts ->> 'subjects')::numeric, -1) > 1000
     or coalesce((counts ->> 'goals')::numeric, -1) > 2000
     or coalesce((counts ->> 'sessions')::numeric, -1) > 50000
     or coalesce((counts ->> 'grades')::numeric, -1) > 10000
     or coalesce((counts ->> 'gradeSessionLinks')::numeric, 0) > 50000
     or coalesce((counts ->> 'subjects')::numeric, -1) < 0
     or coalesce((counts ->> 'goals')::numeric, -1) < 0
     or coalesce((counts ->> 'sessions')::numeric, -1) < 0
     or coalesce((counts ->> 'grades')::numeric, -1) < 0
     or coalesce((counts ->> 'gradeSessionLinks')::numeric, 0) < 0
     or (
       (counts ->> 'subjects')::numeric + (counts ->> 'goals')::numeric
       + (counts ->> 'sessions')::numeric + (counts ->> 'grades')::numeric
       + coalesce((counts ->> 'gradeSessionLinks')::numeric, 0)
     ) > 110000 then
    raise exception using errcode = '22023', message = 'invalid_import_manifest';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':import_batches', 0));
  perform private.cleanup_stale_imports(actor);

  select * into batch
  from private.import_batches b
  where b.user_id = actor and b.payload_hash = lower(p_payload_hash);

  if batch.id is null then
    perform private.consume_rate_limit(actor, 'import_begin', 10, interval '1 day');
    if (
      select count(*) from private.import_batches b
      where b.user_id = actor and b.status = 'staging'
    ) >= 3 then
      raise exception using errcode = 'P0001', message = 'too_many_staging_imports';
    end if;

    insert into private.import_batches(
      user_id, device_fingerprint, payload_hash, expected_counts
    ) values (
      actor, p_device_fingerprint, lower(p_payload_hash), counts
    ) returning * into batch;
  elsif batch.expected_counts <> counts
     or batch.device_fingerprint <> p_device_fingerprint then
    raise exception using errcode = 'P0001', message = 'import_manifest_conflict';
  end if;

  return jsonb_build_object(
    'import_id', batch.id,
    'status', batch.status,
    'expected_counts', batch.expected_counts,
    'received_chunks', batch.received_chunks,
    'total_payload_bytes', batch.total_payload_bytes,
    'accepted_chunk_indices', coalesce((
      select jsonb_agg(c.chunk_index order by c.chunk_index)
      from private.import_chunks c where c.import_id = batch.id
    ), '[]'::jsonb),
    'result', batch.result
  );
end;
$$;

create or replace function public.stage_local_import_chunk(
  p_import_id uuid,
  p_chunk_index integer,
  p_chunk_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  batch private.import_batches%rowtype;
  existing_hash text;
  existing_server_hash text;
  computed_server_hash text;
  payload_bytes integer;
  entity_key text;
  incoming_count integer;
  staged_count integer;
  expected_count integer;
  total_entities integer := 0;
  incoming_grade_session_links integer := 0;
  staged_grade_session_links integer := 0;
begin
  if p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= 1280
     or lower(coalesce(p_chunk_hash, '')) !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) <> 'object'
     or exists (
       select 1 from jsonb_each(p_payload) entry
       where entry.key not in ('subjects', 'goals', 'sessions', 'grades')
          or jsonb_typeof(entry.value) <> 'array'
     ) then
    raise exception using errcode = '22023', message = 'invalid_import_chunk';
  end if;

  payload_bytes := octet_length(p_payload::text);
  if payload_bytes > 262144 then
    raise exception using errcode = '22023', message = 'import_chunk_too_large';
  end if;
  foreach entity_key in array array['subjects', 'goals', 'sessions', 'grades'] loop
    incoming_count := case when p_payload ? entity_key
      then jsonb_array_length(p_payload -> entity_key) else 0 end;
    total_entities := total_entities + incoming_count;
  end loop;
  select coalesce(sum(
    case when jsonb_typeof(grade -> 'sessionIds') = 'array'
      then jsonb_array_length(grade -> 'sessionIds') else 0 end
  ), 0)::integer into incoming_grade_session_links
  from jsonb_array_elements(
    case when jsonb_typeof(p_payload -> 'grades') = 'array'
      then p_payload -> 'grades' else '[]'::jsonb end
  ) as grade_item(grade);
  perform private.cleanup_stale_imports(actor);
  select b.* into batch
  from private.import_batches b
  where b.id = p_import_id and b.user_id = actor
  for update;

  if batch.id is null then
    raise exception using errcode = '42501', message = 'import_not_found';
  end if;
  if batch.status <> 'staging' then
    raise exception using errcode = 'P0001', message = 'import_already_finalized';
  end if;

  select c.chunk_hash, c.server_payload_hash into existing_hash, existing_server_hash
  from private.import_chunks c
  where c.import_id = p_import_id and c.chunk_index = p_chunk_index;

  computed_server_hash := private.import_content_hash(p_payload);

  if existing_hash is not null and existing_hash <> lower(p_chunk_hash) then
    raise exception using errcode = 'P0001', message = 'import_chunk_conflict';
  end if;
  if existing_server_hash is not null and existing_server_hash <> computed_server_hash then
    raise exception using errcode = 'P0001', message = 'import_chunk_payload_conflict';
  end if;
  if existing_hash is not null then
    return jsonb_build_object(
      'import_id', p_import_id,
      'chunk_index', p_chunk_index,
      'accepted', true,
      'duplicate', true
    );
  end if;

  if total_entities = 0 or total_entities > 2000 then
    raise exception using errcode = '22023', message = 'invalid_import_chunk_entity_count';
  end if;

  if p_chunk_index <> batch.received_chunks then
    raise exception using errcode = '22023', message = 'import_chunk_index_not_contiguous';
  end if;
  if batch.received_chunks >= 1280
     or batch.total_payload_bytes + payload_bytes > 33554432 then
    raise exception using errcode = '22023', message = 'import_batch_quota_exceeded';
  end if;

  foreach entity_key in array array['subjects', 'goals', 'sessions', 'grades'] loop
    incoming_count := case when p_payload ? entity_key
      then jsonb_array_length(p_payload -> entity_key) else 0 end;
    select coalesce(sum(jsonb_array_length(
      case when jsonb_typeof(c.payload -> entity_key) = 'array'
        then c.payload -> entity_key else '[]'::jsonb end
    )), 0)::integer into staged_count
    from private.import_chunks c
    where c.import_id = p_import_id;
    expected_count := (batch.expected_counts ->> entity_key)::integer;
    if staged_count + incoming_count > expected_count then
      raise exception using errcode = '22023', message = 'import_manifest_count_exceeded';
    end if;
  end loop;

  expected_count := nullif(batch.expected_counts ->> 'gradeSessionLinks', '')::integer;
  if expected_count is not null then
    select coalesce(sum(
      case when jsonb_typeof(grade -> 'sessionIds') = 'array'
        then jsonb_array_length(grade -> 'sessionIds') else 0 end
    ), 0)::integer into staged_grade_session_links
    from private.import_chunks c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.payload -> 'grades') = 'array'
        then c.payload -> 'grades' else '[]'::jsonb end
    ) as grade_item(grade)
    where c.import_id = p_import_id;

    if staged_grade_session_links + incoming_grade_session_links > expected_count then
      raise exception using errcode = '22023', message = 'import_manifest_count_exceeded';
    end if;
  end if;

  perform private.consume_rate_limit(actor, 'import_stage', 1500, interval '1 day');
  insert into private.import_chunks(
    import_id, chunk_index, chunk_hash, server_payload_hash, payload
  )
  values (
    p_import_id, p_chunk_index, lower(p_chunk_hash), computed_server_hash, p_payload
  )
  ;

  update private.import_batches
  set received_chunks = received_chunks + 1,
      total_payload_bytes = total_payload_bytes + payload_bytes,
      updated_at = clock_timestamp()
  where id = p_import_id;

  return jsonb_build_object(
    'import_id', p_import_id,
    'chunk_index', p_chunk_index,
    'accepted', true,
    'duplicate', false,
    'received_chunks', batch.received_chunks + 1,
    'total_payload_bytes', batch.total_payload_bytes + payload_bytes
  );
end;
$$;

create or replace function private.collect_import_array(p_import_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(items.item order by c.chunk_index, items.ordinality), '[]'::jsonb)
  from private.import_chunks c
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(c.payload -> p_key) = 'array' then c.payload -> p_key
      else '[]'::jsonb
    end
  ) with ordinality as items(item, ordinality)
  where c.import_id = p_import_id;
$$;

create or replace function private.import_content_hash(p_value jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private.add_import_conflict(
  p_state jsonb,
  p_detail jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  details jsonb := coalesce(p_state -> 'details', '[]'::jsonb);
  total integer := coalesce((p_state ->> 'total')::integer, 0) + 1;
begin
  if jsonb_array_length(details) < 200 then
    details := details || jsonb_build_array(p_detail);
  end if;
  return jsonb_build_object('total', total, 'details', details);
end;
$$;

create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.finalize_local_import(p_import_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  batch private.import_batches%rowtype;
  subjects_payload jsonb;
  goals_payload jsonb;
  sessions_payload jsonb;
  grades_payload jsonb;
  item jsonb;
  local_id_value text;
  linked_local_session_id text;
  content_hash text;
  server_id uuid;
  candidate_uuid uuid;
  mapped_hash text;
  subject_server_id uuid;
  goal_server_id uuid;
  session_server_id uuid;
  source_value text;
  duration_value integer;
  inserted_counts jsonb := jsonb_build_object(
    'subjects', 0, 'goals', 0, 'sessions', 0, 'grades', 0,
    'gradeSessionLinks', 0
  );
  duplicate_counts jsonb := jsonb_build_object(
    'subjects', 0, 'goals', 0, 'sessions', 0, 'grades', 0,
    'gradeSessionLinks', 0
  );
  conflicts jsonb := jsonb_build_object('total', 0, 'details', '[]'::jsonb);
  expected integer;
  actual integer;
  final_result jsonb;
begin
  select * into batch
  from private.import_batches b
  where b.id = p_import_id and b.user_id = actor
  for update;

  if batch.id is null then
    raise exception using errcode = '42501', message = 'import_not_found';
  end if;
  if batch.status <> 'staging' then
    return coalesce(batch.result, jsonb_build_object('status', batch.status));
  end if;
  if not exists (select 1 from private.import_chunks c where c.import_id = p_import_id)
     and (
       coalesce((batch.expected_counts ->> 'subjects')::integer, -1) <> 0
       or coalesce((batch.expected_counts ->> 'goals')::integer, -1) <> 0
       or coalesce((batch.expected_counts ->> 'sessions')::integer, -1) <> 0
       or coalesce((batch.expected_counts ->> 'grades')::integer, -1) <> 0
     ) then
    raise exception using errcode = '22023', message = 'import_has_no_chunks';
  end if;
  if (select count(*) from private.import_chunks c where c.import_id = p_import_id)
       <> batch.received_chunks
     or exists (
       select 1
       from generate_series(0, batch.received_chunks - 1) expected_index
       where not exists (
         select 1 from private.import_chunks c
         where c.import_id = p_import_id and c.chunk_index = expected_index
       )
     ) then
    raise exception using errcode = '22023', message = 'import_chunks_incomplete';
  end if;

  subjects_payload := private.collect_import_array(p_import_id, 'subjects');
  goals_payload := private.collect_import_array(p_import_id, 'goals');
  sessions_payload := private.collect_import_array(p_import_id, 'sessions');
  grades_payload := private.collect_import_array(p_import_id, 'grades');

  foreach item in array array[
    jsonb_build_object('key', 'subjects', 'actual', jsonb_array_length(subjects_payload)),
    jsonb_build_object('key', 'goals', 'actual', jsonb_array_length(goals_payload)),
    jsonb_build_object('key', 'sessions', 'actual', jsonb_array_length(sessions_payload)),
    jsonb_build_object('key', 'grades', 'actual', jsonb_array_length(grades_payload)),
    jsonb_build_object('key', 'gradeSessionLinks', 'actual', (
      select coalesce(sum(
        case when jsonb_typeof(grade -> 'sessionIds') = 'array'
          then jsonb_array_length(grade -> 'sessionIds') else 0 end
      ), 0)::integer
      from jsonb_array_elements(grades_payload) as grade_item(grade)
    ))
  ] loop
    expected := nullif(batch.expected_counts ->> (item ->> 'key'), '')::integer;
    actual := (item ->> 'actual')::integer;
    if expected is not null and expected <> actual then
      raise exception using errcode = '22023', message = 'import_count_mismatch';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(subjects_payload) loop
    begin
    local_id_value := nullif(btrim(item ->> 'id'), '');
    if local_id_value is null then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'subject', 'local_id', null, 'reason', 'invalid_id'
      ));
      continue;
    end if;
    content_hash := private.import_content_hash(item);
    select m.server_id, m.content_hash into server_id, mapped_hash
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'subject' and m.local_id = local_id_value;
    if server_id is not null then
      if mapped_hash = content_hash then
        duplicate_counts := jsonb_set(duplicate_counts, '{subjects}',
          to_jsonb((duplicate_counts ->> 'subjects')::integer + 1));
      else
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'subject', 'local_id', local_id_value, 'reason', 'content_changed'
        ));
      end if;
      continue;
    end if;

    select s.id into server_id
    from public.subjects s
    where s.owner_id = actor
      and s.name_normalized = lower(btrim(item ->> 'name'))
      and s.deleted_at is null and s.archived_at is null
    limit 1;
    if server_id is null then
      candidate_uuid := private.try_uuid(local_id_value);
      if candidate_uuid is not null and exists (
        select 1 from public.subjects existing_subject where existing_subject.id = candidate_uuid
      ) then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'subject', 'local_id', local_id_value, 'reason', 'uuid_collision'
        ));
        continue;
      end if;
      server_id := coalesce(candidate_uuid, extensions.gen_random_uuid());
    end if;

    if not exists (select 1 from public.subjects where id = server_id) then
      insert into public.subjects(id, owner_id, name, color, icon, archived_at)
      values (
        server_id, actor, item ->> 'name', item ->> 'color', item ->> 'icon',
        case when coalesce((item ->> 'archived')::boolean, false)
          then clock_timestamp() else null end
      );
    inserted_counts := jsonb_set(inserted_counts, '{subjects}',
      to_jsonb((inserted_counts ->> 'subjects')::integer + 1));
    else
      duplicate_counts := jsonb_set(duplicate_counts, '{subjects}',
        to_jsonb((duplicate_counts ->> 'subjects')::integer + 1));
    end if;

    insert into private.local_id_map(user_id, entity_type, local_id, server_id, content_hash)
    values (actor, 'subject', local_id_value, server_id, content_hash);
    exception when others then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'subject',
        'local_id', coalesce(local_id_value, item ->> 'id', ''),
        'reason', 'database_rejected',
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  for item in select value from jsonb_array_elements(goals_payload) loop
    begin
    local_id_value := nullif(btrim(item ->> 'id'), '');
    content_hash := private.import_content_hash(item);
    select m.server_id, m.content_hash into server_id, mapped_hash
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'goal' and m.local_id = local_id_value;
    if local_id_value is null or server_id is not null then
      if server_id is not null and mapped_hash = content_hash then
        duplicate_counts := jsonb_set(duplicate_counts, '{goals}',
          to_jsonb((duplicate_counts ->> 'goals')::integer + 1));
      else
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'goal', 'local_id', local_id_value,
          'reason', case when local_id_value is null then 'invalid_id' else 'content_changed' end
        ));
      end if;
      continue;
    end if;

    select m.server_id into subject_server_id
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'subject'
      and m.local_id = coalesce(item ->> 'subjectId', item ->> 'subject_id');
    if subject_server_id is null then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'goal', 'local_id', local_id_value, 'reason', 'subject_unmapped'
      ));
      continue;
    end if;

    candidate_uuid := private.try_uuid(local_id_value);
    if candidate_uuid is not null and exists (
      select 1 from public.goals existing_goal where existing_goal.id = candidate_uuid
    ) then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'goal', 'local_id', local_id_value, 'reason', 'uuid_collision'
      ));
      continue;
    end if;
    server_id := coalesce(candidate_uuid, extensions.gen_random_uuid());
    insert into public.goals(
      id, creator_id, scope, title, target_type, target_value,
      minimum_session_seconds, source_policy, starts_at, ends_at, status,
      completed_at, archived_at
    ) values (
      server_id, actor, 'personal', nullif(btrim(item ->> 'title'), ''),
      item ->> 'type',
      case when item ->> 'type' = 'duration'
        then (item ->> 'targetMinutes')::integer * 60
        else (item ->> 'targetSessions')::integer end,
      case when item ->> 'type' = 'sessions'
        then (item ->> 'minimumSessionMinutes')::integer * 60 else null end,
      coalesce(item ->> 'sourcePolicy', 'all'),
      coalesce(nullif(item ->> 'startsAt', '')::timestamptz,
        nullif(item ->> 'createdAt', '')::timestamptz, clock_timestamp()),
      nullif(item ->> 'endsAt', '')::timestamptz,
      coalesce(item ->> 'status', 'active'),
      nullif(item ->> 'completedAt', '')::timestamptz,
      nullif(item ->> 'archivedAt', '')::timestamptz
    );
    insert into public.personal_goal_details(goal_id, owner_id, subject_id, period)
    values (server_id, actor, subject_server_id, item ->> 'period');
    insert into public.goal_participants(
      goal_id, user_id, role, status, invited_by, responded_at, accepted_at
    ) values (
      server_id, actor, 'creator', 'accepted', actor, clock_timestamp(), clock_timestamp()
    );

    if jsonb_typeof(item -> 'pausedIntervals') = 'array' then
      insert into public.goal_pause_intervals(goal_id, started_at, ended_at)
      select server_id,
        nullif(value ->> 'startedAt', '')::timestamptz,
        nullif(value ->> 'endedAt', '')::timestamptz
      from jsonb_array_elements(item -> 'pausedIntervals')
      where nullif(value ->> 'startedAt', '') is not null
        and nullif(value ->> 'endedAt', '') is not null;
    end if;
    if coalesce(item ->> 'status', 'active') = 'paused'
       and nullif(item ->> 'pausedAt', '') is not null then
      insert into public.goal_pause_intervals(goal_id, started_at)
      values (server_id, (item ->> 'pausedAt')::timestamptz)
      on conflict do nothing;
    end if;

    insert into private.local_id_map(user_id, entity_type, local_id, server_id, content_hash)
    values (actor, 'goal', local_id_value, server_id, content_hash);
    inserted_counts := jsonb_set(inserted_counts, '{goals}',
      to_jsonb((inserted_counts ->> 'goals')::integer + 1));
    exception when others then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'goal',
        'local_id', coalesce(local_id_value, item ->> 'id', ''),
        'reason', 'database_rejected',
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  for item in select value from jsonb_array_elements(sessions_payload) loop
    begin
    local_id_value := nullif(btrim(item ->> 'id'), '');
    content_hash := private.import_content_hash(item);
    select m.server_id, m.content_hash into server_id, mapped_hash
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'session' and m.local_id = local_id_value;
    if local_id_value is null or server_id is not null then
      if server_id is not null and mapped_hash = content_hash then
        duplicate_counts := jsonb_set(duplicate_counts, '{sessions}',
          to_jsonb((duplicate_counts ->> 'sessions')::integer + 1));
      else
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'session', 'local_id', local_id_value,
          'reason', case when local_id_value is null then 'invalid_id' else 'content_changed' end
        ));
      end if;
      continue;
    end if;

    select m.server_id into subject_server_id
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'subject'
      and m.local_id = coalesce(item ->> 'subjectId', item ->> 'subject_id');
    goal_server_id := null;
    if nullif(coalesce(item ->> 'goalId', item ->> 'goal_id'), '') is not null then
      select m.server_id into goal_server_id
      from private.local_id_map m
      where m.user_id = actor and m.entity_type = 'goal'
        and m.local_id = coalesce(item ->> 'goalId', item ->> 'goal_id');
      if goal_server_id is null then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'session', 'local_id', local_id_value, 'reason', 'goal_unmapped'
        ));
        continue;
      end if;
    end if;
    if subject_server_id is null then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'session', 'local_id', local_id_value, 'reason', 'subject_unmapped'
      ));
      continue;
    end if;

    source_value := item ->> 'source';
    duration_value := round(coalesce((item ->> 'durationMinutes')::numeric, 0) * 60)::integer;
    if source_value not in ('timer', 'manual') or duration_value <= 0 or duration_value > 604800 then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'session', 'local_id', local_id_value, 'reason', 'invalid_duration_or_source'
      ));
      continue;
    end if;

    if goal_server_id is not null and not exists (
      select 1
      from public.goals g
      join public.personal_goal_details pgd on pgd.goal_id = g.id
      join public.goal_participants gp
        on gp.goal_id = g.id and gp.user_id = actor and gp.status = 'accepted'
      where g.id = goal_server_id
        and g.scope = 'personal'
        and g.deleted_at is null
        and pgd.owner_id = actor
        and pgd.subject_id = subject_server_id
        and (g.source_policy = 'all' or source_value = 'timer')
        and (item ->> 'endedAt')::timestamptz > g.starts_at
        and (g.ends_at is null or (item ->> 'startedAt')::timestamptz < g.ends_at)
    ) then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'session',
        'local_id', local_id_value,
        'reason', 'invalid_goal_binding_removed',
        'local_goal_id', coalesce(item ->> 'goalId', item ->> 'goal_id')
      ));
      goal_server_id := null;
    end if;

    candidate_uuid := private.try_uuid(local_id_value);
    if candidate_uuid is not null and exists (
      select 1 from public.study_sessions existing_session where existing_session.id = candidate_uuid
    ) then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'session', 'local_id', local_id_value, 'reason', 'uuid_collision'
      ));
      continue;
    end if;
    server_id := coalesce(candidate_uuid, extensions.gen_random_uuid());
    insert into public.study_sessions(
      id, user_id, subject_id, goal_id, source, started_at, ended_at,
      duration_seconds, planned_duration_seconds, entered_at,
      subject_name_snapshot, goal_title_snapshot, legacy_note, legacy_imported,
      created_at
    ) values (
      server_id, actor, subject_server_id, goal_server_id, source_value,
      (item ->> 'startedAt')::timestamptz,
      (item ->> 'endedAt')::timestamptz,
      duration_value,
      nullif(round(coalesce((item ->> 'plannedDurationMinutes')::numeric, 0) * 60)::integer, 0),
      case when source_value = 'manual'
        then coalesce(nullif(item ->> 'enteredAt', '')::timestamptz, clock_timestamp())
        else null end,
      nullif(item ->> 'subjectNameSnapshot', ''),
      nullif(item ->> 'goalTitleSnapshot', ''),
      nullif(item ->> 'note', ''),
      true,
      coalesce(nullif(item ->> 'createdAt', '')::timestamptz, clock_timestamp())
    );

    if source_value = 'timer' and jsonb_typeof(item -> 'segments') = 'array' then
      actual := 0;
      with parsed_segments as (
        select (ordinality - 1)::smallint as ordinal,
          (value ->> 'startedAt')::timestamptz as segment_start,
          (value ->> 'endedAt')::timestamptz as segment_end
        from jsonb_array_elements(item -> 'segments') with ordinality
        where nullif(value ->> 'startedAt', '') is not null
          and nullif(value ->> 'endedAt', '') is not null
      ), checked_segments as (
        select *, max(segment_end) over (
          order by segment_start, ordinal
          rows between unbounded preceding and 1 preceding
        ) as previous_end
        from parsed_segments
      )
      insert into public.study_session_segments(
        session_id, ordinal, user_id, started_at, ended_at
      )
      select server_id, cs.ordinal, actor, cs.segment_start, cs.segment_end
      from checked_segments cs
      where not exists (
        select 1 from checked_segments invalid
        where invalid.segment_end <= invalid.segment_start
          or invalid.segment_start < (item ->> 'startedAt')::timestamptz
          or invalid.segment_end > (item ->> 'endedAt')::timestamptz
          or (invalid.previous_end is not null and invalid.segment_start < invalid.previous_end)
      )
      order by cs.ordinal;
      get diagnostics actual = row_count;

      if actual <> jsonb_array_length(item -> 'segments') then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'session_segments', 'local_id', local_id_value,
          'reason', 'invalid_segments_ignored'
        ));
      end if;
    end if;

    insert into private.local_id_map(user_id, entity_type, local_id, server_id, content_hash)
    values (actor, 'session', local_id_value, server_id, content_hash);
    inserted_counts := jsonb_set(inserted_counts, '{sessions}',
      to_jsonb((inserted_counts ->> 'sessions')::integer + 1));
    exception when others then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'session',
        'local_id', coalesce(local_id_value, item ->> 'id', ''),
        'reason', 'database_rejected',
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  for item in select value from jsonb_array_elements(grades_payload) loop
    begin
    local_id_value := nullif(btrim(item ->> 'id'), '');
    content_hash := private.import_content_hash(item);
    select m.server_id, m.content_hash into server_id, mapped_hash
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'grade' and m.local_id = local_id_value;
    if local_id_value is null or server_id is not null then
      if server_id is not null and mapped_hash = content_hash then
        duplicate_counts := jsonb_set(duplicate_counts, '{grades}',
          to_jsonb((duplicate_counts ->> 'grades')::integer + 1));
        duplicate_counts := jsonb_set(duplicate_counts, '{gradeSessionLinks}',
          to_jsonb((duplicate_counts ->> 'gradeSessionLinks')::integer + case
            when jsonb_typeof(item -> 'sessionIds') = 'array'
              then jsonb_array_length(item -> 'sessionIds')
            else 0
          end));
      else
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
          'entity_type', 'grade', 'local_id', local_id_value,
          'reason', case when local_id_value is null then 'invalid_id' else 'content_changed' end
        ));
      end if;
      continue;
    end if;

    select m.server_id into subject_server_id
    from private.local_id_map m
    where m.user_id = actor and m.entity_type = 'subject'
      and m.local_id = coalesce(item ->> 'subjectId', item ->> 'subject_id');
    if subject_server_id is null then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'grade', 'local_id', local_id_value, 'reason', 'subject_unmapped'
      ));
      continue;
    end if;

    candidate_uuid := private.try_uuid(local_id_value);
    if candidate_uuid is not null and exists (
      select 1 from public.grades existing_grade where existing_grade.id = candidate_uuid
    ) then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'grade', 'local_id', local_id_value, 'reason', 'uuid_collision'
      ));
      continue;
    end if;
    server_id := coalesce(candidate_uuid, extensions.gen_random_uuid());
    insert into public.grades(
      id, user_id, subject_id, assessment_type, title, assessment_date,
      points, additional_study_seconds, subject_name_snapshot,
      created_at, updated_at
    ) values (
      server_id, actor, subject_server_id,
      coalesce(item ->> 'assessmentType', 'other'),
      nullif(item ->> 'title', ''),
      nullif(item ->> 'assessmentDate', '')::date,
      (item ->> 'points')::smallint,
      round(coalesce((item ->> 'additionalStudyMinutes')::numeric, 0) * 60)::integer,
      nullif(item ->> 'subjectNameSnapshot', ''),
      coalesce(nullif(item ->> 'createdAt', '')::timestamptz, clock_timestamp()),
      coalesce(nullif(item ->> 'updatedAt', '')::timestamptz, clock_timestamp())
    );

    if jsonb_typeof(item -> 'sessionIds') = 'array' then
      for linked_local_session_id in
        select value from jsonb_array_elements_text(item -> 'sessionIds')
      loop
        select m.server_id into session_server_id
        from private.local_id_map m
        where m.user_id = actor and m.entity_type = 'session'
          and m.local_id = linked_local_session_id;
        if session_server_id is not null and exists (
          select 1 from public.study_sessions ss
          where ss.id = session_server_id and ss.subject_id = subject_server_id
        ) then
          insert into public.grade_sessions(grade_id, session_id, user_id, subject_id)
          values (server_id, session_server_id, actor, subject_server_id)
          on conflict do nothing;
          get diagnostics actual = row_count;
          if actual = 1 then
            inserted_counts := jsonb_set(inserted_counts, '{gradeSessionLinks}',
              to_jsonb((inserted_counts ->> 'gradeSessionLinks')::integer + 1));
          else
            duplicate_counts := jsonb_set(duplicate_counts, '{gradeSessionLinks}',
              to_jsonb((duplicate_counts ->> 'gradeSessionLinks')::integer + 1));
          end if;
        else
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
            'entity_type', 'grade_session', 'local_id', linked_local_session_id,
            'reason', 'session_unmapped'
          ));
        end if;
      end loop;
    end if;

    insert into private.local_id_map(user_id, entity_type, local_id, server_id, content_hash)
    values (actor, 'grade', item ->> 'id', server_id, content_hash);
    inserted_counts := jsonb_set(inserted_counts, '{grades}',
      to_jsonb((inserted_counts ->> 'grades')::integer + 1));
    exception when others then
      conflicts := private.add_import_conflict(conflicts, jsonb_build_object(
        'entity_type', 'grade',
        'local_id', coalesce(local_id_value, item ->> 'id', ''),
        'reason', 'database_rejected',
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  final_result := jsonb_build_object(
    'import_id', p_import_id,
    'status', case when (conflicts ->> 'total')::integer > 0
      then 'completed_with_conflicts' else 'completed' end,
    'inserted', inserted_counts,
    'duplicates', duplicate_counts,
    'conflicts', conflicts -> 'details',
    'conflict_count', (conflicts ->> 'total')::integer,
    'conflicts_truncated', (conflicts ->> 'total')::integer
      > jsonb_array_length(conflicts -> 'details'),
    'received_chunks', batch.received_chunks,
    'total_payload_bytes', batch.total_payload_bytes,
    'local_data_retained', true
  );

  update private.import_batches b
  set status = final_result ->> 'status',
      result = final_result,
      finalized_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where b.id = p_import_id;

  -- Staged payloads can contain historical notes. Once the durable report and
  -- ID mappings exist, remove the raw chunks immediately.
  delete from private.import_chunks c where c.import_id = p_import_id;

  return final_result;
end;
$$;

create or replace function public.discard_local_import(p_import_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  removed uuid;
begin
  delete from private.import_batches b
  where b.id = p_import_id and b.user_id = actor and b.status = 'staging'
  returning b.id into removed;

  if removed is null then
    raise exception using errcode = '42501', message = 'staging_import_not_found';
  end if;
  return jsonb_build_object('import_id', removed, 'discarded', true);
end;
$$;

create or replace function public.get_local_import_status(p_import_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  result jsonb;
begin
  select jsonb_build_object(
    'import_id', b.id,
    'status', b.status,
    'expected_counts', b.expected_counts,
    'received_chunks', (
      select count(*) from private.import_chunks c where c.import_id = b.id
    ),
    'accepted_chunk_indices', coalesce((
      select jsonb_agg(c.chunk_index order by c.chunk_index)
      from private.import_chunks c where c.import_id = b.id
    ), '[]'::jsonb),
    'result', b.result,
    'created_at', b.created_at,
    'finalized_at', b.finalized_at
  ) into result
  from private.import_batches b
  where b.id = p_import_id and b.user_id = actor;

  if result is null then
    raise exception using errcode = '42501', message = 'import_not_found';
  end if;
  return result;
end;
$$;

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.update_my_profile(text, text, text, text, integer) from public, anon;
revoke all on function public.update_privacy_settings(boolean, boolean, boolean, boolean, integer) from public, anon;
revoke all on function public.find_profile_by_exact_username(text) from public, anon;
revoke all on function public.pull_my_study_changes(bigint) from public, anon;
revoke all on function public.upsert_subject(jsonb, uuid) from public, anon;
revoke all on function public.soft_delete_subject(uuid, integer, uuid) from public, anon;
revoke all on function public.upsert_personal_goal(jsonb, uuid) from public, anon;
revoke all on function public.transition_personal_goal(uuid, text, timestamptz, integer, uuid) from public, anon;
revoke all on function public.soft_delete_personal_goal(uuid, integer, uuid) from public, anon;
revoke all on function public.save_completed_session(jsonb, uuid) from public, anon;
revoke all on function public.soft_delete_session(uuid, integer, uuid) from public, anon;
revoke all on function public.upsert_grade(jsonb, uuid) from public, anon;
revoke all on function public.soft_delete_grade(uuid, integer, uuid) from public, anon;
revoke all on function public.begin_local_import(text, text, jsonb) from public, anon;
revoke all on function public.stage_local_import_chunk(uuid, integer, text, jsonb) from public, anon;
revoke all on function public.finalize_local_import(uuid) from public, anon;
revoke all on function public.get_local_import_status(uuid) from public, anon;
revoke all on function public.discard_local_import(uuid) from public, anon;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text, text, text, integer) to authenticated;
grant execute on function public.update_privacy_settings(boolean, boolean, boolean, boolean, integer) to authenticated;
grant execute on function public.find_profile_by_exact_username(text) to authenticated;
grant execute on function public.pull_my_study_changes(bigint) to authenticated;
grant execute on function public.upsert_subject(jsonb, uuid) to authenticated;
grant execute on function public.soft_delete_subject(uuid, integer, uuid) to authenticated;
grant execute on function public.upsert_personal_goal(jsonb, uuid) to authenticated;
grant execute on function public.transition_personal_goal(uuid, text, timestamptz, integer, uuid) to authenticated;
grant execute on function public.soft_delete_personal_goal(uuid, integer, uuid) to authenticated;
grant execute on function public.save_completed_session(jsonb, uuid) to authenticated;
grant execute on function public.soft_delete_session(uuid, integer, uuid) to authenticated;
grant execute on function public.upsert_grade(jsonb, uuid) to authenticated;
grant execute on function public.soft_delete_grade(uuid, integer, uuid) to authenticated;
grant execute on function public.begin_local_import(text, text, jsonb) to authenticated;
grant execute on function public.stage_local_import_chunk(uuid, integer, text, jsonb) to authenticated;
grant execute on function public.finalize_local_import(uuid) to authenticated;
grant execute on function public.get_local_import_status(uuid) to authenticated;
grant execute on function public.discard_local_import(uuid) to authenticated;

commit;
