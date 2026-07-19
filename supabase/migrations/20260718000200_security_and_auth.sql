begin;

create or replace function private.current_actor()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  return actor;
end;
$$;

create or replace function private.are_friends(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where f.pair_low = least(p_left, p_right)
      and f.pair_high = greatest(p_left, p_right)
      and f.status = 'accepted'
      and f.deleted_at is null
  );
$$;

create or replace function private.is_goal_participant(
  p_goal_id uuid,
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
    from public.goal_participants gp
    where gp.goal_id = p_goal_id
      and gp.user_id = p_user_id
      and (not p_require_accepted or gp.status = 'accepted')
  );
$$;

create or replace function private.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window interval
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempts integer;
begin
  if p_limit <= 0 or p_window <= interval '0 seconds' then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_configuration';
  end if;

  delete from private.rpc_rate_limits r
  where r.user_id = p_user_id
    and r.action = p_action
    and r.occurred_at < clock_timestamp() - greatest(p_window, interval '30 days');

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_action, 0));

  select count(*) into attempts
  from private.rpc_rate_limits r
  where r.user_id = p_user_id
    and r.action = p_action
    and r.occurred_at >= clock_timestamp() - p_window;

  if attempts >= p_limit then
    raise exception using errcode = 'P0001', message = 'rate_limit_exceeded';
  end if;

  insert into private.rpc_rate_limits(user_id, action)
  values (p_user_id, p_action);
end;
$$;

create or replace function private.read_mutation_receipt(
  p_user_id uuid,
  p_operation_id uuid,
  p_function_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_operation_id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || ':' || p_operation_id::text || ':' || p_function_name,
    0
  ));
  return (
    select r.result
    from private.mutation_receipts r
    where r.user_id = p_user_id
      and r.operation_id = p_operation_id
      and r.function_name = p_function_name
  );
end;
$$;

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

create or replace function private.ensure_profile(
  p_user_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_username text := lower(btrim(coalesce(p_metadata ->> 'username', '')));
  chosen_username text;
  chosen_display_name text := btrim(coalesce(p_metadata ->> 'display_name', ''));
  chosen_avatar_url text := nullif(btrim(coalesce(p_metadata ->> 'avatar_url', '')), '');
  chosen_time_zone text := coalesce(
    nullif(btrim(p_metadata ->> 'time_zone'), ''),
    nullif(btrim(p_metadata ->> 'timeZone'), ''),
    'UTC'
  );
  needs_review boolean := false;
begin
  if exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;

  if requested_username !~ '^[a-z0-9._-]{3,30}$'
     or exists (select 1 from public.profiles where username = requested_username) then
    chosen_username := 'user_' || substr(replace(p_user_id::text, '-', ''), 1, 12);
    needs_review := true;
  else
    chosen_username := requested_username;
  end if;

  if char_length(chosen_display_name) not between 2 and 50 then
    chosen_display_name := 'Lernende Person';
  end if;

  if chosen_avatar_url !~ '^https://' then
    chosen_avatar_url := null;
  end if;

  begin
    perform now() at time zone chosen_time_zone;
  exception when invalid_parameter_value then
    chosen_time_zone := 'UTC';
  end;

  begin
    insert into public.profiles(
      id,
      username,
      display_name,
      avatar_url,
      time_zone,
      username_needs_review
    ) values (
      p_user_id,
      chosen_username,
      chosen_display_name,
      chosen_avatar_url,
      chosen_time_zone,
      needs_review
    );
  exception when unique_violation then
    insert into public.profiles(
      id,
      username,
      display_name,
      avatar_url,
      time_zone,
      username_needs_review
    ) values (
      p_user_id,
      'user_' || substr(replace(p_user_id::text, '-', ''), 1, 12),
      chosen_display_name,
      chosen_avatar_url,
      chosen_time_zone,
      true
    ) on conflict (id) do nothing;
  end;
end;
$$;

create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_profile(new.id, coalesce(new.raw_user_meta_data, '{}'::jsonb));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_auth_user_created();

do $$
declare
  existing_user record;
begin
  for existing_user in
    select u.id, u.raw_user_meta_data
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
    order by u.created_at, u.id
  loop
    perform private.ensure_profile(
      existing_user.id,
      coalesce(existing_user.raw_user_meta_data, '{}'::jsonb)
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.privacy_settings enable row level security;
alter table public.subjects enable row level security;
alter table public.goals enable row level security;
alter table public.personal_goal_details enable row level security;
alter table public.shared_goal_details enable row level security;
alter table public.goal_participants enable row level security;
alter table public.goal_pause_intervals enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_session_segments enable row level security;
alter table public.grades enable row level security;
alter table public.grade_sessions enable row level security;
alter table public.friendships enable row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using (id = auth.uid());

create policy privacy_settings_select_own
on public.privacy_settings for select to authenticated
using (user_id = auth.uid());

create policy subjects_select_own
on public.subjects for select to authenticated
using (owner_id = auth.uid());

create policy goals_select_created
on public.goals for select to authenticated
using (creator_id = auth.uid());

create policy personal_goal_details_select_own
on public.personal_goal_details for select to authenticated
using (owner_id = auth.uid());

create policy goal_participants_select_own
on public.goal_participants for select to authenticated
using (user_id = auth.uid());

create policy goal_pause_intervals_select_own
on public.goal_pause_intervals for select to authenticated
using (
  exists (
    select 1
    from public.personal_goal_details pgd
    where pgd.goal_id = goal_pause_intervals.goal_id
      and pgd.owner_id = auth.uid()
  )
);

create policy study_sessions_select_own
on public.study_sessions for select to authenticated
using (user_id = auth.uid());

create policy study_session_segments_select_own
on public.study_session_segments for select to authenticated
using (user_id = auth.uid());

create policy grades_select_own
on public.grades for select to authenticated
using (user_id = auth.uid());

create policy grade_sessions_select_own
on public.grade_sessions for select to authenticated
using (user_id = auth.uid());

create policy friendships_select_participant
on public.friendships for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles,
  public.privacy_settings,
  public.subjects,
  public.goals,
  public.personal_goal_details,
  public.goal_participants,
  public.goal_pause_intervals,
  public.study_sessions,
  public.study_session_segments,
  public.grades,
  public.grade_sessions,
  public.friendships
to authenticated;

alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public revoke all on functions from public, anon;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;

commit;
