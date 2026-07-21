begin;

create or replace function private.friendship_read_model(
  p_friendship public.friendships,
  p_actor uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_friendship.id,
    'requester_id', p_friendship.requester_id,
    'addressee_id', p_friendship.addressee_id,
    'status', p_friendship.status,
    'direction', case
      when p_friendship.requester_id = p_actor then 'outgoing' else 'incoming'
    end,
    'responded_at', p_friendship.responded_at,
    'created_at', p_friendship.created_at,
    'updated_at', p_friendship.updated_at,
    'user', jsonb_build_object(
      'id', other_profile.id,
      'username', other_profile.username,
      'display_name', other_profile.display_name,
      'avatar_url', other_profile.avatar_url
    )
  )
  from public.profiles other_profile
  where other_profile.id = case
    when p_friendship.requester_id = p_actor then p_friendship.addressee_id
    else p_friendship.requester_id
  end;
$$;

create or replace function public.send_friend_request(p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  target_id uuid;
  existing public.friendships%rowtype;
  saved public.friendships%rowtype;
begin
  if exists (
    select 1 from public.profiles p where p.id = actor and p.username_needs_review
  ) then
    raise exception using errcode = 'P0001', message = 'username_review_required';
  end if;

  perform private.consume_rate_limit(actor, 'friend_request', 10, interval '1 hour');

  select p.id into target_id
  from public.profiles p
  where p.username = lower(btrim(p_username))
    and not p.username_needs_review;

  if target_id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  if target_id = actor then
    raise exception using errcode = '22023', message = 'friendship_self_forbidden';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(actor, target_id)::text || ':' || greatest(actor, target_id)::text, 0)
  );

  select f.* into existing
  from public.friendships f
  where f.pair_low = least(actor, target_id)
    and f.pair_high = greatest(actor, target_id)
    and f.deleted_at is null
    and f.status in ('pending', 'accepted')
  for update;

  if existing.id is not null then
    if existing.status = 'accepted' or existing.requester_id = actor then
      return private.friendship_read_model(existing, actor);
    end if;

    update public.friendships f
    set status = 'accepted', responded_at = clock_timestamp()
    where f.id = existing.id
    returning * into saved;
    return private.friendship_read_model(saved, actor);
  end if;

  if exists (
    select 1 from public.friendships f
    where f.pair_low = least(actor, target_id)
      and f.pair_high = greatest(actor, target_id)
      and f.status = 'declined'
      and f.responded_at > clock_timestamp() - interval '7 days'
  ) then
    raise exception using errcode = 'P0001', message = 'friend_request_cooldown';
  end if;

  insert into public.friendships(requester_id, addressee_id)
  values (actor, target_id)
  returning * into saved;
  return private.friendship_read_model(saved, actor);
end;
$$;

create or replace function public.accept_friend_request(p_friendship_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.friendships%rowtype;
begin
  update public.friendships f
  set status = 'accepted', responded_at = clock_timestamp()
  where f.id = p_friendship_id
    and f.addressee_id = actor
    and f.status = 'pending'
    and f.deleted_at is null
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = '42501', message = 'friend_request_not_actionable';
  end if;
  return private.friendship_read_model(saved, actor);
end;
$$;

create or replace function public.decline_friend_request(p_friendship_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.friendships%rowtype;
begin
  update public.friendships f
  set status = 'declined', responded_at = clock_timestamp()
  where f.id = p_friendship_id
    and f.addressee_id = actor
    and f.status = 'pending'
    and f.deleted_at is null
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = '42501', message = 'friend_request_not_actionable';
  end if;
  return private.friendship_read_model(saved, actor);
end;
$$;

create or replace function public.remove_friendship(p_friendship_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.friendships%rowtype;
begin
  update public.friendships f
  set deleted_at = clock_timestamp()
  where f.id = p_friendship_id
    and (f.requester_id = actor or f.addressee_id = actor)
    and f.status = 'accepted'
    and f.deleted_at is null
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = '42501', message = 'friendship_not_removable';
  end if;
  return private.friendship_read_model(saved, actor);
end;
$$;

create or replace function public.list_friend_connections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'connections', coalesce((
      select jsonb_agg(private.friendship_read_model(f, actor) order by f.updated_at desc)
      from public.friendships f
      where (f.requester_id = actor or f.addressee_id = actor)
        and f.deleted_at is null
        and f.status in ('pending', 'accepted')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.session_contribution_seconds(
  p_session_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with session_row as (
    select ss.* from public.study_sessions ss
    where ss.id = p_session_id and ss.deleted_at is null
  ), active_intervals as (
    select seg.started_at, seg.ended_at
    from public.study_session_segments seg
    join session_row ss on ss.id = seg.session_id
    union all
    select ss.started_at, ss.ended_at
    from session_row ss
    where not exists (
      select 1 from public.study_session_segments seg where seg.session_id = ss.id
    )
  ), interval_totals as (
    select
      sum(extract(epoch from (ended_at - started_at))) as active_seconds,
      sum(greatest(0, extract(epoch from (
        least(ended_at, p_range_end) - greatest(started_at, p_range_start)
      )))) filter (
        where ended_at > p_range_start and started_at < p_range_end
      ) as overlap_seconds
    from active_intervals
  )
  select case
    when coalesce(t.active_seconds, 0) <= 0 then 0
    else ss.duration_seconds::numeric
      * coalesce(t.overlap_seconds, 0)::numeric / t.active_seconds::numeric
  end
  from session_row ss cross join interval_totals t;
$$;

create or replace function private.current_streak_days(p_user_id uuid, p_time_zone text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with local_days as (
    select (ss.started_at at time zone p_time_zone)::date as day,
      sum(ss.duration_seconds) as seconds
    from public.study_sessions ss
    where ss.user_id = p_user_id
      and ss.deleted_at is null
      and ss.started_at <= clock_timestamp()
    group by 1
    having sum(ss.duration_seconds) >= 60
  ), anchor as (
    select case when exists (
      select 1 from local_days
      where day = (clock_timestamp() at time zone p_time_zone)::date
    ) then (clock_timestamp() at time zone p_time_zone)::date
    else (clock_timestamp() at time zone p_time_zone)::date - 1 end as day
  ), ranked as (
    select ld.day, row_number() over (order by ld.day desc) as position
    from local_days ld, anchor a
    where ld.day <= a.day
  )
  select count(*)::integer
  from ranked r, anchor a
  where r.day = a.day - (r.position::integer - 1);
$$;

create or replace function private.personal_goal_session_contribution_seconds(
  p_goal_id uuid,
  p_session_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    0,
    private.session_contribution_seconds(p_session_id, p_range_start, p_range_end)
    - coalesce((
      select sum(private.session_contribution_seconds(
        p_session_id,
        greatest(pause.started_at, p_range_start),
        least(coalesce(pause.ended_at, p_range_end), p_range_end)
      ))
      from public.goal_pause_intervals pause
      where pause.goal_id = p_goal_id
        and pause.started_at < p_range_end
        and coalesce(pause.ended_at, p_range_end) > p_range_start
    ), 0)
  );
$$;

create or replace function private.has_reached_personal_goal(p_user_id uuid, p_time_zone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with candidate_goals as (
    select g.*,
      case pgd.period
        when 'day' then date_trunc('day', clock_timestamp() at time zone p_time_zone) at time zone p_time_zone
        when 'week' then date_trunc('week', clock_timestamp() at time zone p_time_zone) at time zone p_time_zone
        when 'month' then date_trunc('month', clock_timestamp() at time zone p_time_zone) at time zone p_time_zone
        when 'year' then date_trunc('year', clock_timestamp() at time zone p_time_zone) at time zone p_time_zone
        else g.starts_at
      end as period_start,
      case pgd.period
        when 'day' then (date_trunc('day', clock_timestamp() at time zone p_time_zone) + interval '1 day') at time zone p_time_zone
        when 'week' then (date_trunc('week', clock_timestamp() at time zone p_time_zone) + interval '1 week') at time zone p_time_zone
        when 'month' then (date_trunc('month', clock_timestamp() at time zone p_time_zone) + interval '1 month') at time zone p_time_zone
        when 'year' then (date_trunc('year', clock_timestamp() at time zone p_time_zone) + interval '1 year') at time zone p_time_zone
        else coalesce(g.ends_at, clock_timestamp() + interval '1 microsecond')
      end as period_end
    from public.goals g
    join public.personal_goal_details pgd on pgd.goal_id = g.id
    where pgd.owner_id = p_user_id
      and g.deleted_at is null
      and g.status in ('active', 'completed')
  ), values_by_goal as (
    select cg.id, cg.target_type, cg.target_value,
      case when cg.target_type = 'duration' then coalesce((
        select sum(private.personal_goal_session_contribution_seconds(
          cg.id,
          ss.id,
          greatest(cg.period_start, cg.starts_at),
          least(cg.period_end, coalesce(cg.ends_at, cg.period_end), clock_timestamp())
        ))
        from public.study_sessions ss
        where ss.goal_id = cg.id and ss.user_id = p_user_id
          and ss.deleted_at is null
          and (cg.source_policy = 'all' or ss.source = 'timer')
      ), 0)
      else coalesce((
        select count(*)::numeric
        from public.study_sessions ss
        where ss.goal_id = cg.id and ss.user_id = p_user_id
          and ss.deleted_at is null
          and ss.started_at >= greatest(cg.period_start, cg.starts_at)
          and ss.started_at < least(cg.period_end, coalesce(cg.ends_at, cg.period_end), clock_timestamp())
          and ss.duration_seconds >= cg.minimum_session_seconds
          and (cg.source_policy = 'all' or ss.source = 'timer')
          and not exists (
            select 1 from public.goal_pause_intervals pause
            where pause.goal_id = cg.id
              and ss.started_at >= pause.started_at
              and ss.started_at < coalesce(pause.ended_at, clock_timestamp())
          )
      ), 0) end as current_value
    from candidate_goals cg
  )
  select exists (
    select 1 from values_by_goal v where v.current_value >= v.target_value
  );
$$;

create or replace function public.get_friend_profile_stats(p_friend_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  friend_profile public.profiles%rowtype;
  privacy public.privacy_settings%rowtype;
  local_now timestamp;
  periods jsonb;
begin
  if not private.are_friends(actor, p_friend_id) then
    raise exception using errcode = '42501', message = 'friendship_required';
  end if;

  select * into friend_profile from public.profiles p where p.id = p_friend_id;
  select * into privacy from public.privacy_settings ps where ps.user_id = p_friend_id;
  local_now := clock_timestamp() at time zone friend_profile.time_zone;

  with period_bounds(key, local_start, local_end, ordering) as (
    values
      ('today', date_trunc('day', local_now), date_trunc('day', local_now) + interval '1 day', 1),
      ('yesterday', date_trunc('day', local_now) - interval '1 day', date_trunc('day', local_now), 2),
      ('this_week', date_trunc('week', local_now), date_trunc('week', local_now) + interval '1 week', 3),
      ('last_week', date_trunc('week', local_now) - interval '1 week', date_trunc('week', local_now), 4),
      ('this_month', date_trunc('month', local_now), date_trunc('month', local_now) + interval '1 month', 5),
      ('last_month', date_trunc('month', local_now) - interval '1 month', date_trunc('month', local_now), 6)
  ), utc_bounds as (
    select key,
      local_start at time zone friend_profile.time_zone as starts_at,
      local_end at time zone friend_profile.time_zone as ends_at,
      ordering
    from period_bounds
  ), raw_stats as (
    select b.key, b.starts_at, b.ends_at, b.ordering,
      coalesce(sum(private.session_contribution_seconds(ss.id, b.starts_at, b.ends_at))
        filter (where ss.source = 'timer'), 0) as timer_seconds,
      count(ss.id) filter (
        where ss.source = 'timer' and ss.started_at >= b.starts_at and ss.started_at < b.ends_at
      ) as timer_count,
      coalesce(sum(private.session_contribution_seconds(ss.id, b.starts_at, b.ends_at))
        filter (where ss.source = 'manual'), 0) as manual_seconds,
      count(ss.id) filter (
        where ss.source = 'manual' and ss.started_at >= b.starts_at and ss.started_at < b.ends_at
      ) as manual_count
    from utc_bounds b
    left join public.study_sessions ss
      on ss.user_id = p_friend_id
      and ss.deleted_at is null
      and ss.ended_at > b.starts_at
      and ss.started_at < b.ends_at
    group by b.key, b.starts_at, b.ends_at, b.ordering
  )
  select jsonb_agg(jsonb_build_object(
    'key', key,
    'starts_at', starts_at,
    'ends_at', ends_at,
    'timer_minutes', case when privacy.share_timer_stats
      then round(timer_seconds / 60.0, 1) else null end,
    'timer_session_count', case when privacy.share_timer_stats
      then timer_count else null end,
    'manual_minutes', case when privacy.share_manual_stats
      then round(manual_seconds / 60.0, 1) else null end,
    'manual_session_count', case when privacy.share_manual_stats
      then manual_count else null end,
    'total_minutes', case when privacy.share_timer_stats and privacy.share_manual_stats
      then round((timer_seconds + manual_seconds) / 60.0, 1) else null end,
    'total_session_count', case when privacy.share_timer_stats and privacy.share_manual_stats
      then timer_count + manual_count else null end
  ) order by ordering) into periods
  from raw_stats;

  return jsonb_build_object(
    'friend', jsonb_build_object(
      'id', friend_profile.id,
      'username', friend_profile.username,
      'display_name', friend_profile.display_name,
      'avatar_url', friend_profile.avatar_url,
      'time_zone', friend_profile.time_zone,
      'revision', friend_profile.revision
    ),
    'permissions', jsonb_build_object(
      'timer', privacy.share_timer_stats,
      'manual', privacy.share_manual_stats,
      'goal_progress', privacy.share_goal_progress,
      'streak', privacy.share_streak
    ),
    'periods', coalesce(periods, '[]'::jsonb),
    'streak_days', case when privacy.share_streak
      then private.current_streak_days(p_friend_id, friend_profile.time_zone) else null end,
    'goal_reached', case when privacy.share_goal_progress
      then private.has_reached_personal_goal(p_friend_id, friend_profile.time_zone) else null end
  );
end;
$$;

create or replace function private.shared_goal_read_model(p_goal_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_goal_participant(p_goal_id, p_actor, false) then
    raise exception using errcode = '42501', message = 'goal_invitation_required';
  end if;

  select jsonb_build_object(
    'goal', to_jsonb(g) || jsonb_build_object(
      'effective_status', case
        when g.status = 'active' and g.ends_at is not null
          and g.ends_at <= clock_timestamp() then 'expired'
        else g.status
      end,
      'expired', g.ends_at is not null and g.ends_at <= clock_timestamp()
    ),
    'details', to_jsonb(sgd),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', gp.user_id,
        'role', gp.role,
        'status', gp.status,
        'invited_at', gp.invited_at,
        'responded_at', gp.responded_at,
        'withdrawn_at', gp.withdrawn_at,
        'user', jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'avatar_url', p.avatar_url
        )
      ) order by gp.role, gp.invited_at)
      from public.goal_participants gp
      join public.profiles p on p.id = gp.user_id
      where gp.goal_id = g.id
    ), '[]'::jsonb)
  ) into result
  from public.goals g
  join public.shared_goal_details sgd on sgd.goal_id = g.id
  where g.id = p_goal_id and g.scope = 'shared' and g.deleted_at is null;

  if result is null then
    raise exception using errcode = 'P0001', message = 'shared_goal_not_found';
  end if;
  return result;
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
  entity_id uuid := coalesce(nullif(p_goal ->> 'id', '')::uuid, extensions.gen_random_uuid());
  target_type_value text := p_goal ->> 'type';
  mode_value text := p_goal ->> 'mode';
  period_value text := p_goal ->> 'period';
  source_policy_value text := coalesce(p_goal ->> 'source_policy', p_goal ->> 'sourcePolicy', 'all');
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
  if coalesce(array_length(p_invitee_ids, 1), 0) < 1
     or coalesce(array_length(p_invitee_ids, 1), 0) > 20
     or actor = any(p_invitee_ids) then
    raise exception using errcode = '22023', message = 'invalid_invitees';
  end if;
  if (select count(distinct value) from unnest(p_invitee_ids) value)
     <> array_length(p_invitee_ids, 1) then
    raise exception using errcode = '22023', message = 'duplicate_invitees';
  end if;

  foreach invitee in array p_invitee_ids loop
    if not private.are_friends(actor, invitee) then
      raise exception using errcode = '42501', message = 'invitee_must_be_friend';
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

  select p.time_zone into time_zone_value from public.profiles p where p.id = actor;
  local_now := clock_timestamp() at time zone time_zone_value;
  if period_value = 'day' then
    starts_at_value := date_trunc('day', local_now) at time zone time_zone_value;
    ends_at_value := (date_trunc('day', local_now) + interval '1 day') at time zone time_zone_value;
  elsif period_value = 'week' then
    starts_at_value := date_trunc('week', local_now) at time zone time_zone_value;
    ends_at_value := (date_trunc('week', local_now) + interval '1 week') at time zone time_zone_value;
  elsif period_value = 'month' then
    starts_at_value := date_trunc('month', local_now) at time zone time_zone_value;
    ends_at_value := (date_trunc('month', local_now) + interval '1 month') at time zone time_zone_value;
  elsif period_value = 'year' then
    starts_at_value := date_trunc('year', local_now) at time zone time_zone_value;
    ends_at_value := (date_trunc('year', local_now) + interval '1 year') at time zone time_zone_value;
  elsif period_value = 'custom' then
    starts_at_value := nullif(coalesce(p_goal ->> 'starts_at', p_goal ->> 'startsAt'), '')::timestamptz;
    ends_at_value := nullif(coalesce(p_goal ->> 'ends_at', p_goal ->> 'endsAt'), '')::timestamptz;
  else
    raise exception using errcode = '22023', message = 'invalid_goal_period';
  end if;

  insert into public.goals(
    id, creator_id, scope, title, target_type, target_value,
    minimum_session_seconds, source_policy, starts_at, ends_at, status
  ) values (
    entity_id, actor, 'shared', nullif(btrim(p_goal ->> 'title'), ''),
    target_type_value, target_value_number, minimum_seconds_value,
    source_policy_value, starts_at_value, ends_at_value, 'active'
  );
  insert into public.shared_goal_details(goal_id, description, mode, period)
  values (
    entity_id, coalesce(p_goal ->> 'description', ''), mode_value, period_value
  );
  insert into public.goal_participants(
    goal_id, user_id, role, status, invited_by, responded_at, accepted_at
  ) values (
    entity_id, actor, 'creator', 'accepted', actor, clock_timestamp(), clock_timestamp()
  );
  insert into public.goal_participants(goal_id, user_id, role, status, invited_by)
  select entity_id, value, 'member', 'invited', actor from unnest(p_invitee_ids) value;

  result := private.shared_goal_read_model(entity_id, actor);
  return private.write_mutation_receipt(actor, p_operation_id, 'create_shared_goal', result);
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
begin
  select g.creator_id into creator
  from public.goals g
  join public.goal_participants gp on gp.goal_id = g.id
  where g.id = p_goal_id and g.scope = 'shared'
    and g.deleted_at is null and gp.user_id = actor
    and gp.role = 'member' and gp.status = 'invited'
  for update of gp;

  if creator is null then
    raise exception using errcode = '42501', message = 'goal_invitation_not_actionable';
  end if;
  if p_accept and not private.are_friends(actor, creator) then
    raise exception using errcode = '42501', message = 'friendship_required';
  end if;

  update public.goal_participants gp
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = clock_timestamp(),
      accepted_at = case when p_accept then clock_timestamp() else null end
  where gp.goal_id = p_goal_id and gp.user_id = actor;

  return private.shared_goal_read_model(p_goal_id, actor);
end;
$$;

create or replace function public.withdraw_from_shared_goal(p_goal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
begin
  update public.goal_participants gp
  set status = 'withdrawn', withdrawn_at = clock_timestamp(), responded_at = clock_timestamp()
  where gp.goal_id = p_goal_id and gp.user_id = actor
    and gp.role = 'member' and gp.status = 'accepted';

  if not found then
    raise exception using errcode = '42501', message = 'goal_not_withdrawable';
  end if;
  return private.shared_goal_read_model(p_goal_id, actor);
end;
$$;

create or replace function public.get_shared_goal_details(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return private.shared_goal_read_model(p_goal_id, actor);
end;
$$;

create or replace function private.my_shared_goals_read_model(p_actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    private.shared_goal_read_model(gp.goal_id, p_actor)
    order by g.starts_at desc
  ), '[]'::jsonb)
  from public.goal_participants gp
  join public.goals g on g.id = gp.goal_id
  where gp.user_id = p_actor and g.scope = 'shared' and g.deleted_at is null;
$$;

create or replace function public.list_shared_goals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object('shared_goals', private.my_shared_goals_read_model(actor));
end;
$$;

create or replace function public.get_shared_goal_progress(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  shared_goal public.goals%rowtype;
  shared_details public.shared_goal_details%rowtype;
  participants jsonb;
  team_contribution numeric;
  target_display numeric;
begin
  if not private.is_goal_participant(p_goal_id, actor, true) then
    raise exception using errcode = '42501', message = 'accepted_participation_required';
  end if;

  select g.* into shared_goal
  from public.goals g
  where g.id = p_goal_id and g.scope = 'shared' and g.deleted_at is null;
  select * into shared_details
  from public.shared_goal_details sgd where sgd.goal_id = p_goal_id;

  if shared_goal.id is null then
    raise exception using errcode = 'P0001', message = 'shared_goal_not_found';
  end if;
  target_display := case when shared_goal.target_type = 'duration'
    then shared_goal.target_value / 60.0 else shared_goal.target_value end;

  with participant_values as (
    select gp.user_id, gp.status, gp.role, gp.withdrawn_at,
      p.username, p.display_name, p.avatar_url,
      case when shared_goal.target_type = 'duration' then coalesce((
        select sum(private.session_contribution_seconds(
          ss.id,
          shared_goal.starts_at,
          least(
            coalesce(shared_goal.ends_at, clock_timestamp()),
            coalesce(gp.withdrawn_at, clock_timestamp()),
            clock_timestamp()
          )
        )) / 60.0
        from public.study_sessions ss
        where ss.goal_id = p_goal_id and ss.user_id = gp.user_id
          and ss.deleted_at is null
          and (shared_goal.source_policy = 'all' or ss.source = 'timer')
      ), 0)
      else coalesce((
        select count(*)::numeric
        from public.study_sessions ss
        where ss.goal_id = p_goal_id and ss.user_id = gp.user_id
          and ss.deleted_at is null
          and ss.started_at >= shared_goal.starts_at
          and ss.started_at < least(
            coalesce(shared_goal.ends_at, clock_timestamp()),
            coalesce(gp.withdrawn_at, clock_timestamp()),
            clock_timestamp()
          )
          and ss.duration_seconds >= shared_goal.minimum_session_seconds
          and (shared_goal.source_policy = 'all' or ss.source = 'timer')
      ), 0) end as contribution
    from public.goal_participants gp
    join public.profiles p on p.id = gp.user_id
    where gp.goal_id = p_goal_id and gp.status in ('accepted', 'withdrawn')
  )
  select
    coalesce(sum(pv.contribution), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', pv.user_id,
      'status', pv.status,
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
    'source_policy', shared_goal.source_policy,
    'starts_at', shared_goal.starts_at,
    'ends_at', shared_goal.ends_at,
    'revision', shared_goal.revision,
    'calculated_at', clock_timestamp(),
    'target', round(target_display, 1),
    'unit', case when shared_goal.target_type = 'duration' then 'minutes' else 'sessions' end,
    'participants', participants,
    'team', case when shared_details.mode = 'shared' then jsonb_build_object(
      'contribution', round(team_contribution, 1),
      'progress_percent', round(team_contribution / target_display * 100, 1),
      'remaining', round(greatest(0, target_display - team_contribution), 1),
      'achieved', team_contribution >= target_display,
      'excess', round(greatest(0, team_contribution - target_display), 1)
    ) else null end
  );
end;
$$;

create or replace function private.broadcast_shared_goal_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_goal uuid;
  affected_revision integer;
begin
  affected_goal := case when tg_op = 'DELETE' then old.goal_id else new.goal_id end;
  if affected_goal is null or not exists (
    select 1 from public.goals g where g.id = affected_goal and g.scope = 'shared'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select g.revision into affected_revision from public.goals g where g.id = affected_goal;
  perform realtime.send(
    jsonb_build_object('goal_id', affected_goal, 'revision', affected_revision),
    'progress_invalidated',
    'shared-goal:' || affected_goal::text,
    true
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger study_sessions_broadcast_shared_goal
after insert or update or delete on public.study_sessions
for each row execute function private.broadcast_shared_goal_invalidation();

create trigger goal_participants_broadcast_shared_goal
after insert or update or delete on public.goal_participants
for each row execute function private.broadcast_shared_goal_invalidation();

create or replace function private.broadcast_shared_goal_update()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.scope = 'shared' then
    perform realtime.send(
      jsonb_build_object('goal_id', new.id, 'revision', new.revision),
      'progress_invalidated',
      'shared-goal:' || new.id::text,
      true
    );
  end if;
  return new;
end;
$$;

create trigger goals_broadcast_shared_goal
after update on public.goals
for each row execute function private.broadcast_shared_goal_update();

create policy shared_goal_participants_can_receive
on realtime.messages for select to authenticated
using (
  exists (
    select 1
    from public.goal_participants gp
    where gp.goal_id = case
        when realtime.topic() ~ '^shared-goal:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(realtime.topic(), ':', 2)::uuid
        else null
      end
      and gp.user_id = auth.uid()
      and gp.status = 'accepted'
  )
);

revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.accept_friend_request(uuid) from public, anon;
revoke all on function public.decline_friend_request(uuid) from public, anon;
revoke all on function public.remove_friendship(uuid) from public, anon;
revoke all on function public.list_friend_connections() from public, anon;
revoke all on function public.get_friend_profile_stats(uuid) from public, anon;
revoke all on function public.create_shared_goal(jsonb, uuid[], uuid) from public, anon;
revoke all on function public.respond_shared_goal_invitation(uuid, boolean) from public, anon;
revoke all on function public.withdraw_from_shared_goal(uuid) from public, anon;
revoke all on function public.get_shared_goal_details(uuid) from public, anon;
revoke all on function public.list_shared_goals() from public, anon;
revoke all on function public.get_shared_goal_progress(uuid) from public, anon;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.list_friend_connections() to authenticated;
grant execute on function public.get_friend_profile_stats(uuid) to authenticated;
grant execute on function public.create_shared_goal(jsonb, uuid[], uuid) to authenticated;
grant execute on function public.respond_shared_goal_invitation(uuid, boolean) to authenticated;
grant execute on function public.withdraw_from_shared_goal(uuid) to authenticated;
grant execute on function public.get_shared_goal_details(uuid) to authenticated;
grant execute on function public.list_shared_goals() to authenticated;
grant execute on function public.get_shared_goal_progress(uuid) to authenticated;

commit;
