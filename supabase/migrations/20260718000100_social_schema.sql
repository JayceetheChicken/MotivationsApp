begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.account_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_version bigint not null default 0 check (current_version >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create or replace function private.next_sync_version(p_user_id uuid)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  allocated bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '23502', message = 'sync_owner_required';
  end if;

  insert into private.account_sync_state(user_id, current_version)
  values (p_user_id, 1)
  on conflict (user_id) do update
  set current_version = private.account_sync_state.current_version + 1,
      updated_at = clock_timestamp()
  returning current_version into allocated;

  return allocated;
end;
$$;

create or replace function private.sync_owner_for_row(
  p_table_name text,
  p_row jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  owner_id := case p_table_name
    when 'profiles' then (p_row ->> 'id')::uuid
    when 'privacy_settings' then (p_row ->> 'user_id')::uuid
    when 'subjects' then (p_row ->> 'owner_id')::uuid
    when 'goals' then (p_row ->> 'creator_id')::uuid
    when 'personal_goal_details' then (p_row ->> 'owner_id')::uuid
    when 'goal_participants' then (p_row ->> 'user_id')::uuid
    when 'study_sessions' then (p_row ->> 'user_id')::uuid
    when 'study_session_segments' then (p_row ->> 'user_id')::uuid
    when 'grades' then (p_row ->> 'user_id')::uuid
    when 'grade_sessions' then (p_row ->> 'user_id')::uuid
    when 'friendships' then (p_row ->> 'requester_id')::uuid
    else null
  end;

  if owner_id is null and p_table_name = 'shared_goal_details' then
    select g.creator_id into owner_id
    from public.goals g
    where g.id = (p_row ->> 'goal_id')::uuid;
  elsif owner_id is null and p_table_name = 'goal_pause_intervals' then
    select coalesce(pgd.owner_id, g.creator_id) into owner_id
    from public.goals g
    left join public.personal_goal_details pgd on pgd.goal_id = g.id
    where g.id = (p_row ->> 'goal_id')::uuid;
  end if;

  return owner_id;
end;
$$;

create or replace function private.bump_row_version()
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
  new.sync_version := private.next_sync_version(
    private.sync_owner_for_row(tg_table_name, to_jsonb(new))
  );
  return new;
end;
$$;

create or replace function private.validate_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.username := lower(btrim(new.username));
  new.display_name := btrim(new.display_name);

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

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  avatar_url text,
  time_zone text not null default 'UTC',
  username_needs_review boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profiles_username_format check (
    username = lower(btrim(username))
    and username ~ '^[a-z0-9._-]{3,30}$'
  ),
  constraint profiles_display_name_length check (char_length(display_name) between 2 and 50),
  constraint profiles_avatar_https check (
    avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048)
  ),
  constraint profiles_time_zone_length check (char_length(time_zone) between 1 and 100)
);

create unique index profiles_username_unique on public.profiles (username);
create index profiles_sync_version_idx on public.profiles (id, sync_version);

create trigger profiles_validate_before_write
before insert or update on public.profiles
for each row execute function private.validate_profile();

create trigger profiles_version_before_update
before insert or update on public.profiles
for each row execute function private.bump_row_version();

create table public.privacy_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  share_timer_stats boolean not null default false,
  share_manual_stats boolean not null default false,
  share_goal_progress boolean not null default false,
  share_streak boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger privacy_settings_version_before_update
before insert or update on public.privacy_settings
for each row execute function private.bump_row_version();

create or replace function private.create_default_privacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.privacy_settings(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_privacy_after_insert
after insert on public.profiles
for each row execute function private.create_default_privacy();

create table public.subjects (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  name_normalized text generated always as (lower(btrim(name))) stored,
  color text not null,
  icon text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint subjects_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint subjects_color_length check (char_length(btrim(color)) between 1 and 40),
  constraint subjects_icon_length check (char_length(btrim(icon)) between 1 and 80),
  unique (id, owner_id)
);

create unique index subjects_active_name_unique
on public.subjects(owner_id, name_normalized)
where deleted_at is null and archived_at is null;
create index subjects_owner_sync_idx on public.subjects(owner_id, sync_version);
create index subjects_owner_active_idx on public.subjects(owner_id, created_at desc)
where deleted_at is null;

create trigger subjects_version_before_update
before insert or update on public.subjects
for each row execute function private.bump_row_version();

create table public.goals (
  id uuid primary key default extensions.gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('personal', 'shared')),
  title text,
  target_type text not null check (target_type in ('duration', 'sessions')),
  target_value integer not null check (target_value > 0),
  minimum_session_seconds integer,
  source_policy text not null default 'all' check (source_policy in ('all', 'timer_only')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  completed_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint goals_title_length check (title is null or char_length(btrim(title)) between 1 and 120),
  constraint goals_interval check (ends_at is null or ends_at > starts_at),
  constraint goals_minimum_session check (
    (target_type = 'duration' and minimum_session_seconds is null)
    or (
      target_type = 'sessions'
      and minimum_session_seconds is not null
      and minimum_session_seconds between 0 and 604800
    )
  ),
  unique (id, creator_id)
);

create index goals_creator_sync_idx on public.goals(creator_id, sync_version);
create index goals_creator_active_idx on public.goals(creator_id, starts_at desc)
where deleted_at is null;
create index goals_shared_window_idx on public.goals(starts_at, ends_at)
where scope = 'shared' and deleted_at is null;

create trigger goals_version_before_update
before insert or update on public.goals
for each row execute function private.bump_row_version();

create table public.personal_goal_details (
  goal_id uuid primary key references public.goals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null,
  period text not null check (period in ('day', 'week', 'month', 'year', 'custom')),
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (subject_id, owner_id) references public.subjects(id, owner_id)
);

create index personal_goal_details_owner_sync_idx
on public.personal_goal_details(owner_id, sync_version);

create trigger personal_goal_details_version_before_update
before insert or update on public.personal_goal_details
for each row execute function private.bump_row_version();

create table public.shared_goal_details (
  goal_id uuid primary key references public.goals(id) on delete cascade,
  description text not null default '',
  mode text not null check (mode in ('per_participant', 'shared')),
  period text not null check (period in ('day', 'week', 'month', 'year', 'custom')),
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint shared_goal_description_length check (char_length(description) <= 1000)
);

create trigger shared_goal_details_version_before_update
before insert or update on public.shared_goal_details
for each row execute function private.bump_row_version();

create table public.goal_participants (
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('creator', 'member')),
  status text not null check (status in ('invited', 'accepted', 'declined', 'withdrawn')),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  accepted_at timestamptz,
  withdrawn_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(goal_id, user_id),
  constraint goal_participants_creator_state check (
    role <> 'creator' or status = 'accepted'
  )
);

create index goal_participants_user_sync_idx
on public.goal_participants(user_id, sync_version);
create index goal_participants_goal_status_idx
on public.goal_participants(goal_id, status);

create trigger goal_participants_version_before_update
before insert or update on public.goal_participants
for each row execute function private.bump_row_version();

create or replace function private.validate_canonical_goal_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_goal_id uuid;
  canonical_goal public.goals%rowtype;
begin
  if tg_table_name = 'goals' then
    affected_goal_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    affected_goal_id := case when tg_op = 'DELETE' then old.goal_id else new.goal_id end;
  end if;

  select * into canonical_goal from public.goals g where g.id = affected_goal_id;
  if canonical_goal.id is null then return null; end if;

  if canonical_goal.scope = 'personal' then
    if not exists (
      select 1 from public.personal_goal_details pgd
      where pgd.goal_id = canonical_goal.id and pgd.owner_id = canonical_goal.creator_id
    ) or exists (
      select 1 from public.shared_goal_details sgd where sgd.goal_id = canonical_goal.id
    ) then
      raise exception using errcode = '23514', message = 'invalid_personal_goal_shape';
    end if;
  else
    if canonical_goal.ends_at is null
       or nullif(btrim(canonical_goal.title), '') is null
       or not exists (
         select 1 from public.shared_goal_details sgd where sgd.goal_id = canonical_goal.id
       )
       or exists (
         select 1 from public.personal_goal_details pgd where pgd.goal_id = canonical_goal.id
       ) then
      raise exception using errcode = '23514', message = 'invalid_shared_goal_shape';
    end if;
  end if;

  if not exists (
    select 1 from public.goal_participants gp
    where gp.goal_id = canonical_goal.id
      and gp.user_id = canonical_goal.creator_id
      and gp.role = 'creator'
      and gp.status = 'accepted'
  ) then
    raise exception using errcode = '23514', message = 'goal_creator_participant_required';
  end if;
  return null;
end;
$$;

create constraint trigger goals_validate_shape_after_write
after insert or update on public.goals
deferrable initially deferred
for each row execute function private.validate_canonical_goal_shape();

create constraint trigger personal_goal_details_validate_shape_after_write
after insert or update or delete on public.personal_goal_details
deferrable initially deferred
for each row execute function private.validate_canonical_goal_shape();

create constraint trigger shared_goal_details_validate_shape_after_write
after insert or update or delete on public.shared_goal_details
deferrable initially deferred
for each row execute function private.validate_canonical_goal_shape();

create constraint trigger goal_participants_validate_shape_after_write
after insert or update or delete on public.goal_participants
deferrable initially deferred
for each row execute function private.validate_canonical_goal_shape();

create table public.goal_pause_intervals (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.personal_goal_details(goal_id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint goal_pause_intervals_range check (ended_at is null or ended_at > started_at)
);

create unique index goal_pause_intervals_one_open
on public.goal_pause_intervals(goal_id)
where ended_at is null;
create index goal_pause_intervals_goal_idx
on public.goal_pause_intervals(goal_id, started_at);

create trigger goal_pause_intervals_version_before_update
before insert or update on public.goal_pause_intervals
for each row execute function private.bump_row_version();

create or replace function private.validate_goal_pause_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.goal_id::text, 0));
  if exists (
    select 1
    from public.goal_pause_intervals pause
    where pause.goal_id = new.goal_id
      and pause.id <> new.id
      and pause.started_at < coalesce(new.ended_at, 'infinity'::timestamptz)
      and coalesce(pause.ended_at, 'infinity'::timestamptz) > new.started_at
  ) then
    raise exception using errcode = '23P01', message = 'overlapping_goal_pause_intervals';
  end if;
  return new;
end;
$$;

create trigger goal_pause_intervals_validate_before_write
before insert or update on public.goal_pause_intervals
for each row execute function private.validate_goal_pause_interval();

create table public.study_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null,
  goal_id uuid,
  source text not null check (source in ('timer', 'manual')),
  status text not null default 'completed' check (status = 'completed'),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 604800),
  planned_duration_seconds integer check (
    planned_duration_seconds is null or planned_duration_seconds between 60 and 604800
  ),
  entered_at timestamptz,
  subject_name_snapshot text,
  goal_title_snapshot text,
  legacy_note text,
  legacy_imported boolean not null default false,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint study_sessions_time_range check (ended_at > started_at),
  constraint study_sessions_entered_at check (
    (source = 'manual' and entered_at is not null)
    or (source = 'timer' and entered_at is null)
  ),
  constraint study_sessions_note_length check (legacy_note is null or char_length(legacy_note) <= 4000),
  constraint study_sessions_subject_snapshot_length check (
    subject_name_snapshot is null or char_length(subject_name_snapshot) <= 160
  ),
  constraint study_sessions_goal_snapshot_length check (
    goal_title_snapshot is null or char_length(goal_title_snapshot) <= 160
  ),
  foreign key (subject_id, user_id) references public.subjects(id, owner_id),
  foreign key (goal_id, user_id) references public.goal_participants(goal_id, user_id),
  unique (id, user_id),
  unique (id, user_id, subject_id)
);

create index study_sessions_user_sync_idx on public.study_sessions(user_id, sync_version);
create index study_sessions_user_time_idx on public.study_sessions(user_id, started_at desc)
where deleted_at is null;
create index study_sessions_goal_time_idx on public.study_sessions(goal_id, started_at)
where goal_id is not null and deleted_at is null;
create index study_sessions_subject_time_idx on public.study_sessions(subject_id, started_at desc)
where deleted_at is null;

create trigger study_sessions_version_before_update
before insert or update on public.study_sessions
for each row execute function private.bump_row_version();

create table public.study_session_segments (
  session_id uuid not null,
  ordinal smallint not null check (ordinal >= 0),
  user_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key(session_id, ordinal),
  foreign key (session_id, user_id) references public.study_sessions(id, user_id) on delete cascade,
  constraint study_session_segments_range check (ended_at > started_at)
);

create index study_session_segments_user_sync_idx
on public.study_session_segments(user_id, sync_version);

create trigger study_session_segments_version_before_insert
before insert on public.study_session_segments
for each row execute function private.bump_row_version();

create or replace function private.validate_session_segment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_session public.study_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.session_id::text, 0));

  select * into parent_session
  from public.study_sessions ss
  where ss.id = new.session_id and ss.user_id = new.user_id;

  if parent_session.id is null
     or parent_session.source <> 'timer'
     or new.started_at < parent_session.started_at
     or new.ended_at > parent_session.ended_at then
    raise exception using errcode = '23514', message = 'invalid_session_segment_bounds';
  end if;

  if exists (
    select 1 from public.study_session_segments seg
    where seg.session_id = new.session_id
      and seg.ordinal <> new.ordinal
      and seg.started_at < new.ended_at
      and seg.ended_at > new.started_at
  ) then
    raise exception using errcode = '23P01', message = 'overlapping_session_segments';
  end if;
  return new;
end;
$$;

create trigger study_session_segments_validate_before_write
before insert or update on public.study_session_segments
for each row execute function private.validate_session_segment();

create table public.grades (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null,
  assessment_type text not null check (assessment_type in ('exam', 'other')),
  title text,
  assessment_date date,
  points smallint not null check (points between 0 and 15),
  additional_study_seconds integer not null default 0 check (
    additional_study_seconds between 0 and 31536000
  ),
  subject_name_snapshot text,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint grades_title_length check (title is null or char_length(btrim(title)) between 1 and 120),
  constraint grades_subject_snapshot_length check (
    subject_name_snapshot is null or char_length(subject_name_snapshot) <= 160
  ),
  foreign key (subject_id, user_id) references public.subjects(id, owner_id),
  unique (id, user_id, subject_id)
);

create index grades_user_sync_idx on public.grades(user_id, sync_version);
create index grades_subject_date_idx on public.grades(subject_id, assessment_date desc)
where deleted_at is null;

create trigger grades_version_before_update
before insert or update on public.grades
for each row execute function private.bump_row_version();

create table public.grade_sessions (
  grade_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  subject_id uuid not null,
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key(grade_id, session_id),
  foreign key (grade_id, user_id, subject_id)
    references public.grades(id, user_id, subject_id) on delete cascade,
  foreign key (session_id, user_id, subject_id)
    references public.study_sessions(id, user_id, subject_id) on delete cascade
);

create index grade_sessions_user_sync_idx on public.grade_sessions(user_id, sync_version);

create trigger grade_sessions_version_before_insert
before insert on public.grade_sessions
for each row execute function private.bump_row_version();

create table public.friendships (
  id uuid primary key default extensions.gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  pair_low uuid generated always as (least(requester_id, addressee_id)) stored,
  pair_high uuid generated always as (greatest(requester_id, addressee_id)) stored,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  sync_version bigint not null default 0 check (sync_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_response_state check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

create unique index friendships_one_active_pair
on public.friendships(pair_low, pair_high)
where deleted_at is null and status in ('pending', 'accepted');
create index friendships_requester_sync_idx on public.friendships(requester_id, sync_version);
create index friendships_addressee_sync_idx on public.friendships(addressee_id, sync_version);
create index friendships_declined_cooldown_idx
on public.friendships(pair_low, pair_high, responded_at desc)
where status = 'declined';

create trigger friendships_version_before_update
before insert or update on public.friendships
for each row execute function private.bump_row_version();

create table private.import_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_fingerprint text not null,
  payload_hash text not null,
  expected_counts jsonb not null default '{}'::jsonb,
  status text not null default 'staging' check (
    status in ('staging', 'completed', 'completed_with_conflicts')
  ),
  result jsonb,
  received_chunks integer not null default 0 check (received_chunks between 0 and 1280),
  total_payload_bytes integer not null default 0 check (
    total_payload_bytes between 0 and 33554432
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  constraint import_batches_device_length check (char_length(device_fingerprint) between 8 and 200),
  constraint import_batches_hash_format check (payload_hash ~ '^[a-f0-9]{64}$'),
  unique(user_id, payload_hash)
);

create index import_batches_user_created_idx
on private.import_batches(user_id, created_at desc);
create index import_batches_staging_retention_idx
on private.import_batches(updated_at)
where status = 'staging';

create table private.import_chunks (
  import_id uuid not null references private.import_batches(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0 and chunk_index < 1280),
  chunk_hash text not null check (chunk_hash ~ '^[a-f0-9]{64}$'),
  server_payload_hash text not null check (server_payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(import_id, chunk_index),
  constraint import_chunks_payload_limit check (octet_length(payload::text) <= 262144)
);

create table private.local_id_map (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (
    entity_type in ('subject', 'goal', 'session', 'grade', 'pause_interval')
  ),
  local_id text not null,
  server_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id, entity_type, local_id),
  constraint local_id_map_local_id_length check (char_length(local_id) between 1 and 200)
);

create index local_id_map_server_idx
on private.local_id_map(user_id, entity_type, server_id);

create table private.mutation_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  function_name text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id, operation_id, function_name)
);

create index mutation_receipts_created_idx
on private.mutation_receipts(created_at);

create table private.rpc_rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  occurred_at timestamptz not null default clock_timestamp()
);

create index rpc_rate_limits_window_idx
on private.rpc_rate_limits(user_id, action, occurred_at desc);

commit;
