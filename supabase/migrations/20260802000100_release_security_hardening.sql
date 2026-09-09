begin;

-- Keep rate-limit storage bounded. The previous implementation retained at
-- least 30 days even for minute windows, allowing presence heartbeats to grow
-- this private table unnecessarily.
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
  if p_user_id is null
     or p_action is null
     or p_action !~ '^[a-z0-9_]{1,80}$'
     or p_limit <= 0
     or p_limit > 10000
     or p_window <= interval '0 seconds'
     or p_window > interval '30 days' then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_configuration';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_action, 0)
  );

  delete from private.rpc_rate_limits r
  where r.user_id = p_user_id
    and r.action = p_action
    and r.occurred_at < pg_catalog.clock_timestamp() - p_window;

  select pg_catalog.count(*) into attempts
  from private.rpc_rate_limits r
  where r.user_id = p_user_id
    and r.action = p_action
    and r.occurred_at >= pg_catalog.clock_timestamp() - p_window;

  if attempts >= p_limit then
    raise exception using errcode = 'P0003', message = 'rate_limit_exceeded';
  end if;

  insert into private.rpc_rate_limits(user_id, action)
  values (p_user_id, p_action);
end;
$$;

revoke all on function private.consume_rate_limit(uuid, text, integer, interval)
from public, anon, authenticated;

alter table private.rpc_rate_limits
  add constraint rpc_rate_limits_action_format
  check (action ~ '^[a-z0-9_]{1,80}$') not valid;

-- Bounds apply immediately to new and changed rows while NOT VALID keeps the
-- migration deployable if an old installation contains legacy outliers. The
-- release checklist requires reviewing and validating legacy rows separately.
alter table public.goals
  add constraint goals_security_target_bounds check (
    (target_type = 'duration' and target_value between 1 and 31536000
      and minimum_session_seconds is null)
    or
    (target_type = 'sessions' and target_value between 1 and 100000
      and minimum_session_seconds between 0 and 604800)
  ) not valid,
  add constraint goals_security_date_bounds check (
    starts_at >= '2000-01-01 00:00:00+00'::timestamptz
    and starts_at < '2100-01-01 00:00:00+00'::timestamptz
    and (ends_at is null or ends_at < '2100-01-01 00:00:00+00'::timestamptz)
  ) not valid;

alter table public.study_sessions
  add constraint study_sessions_security_date_bounds check (
    started_at >= '2000-01-01 00:00:00+00'::timestamptz
    and ended_at < '2100-01-01 00:00:00+00'::timestamptz
  ) not valid,
  add constraint study_sessions_duration_within_window check (
    duration_seconds <= pg_catalog.ceil(
      pg_catalog.date_part('epoch', ended_at - started_at)
    )
  ) not valid;

alter table public.study_session_segments
  add constraint study_session_segments_count_limit check (ordinal < 1440) not valid,
  add constraint study_session_segments_security_date_bounds check (
    started_at >= '2000-01-01 00:00:00+00'::timestamptz
    and ended_at < '2100-01-01 00:00:00+00'::timestamptz
  ) not valid;

alter table public.grades
  add constraint grades_assessment_date_bounds check (
    assessment_date is null
    or assessment_date between date '2000-01-01' and date '2099-12-31'
  ) not valid;

alter table public.shared_study_sessions
  add constraint shared_study_sessions_date_bounds check (
    starts_at >= '2000-01-01 00:00:00+00'::timestamptz
    and starts_at < '2100-01-01 00:00:00+00'::timestamptz
    and (actual_started_at is null or actual_started_at < '2100-01-01 00:00:00+00'::timestamptz)
    and (completed_at is null or completed_at >= actual_started_at)
    and (cancelled_at is null or cancelled_at >= created_at)
  ) not valid;

-- Defense-in-depth quotas are table triggers so future RPCs cannot silently
-- bypass the same account and participant limits.
create or replace function private.enforce_social_row_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_count integer;
  quota_key text;
begin
  if tg_table_schema <> 'public' or tg_op <> 'INSERT' then
    raise exception using errcode = '0A000', message = 'invalid_quota_trigger';
  end if;

  if tg_table_name = 'study_groups' then
    quota_key := 'study_groups:' || new.creator_id::text;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(quota_key, 0));
    select pg_catalog.count(*) into existing_count
    from public.study_groups value where value.creator_id = new.creator_id;
    if existing_count >= 100 then
      raise exception using errcode = '54000', message = 'study_group_account_limit';
    end if;
  elsif tg_table_name = 'shared_study_sessions' then
    quota_key := 'shared_sessions:' || new.creator_id::text;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(quota_key, 0));
    select pg_catalog.count(*) into existing_count
    from public.shared_study_sessions value
    where value.creator_id = new.creator_id and value.status in ('planned', 'active');
    if existing_count >= 100 then
      raise exception using errcode = '54000', message = 'shared_session_account_limit';
    end if;
  elsif tg_table_name = 'goals' and new.scope = 'shared' then
    quota_key := 'shared_goals:' || new.creator_id::text;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(quota_key, 0));
    select pg_catalog.count(*) into existing_count
    from public.goals value
    where value.creator_id = new.creator_id
      and value.scope = 'shared'
      and value.deleted_at is null
      and value.status in ('active', 'paused');
    if existing_count >= 100 then
      raise exception using errcode = '54000', message = 'shared_goal_account_limit';
    end if;
  elsif tg_table_name = 'friendships' and new.status = 'pending' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('friendships:out:' || new.requester_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('friendships:in:' || new.addressee_id::text, 0)
    );
    select pg_catalog.count(*) into existing_count
    from public.friendships value
    where value.requester_id = new.requester_id
      and value.status = 'pending' and value.deleted_at is null;
    if existing_count >= 50 then
      raise exception using errcode = '54000', message = 'outgoing_friend_request_limit';
    end if;
    select pg_catalog.count(*) into existing_count
    from public.friendships value
    where value.addressee_id = new.addressee_id
      and value.status = 'pending' and value.deleted_at is null;
    if existing_count >= 100 then
      raise exception using errcode = '54000', message = 'incoming_friend_request_limit';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.enforce_participant_row_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_count integer;
  parent_id uuid;
begin
  if tg_table_schema <> 'public' or tg_op <> 'INSERT' then
    raise exception using errcode = '0A000', message = 'invalid_participant_quota_trigger';
  end if;
  if tg_table_name = 'study_group_members' then
    parent_id := new.group_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('group:' || parent_id::text, 0));
    select pg_catalog.count(*) into existing_count
    from public.study_group_members value where value.group_id = parent_id;
  elsif tg_table_name = 'shared_study_session_participants' then
    parent_id := new.session_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('session:' || parent_id::text, 0));
    select pg_catalog.count(*) into existing_count
    from public.shared_study_session_participants value where value.session_id = parent_id;
  elsif tg_table_name = 'goal_participants' then
    parent_id := new.goal_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goal:' || parent_id::text, 0));
    select pg_catalog.count(*) into existing_count
    from public.goal_participants value where value.goal_id = parent_id;
  else
    raise exception using errcode = '0A000', message = 'invalid_participant_quota_table';
  end if;
  if existing_count >= 21 then
    raise exception using errcode = '54000', message = 'participant_limit';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_profile_change_rate()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if actor <> new.id then
    raise exception using errcode = '42501', message = 'profile_owner_required';
  end if;
  if row(new.username, new.display_name, new.avatar_url, new.time_zone)
     is distinct from row(old.username, old.display_name, old.avatar_url, old.time_zone) then
    perform private.consume_rate_limit(actor, 'profile_change', 30, interval '1 hour');
  end if;
  return new;
end;
$$;

create trigger study_groups_quota_before_insert
before insert on public.study_groups
for each row execute function private.enforce_social_row_quota();
create trigger shared_study_sessions_quota_before_insert
before insert on public.shared_study_sessions
for each row execute function private.enforce_social_row_quota();
create trigger shared_goals_quota_before_insert
before insert on public.goals
for each row execute function private.enforce_social_row_quota();
create trigger friendships_quota_before_insert
before insert on public.friendships
for each row execute function private.enforce_social_row_quota();

create trigger study_group_members_quota_before_insert
before insert on public.study_group_members
for each row execute function private.enforce_participant_row_quota();
create trigger shared_session_participants_quota_before_insert
before insert on public.shared_study_session_participants
for each row execute function private.enforce_participant_row_quota();
create trigger goal_participants_quota_before_insert
before insert on public.goal_participants
for each row execute function private.enforce_participant_row_quota();

create trigger profiles_rate_limit_before_update
before update on public.profiles
for each row execute function private.enforce_profile_change_rate();

revoke all on function private.enforce_social_row_quota()
from public, anon, authenticated;
revoke all on function private.enforce_participant_row_quota()
from public, anon, authenticated;
revoke all on function private.enforce_profile_change_rate()
from public, anon, authenticated;

-- Reassert the exposed-schema boundary after all preceding migrations.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon;
revoke insert, update, delete, truncate, references, trigger
on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public revoke all on functions from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;

commit;
