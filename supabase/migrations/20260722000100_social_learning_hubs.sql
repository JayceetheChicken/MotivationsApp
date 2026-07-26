begin;

-- Social learning hubs deliberately expose only compact, purpose-built JSON
-- projections. Raw presence, membership and collaborative-session tables stay
-- RPC-only so future columns cannot accidentally become part of the API.

create or replace function private.touch_social_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create table public.learning_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state text not null check (state in ('idle', 'learning', 'paused')),
  active_since timestamptz,
  last_study_at timestamptz,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  constraint learning_presence_active_state check (
    (state = 'idle' and active_since is null)
    or (state in ('learning', 'paused') and active_since is not null)
  ),
  constraint learning_presence_expiry check (expires_at >= last_seen_at)
);

create index learning_presence_active_idx
on public.learning_presence(state, expires_at desc)
where state in ('learning', 'paused');

create table public.study_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  icon text,
  image_url text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint study_groups_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint study_groups_icon_length check (icon is null or char_length(btrim(icon)) between 1 and 80),
  constraint study_groups_image_url check (
    image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 2048)
  )
);

create index study_groups_creator_idx on public.study_groups(creator_id, created_at desc);

create trigger study_groups_touch_before_update
before update on public.study_groups
for each row execute function private.touch_social_revision();

create table public.study_group_members (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('creator', 'member')),
  status text not null check (status in ('invited', 'accepted', 'declined', 'left')),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  accepted_at timestamptz,
  left_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(group_id, user_id),
  constraint study_group_creator_state check (role <> 'creator' or status = 'accepted')
);

create index study_group_members_user_idx
on public.study_group_members(user_id, status, updated_at desc);
create index study_group_members_group_idx
on public.study_group_members(group_id, status, role);

create trigger study_group_members_touch_before_update
before update on public.study_group_members
for each row execute function private.touch_social_revision();

create table public.shared_study_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.study_groups(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  planned_duration_seconds integer not null check (
    planned_duration_seconds between 60 and 604800
  ),
  status text not null check (status in ('planned', 'active', 'completed', 'cancelled')),
  actual_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint shared_study_sessions_title_length check (
    char_length(btrim(title)) between 1 and 120
  ),
  constraint shared_study_sessions_lifecycle check (
    (status = 'planned' and actual_started_at is null and completed_at is null and cancelled_at is null)
    or (status = 'active' and actual_started_at is not null and completed_at is null and cancelled_at is null)
    or (status = 'completed' and actual_started_at is not null and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and completed_at is null and cancelled_at is not null)
  )
);

create index shared_study_sessions_group_idx
on public.shared_study_sessions(group_id, starts_at desc)
where group_id is not null;
create index shared_study_sessions_creator_idx
on public.shared_study_sessions(creator_id, starts_at desc);

create trigger shared_study_sessions_touch_before_update
before update on public.shared_study_sessions
for each row execute function private.touch_social_revision();

create table public.shared_study_session_participants (
  session_id uuid not null references public.shared_study_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('creator', 'member')),
  status text not null check (
    status in ('invited', 'joined', 'active', 'paused', 'finished', 'declined', 'left')
  ),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  joined_at timestamptz,
  active_since timestamptz,
  elapsed_seconds integer not null default 0 check (elapsed_seconds between 0 and 604800),
  finished_at timestamptz,
  left_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(session_id, user_id),
  constraint shared_session_creator_state check (
    role <> 'creator' or status in ('joined', 'active', 'paused', 'finished')
  ),
  constraint shared_session_active_state check (
    (status = 'active' and active_since is not null)
    or (status <> 'active' and active_since is null)
  )
);

create index shared_session_participants_user_idx
on public.shared_study_session_participants(user_id, status, updated_at desc);
create index shared_session_participants_session_idx
on public.shared_study_session_participants(session_id, status, role);

create trigger shared_session_participants_touch_before_update
before update on public.shared_study_session_participants
for each row execute function private.touch_social_revision();

alter table public.shared_goal_details
  add column cadence text,
  add column group_id uuid references public.study_groups(id) on delete cascade;

update public.shared_goal_details
set cadence = case when period = 'day' then 'daily' else 'weekly' end
where cadence is null;

alter table public.shared_goal_details
  alter column cadence set default 'weekly',
  alter column cadence set not null,
  add constraint shared_goal_details_cadence check (cadence in ('daily', 'weekly'));

create index shared_goal_details_group_idx
on public.shared_goal_details(group_id)
where group_id is not null;

alter table public.learning_presence enable row level security;
alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;
alter table public.shared_study_sessions enable row level security;
alter table public.shared_study_session_participants enable row level security;

revoke all on public.learning_presence from public, anon, authenticated;
revoke all on public.study_groups from public, anon, authenticated;
revoke all on public.study_group_members from public, anon, authenticated;
revoke all on public.shared_study_sessions from public, anon, authenticated;
revoke all on public.shared_study_session_participants from public, anon, authenticated;

create or replace function private.basic_social_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url
  )
  from public.profiles p
  where p.id = p_user_id;
$$;

create or replace function private.is_study_group_member(
  p_group_id uuid,
  p_user_id uuid,
  p_require_accepted boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.study_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
      and (not p_require_accepted or gm.status = 'accepted')
  );
$$;

create or replace function private.is_shared_session_participant(
  p_session_id uuid,
  p_user_id uuid,
  p_include_invited boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shared_study_session_participants sp
    where sp.session_id = p_session_id
      and sp.user_id = p_user_id
      and (
        sp.status in ('joined', 'active', 'paused', 'finished')
        or (p_include_invited and sp.status = 'invited')
      )
  );
$$;

create or replace function public.update_learning_presence(
  p_state text,
  p_active_since timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  previous public.learning_presence%rowtype;
  saved public.learning_presence%rowtype;
  observed_at timestamptz := clock_timestamp();
  resolved_active_since timestamptz;
  resolved_last_study_at timestamptz;
begin
  if p_state is null or p_state not in ('idle', 'learning', 'paused') then
    raise exception using errcode = '22023', message = 'invalid_presence_state';
  end if;
  if p_state = 'idle' and p_active_since is not null then
    raise exception using errcode = '22023', message = 'idle_presence_cannot_be_active';
  end if;
  if p_active_since is not null and (
    p_active_since > observed_at + interval '1 minute'
    or p_active_since < observed_at - interval '7 days'
  ) then
    raise exception using errcode = '22023', message = 'invalid_presence_active_since';
  end if;

  perform private.consume_rate_limit(actor, 'learning_presence', 180, interval '1 minute');
  select * into previous
  from public.learning_presence lp
  where lp.user_id = actor
  for update;

  if p_state in ('learning', 'paused') then
    resolved_active_since := coalesce(
      p_active_since,
      case when previous.state in ('learning', 'paused') then previous.active_since end,
      observed_at
    );
  else
    resolved_active_since := null;
  end if;

  resolved_last_study_at := previous.last_study_at;
  if previous.state in ('learning', 'paused')
     and p_state in ('paused', 'idle')
     and previous.state is distinct from p_state then
    resolved_last_study_at := observed_at;
  end if;

  insert into public.learning_presence(
    user_id, state, active_since, last_study_at, last_seen_at, expires_at
  ) values (
    actor,
    p_state,
    resolved_active_since,
    resolved_last_study_at,
    observed_at,
    observed_at + interval '5 minutes'
  )
  on conflict (user_id) do update
  set state = excluded.state,
      active_since = excluded.active_since,
      last_study_at = excluded.last_study_at,
      last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at
  returning * into saved;

  return jsonb_build_object(
    'state', saved.state,
    'active_since', saved.active_since,
    'last_study_at', saved.last_study_at,
    'last_seen_at', saved.last_seen_at,
    'expires_at', saved.expires_at
  );
end;
$$;

create or replace function private.friend_overview_read_model(
  p_friend_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  friend_profile public.profiles%rowtype;
  presence public.learning_presence%rowtype;
  latest_completed_study timestamptz;
  latest_study timestamptz;
  local_day_start timestamptz;
  local_week_start timestamptz;
  week_seconds numeric := 0;
  rounded_week_minutes integer := 0;
  presence_is_fresh boolean := false;
  status_value text;
  shared_goal_ids jsonb;
  shared_session_ids jsonb;
  shared_group_ids jsonb;
begin
  if not private.are_friends(p_actor, p_friend_id) then
    raise exception using errcode = '42501', message = 'friendship_required';
  end if;

  select * into friend_profile
  from public.profiles p
  where p.id = p_friend_id;
  if friend_profile.id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  select * into presence
  from public.learning_presence lp
  where lp.user_id = p_friend_id;

  select max(ss.ended_at) into latest_completed_study
  from public.study_sessions ss
  where ss.user_id = p_friend_id
    and ss.deleted_at is null
    and ss.ended_at <= clock_timestamp();

  latest_study := latest_completed_study;
  if presence.last_study_at is not null
     and (latest_study is null or presence.last_study_at > latest_study) then
    latest_study := presence.last_study_at;
  end if;

  local_day_start := date_trunc(
    'day', clock_timestamp() at time zone friend_profile.time_zone
  ) at time zone friend_profile.time_zone;
  local_week_start := date_trunc(
    'week', clock_timestamp() at time zone friend_profile.time_zone
  ) at time zone friend_profile.time_zone;

  select coalesce(sum(private.session_contribution_seconds(
    ss.id, local_week_start, clock_timestamp()
  )), 0)
  into week_seconds
  from public.study_sessions ss
  where ss.user_id = p_friend_id
    and ss.deleted_at is null
    and ss.ended_at > local_week_start
    and ss.started_at < clock_timestamp();

  rounded_week_minutes := (round(week_seconds / 300.0) * 5)::integer;
  presence_is_fresh := presence.user_id is not null
    and presence.expires_at > clock_timestamp();

  if presence_is_fresh and presence.state = 'learning' then
    status_value := 'learning';
  elsif (presence_is_fresh and presence.state = 'paused')
     or (latest_study is not null and latest_study >= local_day_start) then
    status_value := 'learned_today';
  else
    status_value := 'not_learned_today';
  end if;

  select coalesce(jsonb_agg(g.id order by g.starts_at desc), '[]'::jsonb)
  into shared_goal_ids
  from public.goals g
  join public.goal_participants mine
    on mine.goal_id = g.id and mine.user_id = p_actor and mine.status = 'accepted'
  join public.goal_participants theirs
    on theirs.goal_id = g.id and theirs.user_id = p_friend_id and theirs.status = 'accepted'
  where g.scope = 'shared' and g.deleted_at is null;

  select coalesce(jsonb_agg(s.id order by s.starts_at desc), '[]'::jsonb)
  into shared_session_ids
  from public.shared_study_sessions s
  join public.shared_study_session_participants mine
    on mine.session_id = s.id and mine.user_id = p_actor
      and mine.status in ('joined', 'active', 'paused', 'finished')
  join public.shared_study_session_participants theirs
    on theirs.session_id = s.id and theirs.user_id = p_friend_id
      and theirs.status in ('joined', 'active', 'paused', 'finished')
  where s.status <> 'cancelled';

  select coalesce(jsonb_agg(g.id order by g.created_at desc), '[]'::jsonb)
  into shared_group_ids
  from public.study_groups g
  join public.study_group_members mine
    on mine.group_id = g.id and mine.user_id = p_actor and mine.status = 'accepted'
  join public.study_group_members theirs
    on theirs.group_id = g.id and theirs.user_id = p_friend_id and theirs.status = 'accepted';

  return jsonb_build_object(
    'friend', private.basic_social_profile(p_friend_id),
    'learning_status', status_value,
    'active_since', case
      when presence_is_fresh and presence.state = 'learning' then presence.active_since
      else null
    end,
    'last_study_at', latest_study,
    'week_minutes', greatest(0, rounded_week_minutes),
    'streak_days', private.current_streak_days(p_friend_id, friend_profile.time_zone),
    'shared_goal_ids', shared_goal_ids,
    'shared_session_ids', shared_session_ids,
    'shared_group_ids', shared_group_ids
  );
end;
$$;

create or replace function public.get_friend_overview(p_friend_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return private.friend_overview_read_model(p_friend_id, actor);
end;
$$;

create or replace function public.list_friend_overviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'friends', coalesce((
      with friend_ids as (
        select case when f.requester_id = actor then f.addressee_id else f.requester_id end as friend_id
        from public.friendships f
        where (f.requester_id = actor or f.addressee_id = actor)
          and f.status = 'accepted'
          and f.deleted_at is null
      ), models as (
        select private.friend_overview_read_model(fi.friend_id, actor) as model
        from friend_ids fi
      )
      select jsonb_agg(
        model order by
          case when model ->> 'learning_status' = 'learning' then 0 else 1 end,
          (model ->> 'last_study_at')::timestamptz desc nulls last,
          model -> 'friend' ->> 'username'
      )
      from models
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.study_group_read_model(
  p_group_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  group_row public.study_groups%rowtype;
  membership public.study_group_members%rowtype;
begin
  select * into group_row
  from public.study_groups g
  where g.id = p_group_id;
  select * into membership
  from public.study_group_members gm
  where gm.group_id = p_group_id and gm.user_id = p_actor;

  if group_row.id is null then
    raise exception using errcode = 'P0001', message = 'study_group_not_found';
  end if;
  if membership.user_id is null or membership.status in ('declined', 'left') then
    raise exception using errcode = '42501', message = 'study_group_membership_required';
  end if;

  if membership.status = 'invited' then
    return jsonb_build_object(
      'group', jsonb_build_object(
        'id', group_row.id,
        'creator_id', group_row.creator_id,
        'name', group_row.name,
        'icon', group_row.icon,
        'image_url', group_row.image_url,
        'created_at', group_row.created_at,
        'updated_at', group_row.updated_at
      ),
      'creator', private.basic_social_profile(group_row.creator_id),
      'self_membership', jsonb_build_object(
        'user_id', membership.user_id,
        'role', membership.role,
        'status', membership.status,
        'invited_at', membership.invited_at,
        'user', private.basic_social_profile(membership.user_id)
      )
    );
  end if;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', group_row.id,
      'creator_id', group_row.creator_id,
      'name', group_row.name,
      'icon', group_row.icon,
      'image_url', group_row.image_url,
      'revision', group_row.revision,
      'created_at', group_row.created_at,
      'updated_at', group_row.updated_at
    ),
    'creator', private.basic_social_profile(group_row.creator_id),
    'self_membership', jsonb_build_object(
      'user_id', membership.user_id,
      'role', membership.role,
      'status', membership.status,
      'accepted_at', membership.accepted_at,
      'user', private.basic_social_profile(membership.user_id)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', gm.user_id,
        'role', gm.role,
        'status', gm.status,
        'user', private.basic_social_profile(gm.user_id)
      ) order by gm.role, gm.accepted_at, gm.user_id)
      from public.study_group_members gm
      where gm.group_id = p_group_id and gm.status = 'accepted'
    ), '[]'::jsonb),
    'shared_goal_ids', coalesce((
      select jsonb_agg(g.id order by g.starts_at desc)
      from public.shared_goal_details sgd
      join public.goals g on g.id = sgd.goal_id
      join public.goal_participants gp
        on gp.goal_id = g.id
       and gp.user_id = p_actor
       and gp.status in ('invited', 'accepted')
      where sgd.group_id = p_group_id and g.deleted_at is null
    ), '[]'::jsonb),
    'shared_session_ids', coalesce((
      select jsonb_agg(s.id order by s.starts_at desc)
      from public.shared_study_sessions s
      join public.shared_study_session_participants sp
        on sp.session_id = s.id
       and sp.user_id = p_actor
       and (
         sp.status in ('joined', 'active', 'paused', 'finished')
         or (sp.status = 'invited' and s.status in ('planned', 'active'))
       )
      where s.group_id = p_group_id and s.status <> 'cancelled'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_study_group(
  p_group jsonb,
  p_member_ids uuid[],
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
    nullif(p_group ->> 'id', '')::uuid,
    extensions.gen_random_uuid()
  );
  member_id uuid;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(actor, p_operation_id, 'create_study_group');
  if result is not null then return result; end if;

  if nullif(btrim(p_group ->> 'name'), '') is null then
    raise exception using errcode = '22023', message = 'study_group_name_required';
  end if;
  if coalesce(array_length(p_member_ids, 1), 0) < 1
     or coalesce(array_length(p_member_ids, 1), 0) > 20
     or actor = any(p_member_ids) then
    raise exception using errcode = '22023', message = 'invalid_group_members';
  end if;
  if (select count(distinct value) from unnest(p_member_ids) value)
     <> array_length(p_member_ids, 1) then
    raise exception using errcode = '22023', message = 'duplicate_group_members';
  end if;

  perform private.consume_rate_limit(actor, 'create_study_group', 10, interval '1 hour');
  foreach member_id in array p_member_ids loop
    if not private.are_friends(actor, member_id) then
      raise exception using errcode = '42501', message = 'group_member_must_be_friend';
    end if;
  end loop;

  insert into public.study_groups(id, creator_id, name, icon, image_url)
  values (
    entity_id,
    actor,
    btrim(p_group ->> 'name'),
    nullif(btrim(p_group ->> 'icon'), ''),
    nullif(btrim(p_group ->> 'image_url'), '')
  );
  insert into public.study_group_members(
    group_id, user_id, role, status, invited_by, responded_at, accepted_at
  ) values (
    entity_id, actor, 'creator', 'accepted', actor, clock_timestamp(), clock_timestamp()
  );
  insert into public.study_group_members(group_id, user_id, role, status, invited_by)
  select entity_id, value, 'member', 'invited', actor
  from unnest(p_member_ids) value;

  result := private.study_group_read_model(entity_id, actor);
  return private.write_mutation_receipt(
    actor, p_operation_id, 'create_study_group', result
  );
end;
$$;

create or replace function public.respond_study_group_invitation(
  p_group_id uuid,
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
  if p_accept is null then
    raise exception using errcode = '22023', message = 'invitation_response_required';
  end if;

  select g.creator_id into creator
  from public.study_groups g
  join public.study_group_members gm on gm.group_id = g.id
  where g.id = p_group_id
    and gm.user_id = actor
    and gm.role = 'member'
    and gm.status = 'invited'
  for update of gm;

  if creator is null then
    raise exception using errcode = '42501', message = 'group_invitation_not_actionable';
  end if;
  if p_accept and not private.are_friends(actor, creator) then
    raise exception using errcode = '42501', message = 'friendship_required';
  end if;

  update public.study_group_members gm
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = clock_timestamp(),
      accepted_at = case when p_accept then clock_timestamp() else null end
  where gm.group_id = p_group_id and gm.user_id = actor;

  if p_accept then
    return private.study_group_read_model(p_group_id, actor);
  end if;
  return jsonb_build_object('group_id', p_group_id, 'status', 'declined');
end;
$$;

create or replace function public.leave_study_group(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  update public.study_group_members gm
  set status = 'left',
      left_at = clock_timestamp(),
      responded_at = clock_timestamp()
  where gm.group_id = p_group_id
    and gm.user_id = actor
    and gm.role = 'member'
    and gm.status = 'accepted';

  if not found then
    raise exception using errcode = '42501', message = 'study_group_not_leaveable';
  end if;
  return jsonb_build_object('group_id', p_group_id, 'status', 'left');
end;
$$;

create or replace function public.get_study_group_details(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return private.study_group_read_model(p_group_id, actor);
end;
$$;

create or replace function public.list_study_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(
        private.study_group_read_model(gm.group_id, actor)
        order by g.updated_at desc
      )
      from public.study_group_members gm
      join public.study_groups g on g.id = gm.group_id
      where gm.user_id = actor and gm.status in ('invited', 'accepted')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.shared_study_session_read_model(
  p_session_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  session_row public.shared_study_sessions%rowtype;
  participant public.shared_study_session_participants%rowtype;
begin
  select * into session_row
  from public.shared_study_sessions s
  where s.id = p_session_id;
  select * into participant
  from public.shared_study_session_participants sp
  where sp.session_id = p_session_id and sp.user_id = p_actor;

  if session_row.id is null then
    raise exception using errcode = 'P0001', message = 'shared_study_session_not_found';
  end if;
  if participant.user_id is null or participant.status in ('declined', 'left') then
    raise exception using errcode = '42501', message = 'shared_session_participation_required';
  end if;

  if participant.status = 'invited' then
    if session_row.status not in ('planned', 'active') then
      raise exception using errcode = '42501', message = 'shared_session_invitation_expired';
    end if;
    return jsonb_build_object(
      'session', jsonb_build_object(
        'id', session_row.id,
        'creator_id', session_row.creator_id,
        'group_id', session_row.group_id,
        'title', session_row.title,
        'starts_at', session_row.starts_at,
        'planned_duration_seconds', session_row.planned_duration_seconds,
        'status', session_row.status,
        'created_at', session_row.created_at,
        'updated_at', session_row.updated_at
      ),
      'creator', private.basic_social_profile(session_row.creator_id),
      'self_participant', jsonb_build_object(
        'user_id', participant.user_id,
        'role', participant.role,
        'status', participant.status,
        'invited_at', participant.invited_at,
        'user', private.basic_social_profile(participant.user_id)
      )
    );
  end if;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', session_row.id,
      'creator_id', session_row.creator_id,
      'group_id', session_row.group_id,
      'title', session_row.title,
      'starts_at', session_row.starts_at,
      'planned_duration_seconds', session_row.planned_duration_seconds,
      'status', session_row.status,
      'actual_started_at', session_row.actual_started_at,
      'completed_at', session_row.completed_at,
      'cancelled_at', session_row.cancelled_at,
      'revision', session_row.revision,
      'created_at', session_row.created_at,
      'updated_at', session_row.updated_at
    ),
    'creator', private.basic_social_profile(session_row.creator_id),
    'self_participant', jsonb_build_object(
      'user_id', participant.user_id,
      'role', participant.role,
      'status', participant.status,
      'elapsed_seconds', least(
        604800,
        participant.elapsed_seconds + case
          when participant.status = 'active' then greatest(
            0,
            floor(extract(epoch from (clock_timestamp() - participant.active_since)))::integer
          )
          else 0
        end
      ),
      'active_since', participant.active_since,
      'user', private.basic_social_profile(participant.user_id)
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', sp.user_id,
        'role', sp.role,
        'status', sp.status,
        'elapsed_seconds', least(
          604800,
          sp.elapsed_seconds + case
            when sp.status = 'active' then greatest(
              0,
              floor(extract(epoch from (clock_timestamp() - sp.active_since)))::integer
            )
            else 0
          end
        ),
        'active_since', sp.active_since,
        'user', private.basic_social_profile(sp.user_id)
      ) order by sp.role, sp.joined_at, sp.user_id)
      from public.shared_study_session_participants sp
      where sp.session_id = p_session_id
        and sp.status in ('joined', 'active', 'paused', 'finished')
    ), '[]'::jsonb),
    'calculated_at', clock_timestamp()
  );
end;
$$;

create or replace function public.create_shared_study_session(
  p_session jsonb,
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
    nullif(p_session ->> 'id', '')::uuid,
    extensions.gen_random_uuid()
  );
  group_id_value uuid := nullif(p_session ->> 'group_id', '')::uuid;
  starts_at_value timestamptz := coalesce(
    nullif(p_session ->> 'starts_at', '')::timestamptz,
    clock_timestamp()
  );
  planned_seconds integer := coalesce(
    (p_session ->> 'planned_duration_seconds')::integer,
    (p_session ->> 'planned_duration_minutes')::integer * 60
  );
  start_now boolean := coalesce((p_session ->> 'start_now')::boolean, false);
  invitee_id uuid;
  result jsonb;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;
  result := private.read_mutation_receipt(
    actor, p_operation_id, 'create_shared_study_session'
  );
  if result is not null then return result; end if;

  if nullif(btrim(p_session ->> 'title'), '') is null
     or planned_seconds is null
     or planned_seconds not between 60 and 604800
     or starts_at_value < clock_timestamp() - interval '7 days'
     or starts_at_value > clock_timestamp() + interval '1 year' then
    raise exception using errcode = '22023', message = 'invalid_shared_session_payload';
  end if;
  if coalesce(array_length(p_invitee_ids, 1), 0) < 1
     or coalesce(array_length(p_invitee_ids, 1), 0) > 20
     or actor = any(p_invitee_ids) then
    raise exception using errcode = '22023', message = 'invalid_session_invitees';
  end if;
  if (select count(distinct value) from unnest(p_invitee_ids) value)
     <> array_length(p_invitee_ids, 1) then
    raise exception using errcode = '22023', message = 'duplicate_session_invitees';
  end if;

  perform private.consume_rate_limit(
    actor, 'create_shared_study_session', 20, interval '1 hour'
  );

  if group_id_value is not null
     and not private.is_study_group_member(group_id_value, actor, true) then
    raise exception using errcode = '42501', message = 'accepted_group_membership_required';
  end if;

  foreach invitee_id in array p_invitee_ids loop
    if group_id_value is null then
      if not private.are_friends(actor, invitee_id) then
        raise exception using errcode = '42501', message = 'session_invitee_must_be_friend';
      end if;
    elsif not private.is_study_group_member(group_id_value, invitee_id, true) then
      raise exception using errcode = '42501', message = 'session_invitee_must_be_group_member';
    end if;
  end loop;

  insert into public.shared_study_sessions(
    id, creator_id, group_id, title, starts_at, planned_duration_seconds,
    status, actual_started_at
  ) values (
    entity_id,
    actor,
    group_id_value,
    btrim(p_session ->> 'title'),
    starts_at_value,
    planned_seconds,
    case when start_now then 'active' else 'planned' end,
    case when start_now then clock_timestamp() else null end
  );
  insert into public.shared_study_session_participants(
    session_id, user_id, role, status, invited_by,
    responded_at, joined_at, active_since
  ) values (
    entity_id,
    actor,
    'creator',
    case when start_now then 'active' else 'joined' end,
    actor,
    clock_timestamp(),
    clock_timestamp(),
    case when start_now then clock_timestamp() else null end
  );
  insert into public.shared_study_session_participants(
    session_id, user_id, role, status, invited_by
  )
  select entity_id, value, 'member', 'invited', actor
  from unnest(p_invitee_ids) value;

  result := private.shared_study_session_read_model(entity_id, actor);
  return private.write_mutation_receipt(
    actor, p_operation_id, 'create_shared_study_session', result
  );
end;
$$;

create or replace function public.respond_shared_study_session_invitation(
  p_session_id uuid,
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
  session_row public.shared_study_sessions%rowtype;
begin
  if p_accept is null then
    raise exception using errcode = '22023', message = 'invitation_response_required';
  end if;

  select s.* into session_row
  from public.shared_study_sessions s
  where s.id = p_session_id and s.status in ('planned', 'active')
  for update;

  if session_row.id is null then
    raise exception using errcode = '42501', message = 'shared_session_invitation_not_actionable';
  end if;

  perform 1
  from public.shared_study_session_participants sp
  where sp.session_id = p_session_id
    and sp.user_id = actor
    and sp.role = 'member'
    and sp.status = 'invited'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'shared_session_invitation_not_actionable';
  end if;

  if p_accept then
    if session_row.group_id is null then
      if not private.are_friends(actor, session_row.creator_id) then
        raise exception using errcode = '42501', message = 'friendship_required';
      end if;
    elsif not private.is_study_group_member(session_row.group_id, actor, true) then
      raise exception using errcode = '42501', message = 'accepted_group_membership_required';
    end if;
  end if;

  update public.shared_study_session_participants sp
  set status = case when p_accept then 'joined' else 'declined' end,
      responded_at = clock_timestamp(),
      joined_at = case when p_accept then clock_timestamp() else null end
  where sp.session_id = p_session_id and sp.user_id = actor;

  if p_accept then
    return private.shared_study_session_read_model(p_session_id, actor);
  end if;
  return jsonb_build_object('session_id', p_session_id, 'status', 'declined');
end;
$$;

create or replace function public.update_shared_study_session_participant(
  p_session_id uuid,
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  session_row public.shared_study_sessions%rowtype;
  participant public.shared_study_session_participants%rowtype;
  observed_at timestamptz := clock_timestamp();
  next_elapsed integer;
begin
  if p_action is null or p_action not in ('start', 'pause', 'resume', 'finish', 'leave') then
    raise exception using errcode = '22023', message = 'invalid_shared_session_action';
  end if;

  select * into session_row
  from public.shared_study_sessions s
  where s.id = p_session_id
  for update;
  select * into participant
  from public.shared_study_session_participants sp
  where sp.session_id = p_session_id and sp.user_id = actor
  for update;

  if session_row.id is null or participant.user_id is null then
    raise exception using errcode = '42501', message = 'shared_session_participation_required';
  end if;

  next_elapsed := least(
    604800,
    participant.elapsed_seconds + case
      when participant.status = 'active' then greatest(
        0,
        floor(extract(epoch from (observed_at - participant.active_since)))::integer
      )
      else 0
    end
  );

  if p_action = 'leave' then
    if participant.role = 'creator'
       or participant.status not in ('joined', 'active', 'paused', 'finished') then
      raise exception using errcode = '42501', message = 'shared_session_not_leaveable';
    end if;
    update public.shared_study_session_participants sp
    set status = 'left', elapsed_seconds = next_elapsed,
        active_since = null, left_at = observed_at
    where sp.session_id = p_session_id and sp.user_id = actor;
    if session_row.status = 'active' and not exists (
      select 1
      from public.shared_study_session_participants sp
      where sp.session_id = p_session_id
        and sp.status in ('joined', 'active', 'paused')
    ) then
      update public.shared_study_sessions s
      set status = 'completed', completed_at = observed_at
      where s.id = p_session_id and s.status = 'active';
    end if;
    return jsonb_build_object('session_id', p_session_id, 'status', 'left');
  elsif p_action = 'start' then
    if participant.status = 'active' and session_row.status = 'active' then
      return private.shared_study_session_read_model(p_session_id, actor);
    end if;
    if participant.status <> 'joined' or session_row.status not in ('planned', 'active') then
      raise exception using errcode = 'P0001', message = 'shared_session_start_not_actionable';
    end if;
    if session_row.status = 'planned' then
      update public.shared_study_sessions s
      set status = 'active', actual_started_at = observed_at
      where s.id = p_session_id;
    end if;
    update public.shared_study_session_participants sp
    set status = 'active', active_since = observed_at
    where sp.session_id = p_session_id and sp.user_id = actor;
  elsif p_action = 'pause' then
    if participant.status = 'paused' and session_row.status = 'active' then
      return private.shared_study_session_read_model(p_session_id, actor);
    end if;
    if participant.status <> 'active' or session_row.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'shared_session_pause_not_actionable';
    end if;
    update public.shared_study_session_participants sp
    set status = 'paused', elapsed_seconds = next_elapsed, active_since = null
    where sp.session_id = p_session_id and sp.user_id = actor;
  elsif p_action = 'resume' then
    if participant.status = 'active' and session_row.status = 'active' then
      return private.shared_study_session_read_model(p_session_id, actor);
    end if;
    if participant.status <> 'paused' or session_row.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'shared_session_resume_not_actionable';
    end if;
    update public.shared_study_session_participants sp
    set status = 'active', active_since = observed_at
    where sp.session_id = p_session_id and sp.user_id = actor;
  else
    if participant.status = 'finished'
       and session_row.status in ('active', 'completed', 'cancelled') then
      return private.shared_study_session_read_model(p_session_id, actor);
    end if;
    if participant.status not in ('active', 'paused') or session_row.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'shared_session_finish_not_actionable';
    end if;
    update public.shared_study_session_participants sp
    set status = 'finished', elapsed_seconds = next_elapsed,
        active_since = null, finished_at = observed_at
    where sp.session_id = p_session_id and sp.user_id = actor;

    if not exists (
      select 1
      from public.shared_study_session_participants sp
      where sp.session_id = p_session_id
        and sp.status in ('joined', 'active', 'paused')
    ) then
      update public.shared_study_sessions s
      set status = 'completed', completed_at = observed_at
      where s.id = p_session_id and s.status = 'active';
    end if;
  end if;

  return private.shared_study_session_read_model(p_session_id, actor);
end;
$$;

create or replace function public.cancel_shared_study_session(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  session_row public.shared_study_sessions%rowtype;
  observed_at timestamptz := clock_timestamp();
begin
  select * into session_row
  from public.shared_study_sessions s
  where s.id = p_session_id and s.creator_id = actor
    and s.status in ('planned', 'active')
  for update;

  if session_row.id is null then
    raise exception using errcode = '42501', message = 'shared_session_not_cancellable';
  end if;

  update public.shared_study_session_participants sp
  set elapsed_seconds = least(
        604800,
        sp.elapsed_seconds + case
          when sp.status = 'active' then greatest(
            0,
            floor(extract(epoch from (observed_at - sp.active_since)))::integer
          )
          else 0
        end
      ),
      status = 'finished',
      active_since = null,
      finished_at = coalesce(sp.finished_at, observed_at)
  where sp.session_id = p_session_id
    and sp.status in ('joined', 'active', 'paused');

  update public.shared_study_sessions s
  set status = 'cancelled', cancelled_at = observed_at
  where s.id = p_session_id;

  return private.shared_study_session_read_model(p_session_id, actor);
end;
$$;

create or replace function public.get_shared_study_session_details(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return private.shared_study_session_read_model(p_session_id, actor);
end;
$$;

create or replace function public.list_shared_study_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(
        private.shared_study_session_read_model(sp.session_id, actor)
        order by s.starts_at desc
      )
      from public.shared_study_session_participants sp
      join public.shared_study_sessions s on s.id = sp.session_id
      where sp.user_id = actor
        and (
          sp.status in ('joined', 'active', 'paused', 'finished')
          or (sp.status = 'invited' and s.status in ('planned', 'active'))
        )
    ), '[]'::jsonb)
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
      when goal_row.status = 'active' and goal_row.ends_at <= clock_timestamp() then 'expired'
      else goal_row.status
    end,
    'expired', goal_row.ends_at <= clock_timestamp()
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
    starts_at_value := nullif(
      coalesce(p_goal ->> 'starts_at', p_goal ->> 'startsAt'), ''
    )::timestamptz;
    ends_at_value := nullif(
      coalesce(p_goal ->> 'ends_at', p_goal ->> 'endsAt'), ''
    )::timestamptz;
  else
    raise exception using errcode = '22023', message = 'invalid_goal_period';
  end if;
  if starts_at_value is null or ends_at_value is null or ends_at_value <= starts_at_value then
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
    and g.status = 'active' and g.ends_at > clock_timestamp()
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

create or replace function public.withdraw_from_shared_goal(p_goal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  update public.goal_participants gp
  set status = 'withdrawn',
      withdrawn_at = clock_timestamp(),
      responded_at = clock_timestamp()
  where gp.goal_id = p_goal_id
    and gp.user_id = actor
    and gp.role = 'member'
    and gp.status = 'accepted';

  if not found then
    raise exception using errcode = '42501', message = 'goal_not_withdrawable';
  end if;
  return jsonb_build_object('goal_id', p_goal_id, 'status', 'withdrawn');
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
  where gp.user_id = p_actor
    and gp.status in ('invited', 'accepted')
    and g.scope = 'shared'
    and g.deleted_at is null;
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
    least(clock_timestamp(), shared_goal.ends_at - interval '1 microsecond')
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
  cadence_end := least(cadence_end, shared_goal.ends_at);
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

create or replace function public.get_shared_goal_progress(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return private.shared_goal_progress_read_model(p_goal_id, actor);
end;
$$;

create or replace function public.list_shared_goal_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'progress', coalesce((
      select jsonb_agg(
        private.shared_goal_progress_read_model(gp.goal_id, actor)
        order by g.starts_at desc
      )
      from public.goal_participants gp
      join public.goals g on g.id = gp.goal_id
      where gp.user_id = actor
        and gp.status = 'accepted'
        and g.scope = 'shared'
        and g.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.study_sessions
  add column shared_session_id uuid
  references public.shared_study_sessions(id) on delete set null;

create index study_sessions_shared_session_idx
on public.study_sessions(shared_session_id, user_id)
where shared_session_id is not null and deleted_at is null;

create or replace function private.validate_study_session_shared_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shared_session_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.user_id = old.user_id
       and new.shared_session_id is not distinct from old.shared_session_id then
      return new;
    end if;
  end if;

  if not exists (
    select 1
    from public.shared_study_sessions s
    join public.shared_study_session_participants sp on sp.session_id = s.id
    where s.id = new.shared_session_id
      and sp.user_id = new.user_id
      and (
        (
          s.status in ('active', 'completed')
          and sp.status in ('joined', 'active', 'paused', 'finished')
        )
        or (s.status = 'cancelled' and sp.status = 'finished')
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'accepted_shared_session_participation_required';
  end if;
  return new;
end;
$$;

create trigger study_sessions_validate_shared_link_before_write
before insert or update on public.study_sessions
for each row execute function private.validate_study_session_shared_link();

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
  shared_session_id_value uuid := nullif(coalesce(
    p_session ->> 'shared_session_id', p_session ->> 'sharedSessionId'
  ), '')::uuid;
  source_value text := p_session ->> 'source';
  started_at_value timestamptz := coalesce(
    p_session ->> 'started_at', p_session ->> 'startedAt'
  )::timestamptz;
  ended_at_value timestamptz := coalesce(
    p_session ->> 'ended_at', p_session ->> 'endedAt'
  )::timestamptz;
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

  if entity_id is null or subject_id is null
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
    id, user_id, subject_id, goal_id, shared_session_id, source,
    started_at, ended_at, duration_seconds, planned_duration_seconds,
    entered_at, subject_name_snapshot, goal_title_snapshot
  ) values (
    entity_id, actor, subject_id, goal_id, shared_session_id_value, source_value,
    started_at_value, ended_at_value, duration_value, planned_value,
    entered_at_value,
    nullif(coalesce(
      p_session ->> 'subject_name_snapshot', p_session ->> 'subjectNameSnapshot'
    ), ''),
    nullif(coalesce(
      p_session ->> 'goal_title_snapshot', p_session ->> 'goalTitleSnapshot'
    ), '')
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

revoke all on function public.get_friend_profile_stats(uuid) from public, anon, authenticated;

revoke all on function public.update_learning_presence(text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_friend_overview(uuid) from public, anon, authenticated;
revoke all on function public.list_friend_overviews() from public, anon, authenticated;
revoke all on function public.create_study_group(jsonb, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.respond_study_group_invitation(uuid, boolean) from public, anon, authenticated;
revoke all on function public.leave_study_group(uuid) from public, anon, authenticated;
revoke all on function public.get_study_group_details(uuid) from public, anon, authenticated;
revoke all on function public.list_study_groups() from public, anon, authenticated;
revoke all on function public.create_shared_study_session(jsonb, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.respond_shared_study_session_invitation(uuid, boolean) from public, anon, authenticated;
revoke all on function public.update_shared_study_session_participant(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_shared_study_session(uuid) from public, anon, authenticated;
revoke all on function public.get_shared_study_session_details(uuid) from public, anon, authenticated;
revoke all on function public.list_shared_study_sessions() from public, anon, authenticated;
revoke all on function public.create_shared_goal(jsonb, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.respond_shared_goal_invitation(uuid, boolean) from public, anon, authenticated;
revoke all on function public.withdraw_from_shared_goal(uuid) from public, anon, authenticated;
revoke all on function public.get_shared_goal_details(uuid) from public, anon, authenticated;
revoke all on function public.list_shared_goals() from public, anon, authenticated;
revoke all on function public.get_shared_goal_progress(uuid) from public, anon, authenticated;
revoke all on function public.list_shared_goal_progress() from public, anon, authenticated;
revoke all on function public.save_completed_session(jsonb, uuid) from public, anon, authenticated;

grant execute on function public.update_learning_presence(text, timestamptz) to authenticated;
grant execute on function public.get_friend_overview(uuid) to authenticated;
grant execute on function public.list_friend_overviews() to authenticated;
grant execute on function public.create_study_group(jsonb, uuid[], uuid) to authenticated;
grant execute on function public.respond_study_group_invitation(uuid, boolean) to authenticated;
grant execute on function public.leave_study_group(uuid) to authenticated;
grant execute on function public.get_study_group_details(uuid) to authenticated;
grant execute on function public.list_study_groups() to authenticated;
grant execute on function public.create_shared_study_session(jsonb, uuid[], uuid) to authenticated;
grant execute on function public.respond_shared_study_session_invitation(uuid, boolean) to authenticated;
grant execute on function public.update_shared_study_session_participant(uuid, text) to authenticated;
grant execute on function public.cancel_shared_study_session(uuid) to authenticated;
grant execute on function public.get_shared_study_session_details(uuid) to authenticated;
grant execute on function public.list_shared_study_sessions() to authenticated;
grant execute on function public.create_shared_goal(jsonb, uuid[], uuid) to authenticated;
grant execute on function public.respond_shared_goal_invitation(uuid, boolean) to authenticated;
grant execute on function public.withdraw_from_shared_goal(uuid) to authenticated;
grant execute on function public.get_shared_goal_details(uuid) to authenticated;
grant execute on function public.list_shared_goals() to authenticated;
grant execute on function public.get_shared_goal_progress(uuid) to authenticated;
grant execute on function public.list_shared_goal_progress() to authenticated;
grant execute on function public.save_completed_session(jsonb, uuid) to authenticated;

commit;
