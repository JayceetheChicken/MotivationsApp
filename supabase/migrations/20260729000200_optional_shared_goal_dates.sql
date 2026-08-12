-- Shared goals start immediately when no start is supplied and can run without an end date.

create or replace function private.shared_goal_read_model(p_goal_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  goal_row public.goals%rowtype;
  details_row public.shared_goal_details%rowtype;
  participant public.goal_participants%rowtype;
  goal_projection jsonb;
  details_projection jsonb;
begin
  select * into goal_row
  from public.goals g
  where g.id = p_goal_id and g.scope = 'shared' and g.deleted_at is null;
  select * into details_row
  from public.shared_goal_details sgd
  where sgd.goal_id = p_goal_id;
  select * into participant
  from public.goal_participants gp
  where gp.goal_id = p_goal_id and gp.user_id = p_actor;

  if goal_row.id is null or details_row.goal_id is null then
    raise exception using errcode = 'P0001', message = 'shared_goal_not_found';
  end if;
  if participant.user_id is null or participant.status in ('declined', 'withdrawn') then
    raise exception using errcode = '42501', message = 'accepted_or_invited_participation_required';
  end if;

  goal_projection := jsonb_build_object(
    'id', goal_row.id,
    'creator_id', goal_row.creator_id,
    'title', goal_row.title,
    'target_type', goal_row.target_type,
    'target_value', goal_row.target_value,
    'minimum_session_seconds', goal_row.minimum_session_seconds,
    'source_policy', goal_row.source_policy,
    'starts_at', goal_row.starts_at,
    'ends_at', goal_row.ends_at,
    'status', goal_row.status,
    'revision', goal_row.revision,
    'effective_status', case
      when goal_row.status = 'active'
        and goal_row.ends_at is not null
        and goal_row.ends_at <= clock_timestamp() then 'expired'
      else goal_row.status
    end,
    'expired', coalesce(goal_row.ends_at <= clock_timestamp(), false)
  );
  details_projection := jsonb_build_object(
    'description', details_row.description,
    'mode', details_row.mode,
    'period', details_row.period,
    'cadence', details_row.cadence,
    'group_id', details_row.group_id
  );

  if participant.status = 'invited' then
    return jsonb_build_object(
      'goal', goal_projection,
      'details', details_projection,
      'creator', private.basic_social_profile(goal_row.creator_id),
      'self_participation', jsonb_build_object(
        'user_id', participant.user_id,
        'role', participant.role,
        'status', participant.status,
        'invited_at', participant.invited_at
      )
    );
  end if;

  return jsonb_build_object(
    'goal', goal_projection,
    'details', details_projection,
    'creator', private.basic_social_profile(goal_row.creator_id),
    'self_participation', jsonb_build_object(
      'user_id', participant.user_id,
      'role', participant.role,
      'status', participant.status,
      'accepted_at', participant.accepted_at
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', gp.user_id,
        'role', gp.role,
        'status', gp.status,
        'user', private.basic_social_profile(gp.user_id)
      ) order by gp.role, gp.accepted_at, gp.user_id)
      from public.goal_participants gp
      where gp.goal_id = p_goal_id and gp.status = 'accepted'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_shared_goal(
  p_goal jsonb,
  p_invitee_ids uuid[],
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
  entity_id uuid := coalesce(
    nullif(p_goal ->> 'id', '')::uuid,
    extensions.gen_random_uuid()
  );
  target_type_value text := p_goal ->> 'type';
  mode_value text := p_goal ->> 'mode';
  period_value text := p_goal ->> 'period';
  cadence_value text := coalesce(
    nullif(p_goal ->> 'cadence', ''),
    case when p_goal ->> 'period' = 'day' then 'daily' else 'weekly' end
  );
  group_id_value uuid := nullif(p_goal ->> 'group_id', '')::uuid;
  source_policy_value text := coalesce(
    p_goal ->> 'source_policy', p_goal ->> 'sourcePolicy', 'all'
  );
  target_value_number integer;
  minimum_seconds_value integer;
  local_now timestamp;
  time_zone_value text;
  starts_at_value timestamptz;
  ends_at_value timestamptz;
  invitee uuid;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'create_shared_goal');
  if result is not null then return result; end if;

  if nullif(btrim(p_goal ->> 'title'), '') is null then
    raise exception using errcode = '22023', message = 'shared_goal_title_required';
  end if;
  if cadence_value not in ('daily', 'weekly') then
    raise exception using errcode = '22023', message = 'invalid_goal_cadence';
  end if;
  if coalesce(array_length(p_invitee_ids, 1), 0) < 1
     or coalesce(array_length(p_invitee_ids, 1), 0) > 20
     or actor = any(p_invitee_ids) then
    raise exception using errcode = '22023', message = 'invalid_invitees';
  end if;
  if (select count(distinct value) from unnest(p_invitee_ids) value)
     <> array_length(p_invitee_ids, 1) then
    raise exception using errcode = '22023', message = 'duplicate_invitees';
  end if;

  perform private.consume_rate_limit(
    actor, 'create_shared_goal', 20, interval '1 hour'
  );

  if group_id_value is not null
     and not private.is_study_group_member(group_id_value, actor, true) then
    raise exception using errcode = '42501', message = 'accepted_group_membership_required';
  end if;
  foreach invitee in array p_invitee_ids loop
    if group_id_value is null then
      if not private.are_friends(actor, invitee) then
        raise exception using errcode = '42501', message = 'invitee_must_be_friend';
      end if;
    elsif not private.is_study_group_member(group_id_value, invitee, true) then
      raise exception using errcode = '42501', message = 'invitee_must_be_group_member';
    end if;
  end loop;

  if target_type_value = 'duration' then
    target_value_number := coalesce(
      (p_goal ->> 'target_value')::integer,
      (p_goal ->> 'target_minutes')::integer * 60,
      (p_goal ->> 'targetMinutes')::integer * 60
    );
    minimum_seconds_value := null;
  elsif target_type_value = 'sessions' then
    target_value_number := coalesce(
      (p_goal ->> 'target_value')::integer,
      (p_goal ->> 'target_sessions')::integer,
      (p_goal ->> 'targetSessions')::integer
    );
    minimum_seconds_value := coalesce(
      (p_goal ->> 'minimum_session_seconds')::integer,
      (p_goal ->> 'minimum_session_minutes')::integer * 60,
      (p_goal ->> 'minimumSessionMinutes')::integer * 60
    );
  else
    raise exception using errcode = '22023', message = 'invalid_goal_type';
  end if;
  if target_value_number is null or target_value_number <= 0
     or (target_type_value = 'sessions' and minimum_seconds_value is null) then
    raise exception using errcode = '22023', message = 'invalid_goal_target';
  end if;

  select p.time_zone into time_zone_value
  from public.profiles p where p.id = actor;
  local_now := clock_timestamp() at time zone time_zone_value;
  if period_value = 'day' then
    starts_at_value := date_trunc('day', local_now) at time zone time_zone_value;
    ends_at_value := (
      date_trunc('day', local_now) + interval '1 day'
    ) at time zone time_zone_value;
  elsif period_value = 'week' then
    starts_at_value := date_trunc('week', local_now) at time zone time_zone_value;
    ends_at_value := (
      date_trunc('week', local_now) + interval '1 week'
    ) at time zone time_zone_value;
  elsif period_value = 'month' then
    starts_at_value := date_trunc('month', local_now) at time zone time_zone_value;
    ends_at_value := (
      date_trunc('month', local_now) + interval '1 month'
    ) at time zone time_zone_value;
  elsif period_value = 'year' then
    starts_at_value := date_trunc('year', local_now) at time zone time_zone_value;
    ends_at_value := (
      date_trunc('year', local_now) + interval '1 year'
    ) at time zone time_zone_value;
  elsif period_value = 'custom' then
    starts_at_value := coalesce(
      nullif(coalesce(p_goal ->> 'starts_at', p_goal ->> 'startsAt'), '')::timestamptz,
      clock_timestamp()
    );
    ends_at_value := nullif(
      coalesce(p_goal ->> 'ends_at', p_goal ->> 'endsAt'), ''
    )::timestamptz;
  else
    raise exception using errcode = '22023', message = 'invalid_goal_period';
  end if;
  if ends_at_value is not null and ends_at_value <= starts_at_value then
    raise exception using errcode = '22023', message = 'invalid_goal_window';
  end if;

  insert into public.goals(
    id, creator_id, scope, title, target_type, target_value,
    minimum_session_seconds, source_policy, starts_at, ends_at, status
  ) values (
    entity_id, actor, 'shared', nullif(btrim(p_goal ->> 'title'), ''),
    target_type_value, target_value_number, minimum_seconds_value,
    source_policy_value, starts_at_value, ends_at_value, 'active'
  );
  insert into public.shared_goal_details(
    goal_id, description, mode, period, cadence, group_id
  ) values (
    entity_id,
    coalesce(p_goal ->> 'description', ''),
    mode_value,
    period_value,
    cadence_value,
    group_id_value
  );
  insert into public.goal_participants(
    goal_id, user_id, role, status, invited_by, responded_at, accepted_at
  ) values (
    entity_id, actor, 'creator', 'accepted', actor, clock_timestamp(), clock_timestamp()
  );
  insert into public.goal_participants(goal_id, user_id, role, status, invited_by)
  select entity_id, value, 'member', 'invited', actor
  from unnest(p_invitee_ids) value;

  result := private.shared_goal_read_model(entity_id, actor);
  return private.write_mutation_receipt(
    actor, p_operation_id, 'create_shared_goal', result
  );
end;
$$;

create or replace function public.respond_shared_goal_invitation(
  p_goal_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  creator uuid;
  group_id_value uuid;
begin
  if p_accept is null then
    raise exception using errcode = '22023', message = 'invitation_response_required';
  end if;

  select g.creator_id, sgd.group_id into creator, group_id_value
  from public.goals g
  join public.shared_goal_details sgd on sgd.goal_id = g.id
  join public.goal_participants gp on gp.goal_id = g.id
  where g.id = p_goal_id and g.scope = 'shared'
    and g.status = 'active'
    and (g.ends_at is null or g.ends_at > clock_timestamp())
    and g.deleted_at is null and gp.user_id = actor
    and gp.role = 'member' and gp.status = 'invited'
  for update of gp;

  if creator is null then
    raise exception using errcode = '42501', message = 'goal_invitation_not_actionable';
  end if;
  if p_accept then
    if group_id_value is null then
      if not private.are_friends(actor, creator) then
        raise exception using errcode = '42501', message = 'friendship_required';
      end if;
    elsif not private.is_study_group_member(group_id_value, actor, true) then
      raise exception using errcode = '42501', message = 'accepted_group_membership_required';
    end if;
  end if;

  update public.goal_participants gp
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = clock_timestamp(),
      accepted_at = case when p_accept then clock_timestamp() else null end
  where gp.goal_id = p_goal_id and gp.user_id = actor;

  if p_accept then
    return private.shared_goal_read_model(p_goal_id, actor);
  end if;
  return jsonb_build_object('goal_id', p_goal_id, 'status', 'declined');
end;
$$;

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
    select gp.user_id, gp.role,
      p.username, p.display_name, p.avatar_url,
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
