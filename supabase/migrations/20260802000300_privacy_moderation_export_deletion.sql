begin;

-- Granular, opt-in social privacy. Existing broad grants are migrated only to
-- the closest equivalent fields; newly introduced discovery/avatar grants stay
-- disabled until the account owner explicitly enables them.
alter table public.privacy_settings
  add column share_currently_learning boolean not null default false,
  add column share_pause_status boolean not null default false,
  add column share_last_active_at boolean not null default false,
  add column share_today_activity boolean not null default false,
  add column share_weekly_minutes boolean not null default false,
  add column share_avatar boolean not null default false,
  add column discoverable_by_username boolean not null default false;

update public.privacy_settings
set share_currently_learning = share_timer_stats,
    share_pause_status = share_timer_stats,
    share_last_active_at = share_timer_stats or share_manual_stats,
    share_today_activity = share_timer_stats or share_manual_stats,
    share_weekly_minutes = share_timer_stats and share_manual_stats;

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks(blocked_id, blocker_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public, anon, authenticated;

create table public.community_rule_acceptances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, version),
  constraint community_rule_version_format check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

alter table public.community_rule_acceptances enable row level security;
revoke all on public.community_rule_acceptances from public, anon, authenticated;

create table public.content_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'profile', 'profile_name', 'profile_image',
    'group', 'group_name', 'group_image',
    'shared_goal', 'shared_session'
  )),
  entity_id uuid not null,
  reason text not null check (reason in (
    'harassment', 'hate', 'sexual_content', 'violence',
    'spam', 'impersonation', 'privacy', 'other'
  )),
  description text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  moderation_action text not null default 'none' check (moderation_action in ('none', 'hide', 'remove')),
  resolution_note text,
  moderator_reference text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  moderated_at timestamptz,
  constraint content_report_description_length check (
    description is null or char_length(btrim(description)) between 1 and 500
  ),
  constraint content_report_resolution_length check (
    resolution_note is null or char_length(resolution_note) <= 500
  ),
  constraint content_report_moderator_reference_length check (
    moderator_reference is null or char_length(moderator_reference) <= 100
  )
);

create index content_reports_reporter_idx
on public.content_reports(reporter_id, created_at desc);
create index content_reports_moderation_queue_idx
on public.content_reports(status, created_at)
where status in ('open', 'reviewing');
create unique index content_reports_one_open_target
on public.content_reports(reporter_id, entity_type, entity_id)
where status in ('open', 'reviewing');

alter table public.content_reports enable row level security;
revoke all on public.content_reports from public, anon, authenticated;

create or replace function private.is_blocked_between(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_left and b.blocked_id = p_right)
       or (b.blocker_id = p_right and b.blocked_id = p_left)
  );
$$;

create or replace function private.are_friends(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_blocked_between(p_left, p_right)
    and exists (
      select 1
      from public.friendships f
      where f.pair_low = least(p_left, p_right)
        and f.pair_high = greatest(p_left, p_right)
        and f.status = 'accepted'
        and f.deleted_at is null
    );
$$;

create or replace function private.has_current_community_rules_acceptance(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.community_rule_acceptances a
    where a.user_id = p_user_id and a.version = '2026-08-02'
  );
$$;

-- The prior generic quota trigger referenced fields from multiple record
-- shapes in combined boolean expressions. PostgreSQL can resolve those fields
-- before short-circuiting, so keep every table-specific record access inside
-- its own branch.
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
  elsif tg_table_name = 'goals' then
    if new.scope = 'shared' then
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
    end if;
  elsif tg_table_name = 'friendships' then
    if new.status = 'pending' then
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
  end if;
  return new;
end;
$$;

create or replace function public.accept_community_rules(p_version text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  accepted public.community_rule_acceptances%rowtype;
begin
  if p_version is distinct from '2026-08-02' then
    raise exception using errcode = '22023', message = 'community_rules_version_outdated';
  end if;

  insert into public.community_rule_acceptances(user_id, version)
  values (actor, p_version)
  on conflict (user_id, version) do update
  set accepted_at = public.community_rule_acceptances.accepted_at
  returning * into accepted;

  return jsonb_build_object(
    'accepted', true,
    'version', accepted.version,
    'accepted_at', accepted.accepted_at
  );
end;
$$;

create or replace function public.get_community_rules_acceptance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  accepted_at_value timestamptz;
begin
  select a.accepted_at into accepted_at_value
  from public.community_rule_acceptances a
  where a.user_id = actor and a.version = '2026-08-02';

  return jsonb_build_object(
    'accepted', accepted_at_value is not null,
    'version', '2026-08-02',
    'accepted_at', accepted_at_value
  );
end;
$$;

-- Registration metadata is an explicit declaration created only after the UI
-- checkbox was selected. Existing accounts must accept from the legal screen.
create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  perform private.ensure_profile(new.id, metadata - 'avatar_url' - 'picture');
  if metadata ->> 'community_rules_version' = '2026-08-02'
     and metadata ? 'community_rules_accepted_at' then
    insert into public.community_rule_acceptances(user_id, version, accepted_at)
    values (new.id, '2026-08-02', clock_timestamp())
    on conflict (user_id, version) do nothing;
  end if;
  return new;
end;
$$;

create or replace function private.require_rules_for_shared_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if not private.has_current_community_rules_acceptance(actor) then
    raise exception using errcode = '42501', message = 'community_rules_acceptance_required';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_rules_before_public_edit on public.profiles;
create trigger profiles_require_rules_before_public_edit
before update of username, display_name, avatar_url on public.profiles
for each row
when (
  old.username is distinct from new.username
  or old.display_name is distinct from new.display_name
  or old.avatar_url is distinct from new.avatar_url
)
execute function private.require_rules_for_shared_content();

drop trigger if exists study_groups_require_rules_before_write on public.study_groups;
create trigger study_groups_require_rules_before_write
before insert or update of name, image_url on public.study_groups
for each row execute function private.require_rules_for_shared_content();

drop trigger if exists shared_sessions_require_rules_before_write on public.shared_study_sessions;
create trigger shared_sessions_require_rules_before_write
before insert or update of title on public.shared_study_sessions
for each row execute function private.require_rules_for_shared_content();

create or replace function private.require_rules_for_shared_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is not null
     and new.scope = 'shared'
     and not private.has_current_community_rules_acceptance(actor) then
    raise exception using errcode = '42501', message = 'community_rules_acceptance_required';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_goals_require_rules_before_write on public.goals;
create trigger shared_goals_require_rules_before_write
before insert or update of title on public.goals
for each row execute function private.require_rules_for_shared_goal();

-- Storage remains public for backward-compatible profile rendering, but only
-- users who accepted the current rules can upload new user-generated images.
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and coalesce(
    (public.get_community_rules_acceptance() ->> 'accepted')::boolean,
    false
  )
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
);

drop function if exists public.update_privacy_settings(boolean, boolean, boolean, boolean, integer);
create or replace function public.update_privacy_settings(
  p_share_timer_stats boolean,
  p_share_manual_stats boolean,
  p_share_goal_progress boolean,
  p_share_streak boolean,
  p_share_currently_learning boolean,
  p_share_pause_status boolean,
  p_share_last_active_at boolean,
  p_share_today_activity boolean,
  p_share_weekly_minutes boolean,
  p_share_avatar boolean,
  p_discoverable_by_username boolean,
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
      share_streak = p_share_streak,
      share_currently_learning = p_share_currently_learning,
      share_pause_status = p_share_pause_status,
      share_last_active_at = p_share_last_active_at,
      share_today_activity = p_share_today_activity,
      share_weekly_minutes = p_share_weekly_minutes,
      share_avatar = p_share_avatar,
      discoverable_by_username = p_discoverable_by_username
  where ps.user_id = actor and ps.revision = p_expected_revision
  returning ps.* into updated_privacy;

  if updated_privacy.user_id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  return to_jsonb(updated_privacy);
end;
$$;

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
    'avatar_url', case
      when p.id = auth.uid() or coalesce(ps.share_avatar, false) then p.avatar_url
      else null
    end
  )
  from public.profiles p
  left join public.privacy_settings ps on ps.user_id = p.id
  where p.id = p_user_id;
$$;

create or replace function public.find_profile_by_exact_username(p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  if exists (select 1 from public.profiles p where p.id = actor and p.username_needs_review) then
    raise exception using errcode = 'P0001', message = 'username_review_required';
  end if;
  perform private.consume_rate_limit(actor, 'username_search', 30, interval '1 minute');

  return (
    select jsonb_build_object(
      'user', private.basic_social_profile(p.id),
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
    join public.privacy_settings ps on ps.user_id = p.id
    where p.username = lower(btrim(p_username))
      and p.id <> actor
      and not p.username_needs_review
      and ps.discoverable_by_username
      and not private.is_blocked_between(actor, p.id)
    limit 1
  );
end;
$$;

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
    'direction', case when p_friendship.requester_id = p_actor then 'outgoing' else 'incoming' end,
    'responded_at', p_friendship.responded_at,
    'created_at', p_friendship.created_at,
    'updated_at', p_friendship.updated_at,
    'user', private.basic_social_profile(case
      when p_friendship.requester_id = p_actor then p_friendship.addressee_id
      else p_friendship.requester_id
    end)
  );
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
  if exists (select 1 from public.profiles p where p.id = actor and p.username_needs_review) then
    raise exception using errcode = 'P0001', message = 'username_review_required';
  end if;
  perform private.consume_rate_limit(actor, 'friend_request', 10, interval '1 hour');

  select p.id into target_id
  from public.profiles p
  join public.privacy_settings ps on ps.user_id = p.id
  where p.username = lower(btrim(p_username))
    and not p.username_needs_review
    and ps.discoverable_by_username
    and not private.is_blocked_between(actor, p.id);

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

  insert into public.friendships(requester_id, addressee_id)
  values (actor, target_id)
  returning * into saved;
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
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'connections', coalesce((
      select jsonb_agg(private.friendship_read_model(f, actor) order by f.updated_at desc)
      from public.friendships f
      where (f.requester_id = actor or f.addressee_id = actor)
        and f.deleted_at is null
        and f.status in ('pending', 'accepted')
        and not private.is_blocked_between(f.requester_id, f.addressee_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.block_user(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  if p_user_id is null or p_user_id = actor
     or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'invalid_block_target';
  end if;
  perform private.consume_rate_limit(actor, 'user_block', 30, interval '1 hour');

  insert into public.user_blocks(blocker_id, blocked_id)
  values (actor, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  update public.friendships f
  set deleted_at = clock_timestamp()
  where f.pair_low = least(actor, p_user_id)
    and f.pair_high = greatest(actor, p_user_id)
    and f.status = 'pending'
    and f.deleted_at is null;

  delete from public.goal_participants gp
  where gp.status = 'invited'
    and ((gp.user_id = actor and gp.invited_by = p_user_id)
      or (gp.user_id = p_user_id and gp.invited_by = actor));
  delete from public.study_group_members gm
  where gm.status = 'invited'
    and ((gm.user_id = actor and gm.invited_by = p_user_id)
      or (gm.user_id = p_user_id and gm.invited_by = actor));
  delete from public.shared_study_session_participants sp
  where sp.status = 'invited'
    and ((sp.user_id = actor and sp.invited_by = p_user_id)
      or (sp.user_id = p_user_id and sp.invited_by = actor));

  return jsonb_build_object('blocked', true, 'user_id', p_user_id);
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  delete from public.user_blocks b
  where b.blocker_id = actor and b.blocked_id = p_user_id;
  return jsonb_build_object('blocked', false, 'user_id', p_user_id);
end;
$$;

create or replace function public.list_my_blocked_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  return jsonb_build_object(
    'blocked_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user', jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'avatar_url', null
        ),
        'blocked_at', b.created_at
      ) order by b.created_at desc)
      from public.user_blocks b
      join public.profiles p on p.id = b.blocked_id
      where b.blocker_id = actor
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.reject_blocked_goal_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'invited' and new.invited_by is not null
     and private.is_blocked_between(new.invited_by, new.user_id) then
    raise exception using errcode = '42501', message = 'social_invitation_not_allowed';
  end if;
  return new;
end;
$$;

create or replace function private.reject_blocked_group_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'invited' and new.invited_by is not null
     and private.is_blocked_between(new.invited_by, new.user_id) then
    raise exception using errcode = '42501', message = 'social_invitation_not_allowed';
  end if;
  return new;
end;
$$;

create or replace function private.reject_blocked_session_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'invited' and new.invited_by is not null
     and private.is_blocked_between(new.invited_by, new.user_id) then
    raise exception using errcode = '42501', message = 'social_invitation_not_allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists goal_participants_reject_blocked_invite on public.goal_participants;
create trigger goal_participants_reject_blocked_invite
before insert or update on public.goal_participants
for each row execute function private.reject_blocked_goal_invitation();

drop trigger if exists group_members_reject_blocked_invite on public.study_group_members;
create trigger group_members_reject_blocked_invite
before insert or update on public.study_group_members
for each row execute function private.reject_blocked_group_invitation();

drop trigger if exists session_participants_reject_blocked_invite on public.shared_study_session_participants;
create trigger session_participants_reject_blocked_invite
before insert or update on public.shared_study_session_participants
for each row execute function private.reject_blocked_session_invitation();

create or replace function private.friend_overview_read_model(p_friend_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  friend_profile public.profiles%rowtype;
  privacy public.privacy_settings%rowtype;
  presence public.learning_presence%rowtype;
  presence_fresh boolean := false;
  presence_status_value text := 'offline';
  today_minutes_value integer;
  week_minutes_value integer;
  streak_value integer;
  local_day_start timestamptz;
  local_week_start timestamptz;
  shared_goal_ids jsonb;
  shared_session_ids jsonb;
  shared_group_ids jsonb;
begin
  if not private.are_friends(p_actor, p_friend_id) then
    raise exception using errcode = '42501', message = 'friendship_required';
  end if;

  select * into friend_profile from public.profiles p where p.id = p_friend_id;
  select * into privacy from public.privacy_settings ps where ps.user_id = p_friend_id;
  select * into presence from public.learning_presence lp where lp.user_id = p_friend_id;

  presence_fresh := presence.user_id is not null and presence.expires_at > clock_timestamp();
  if privacy.share_currently_learning and presence_fresh then
    presence_status_value := case
      when presence.state = 'learning' then 'learning'
      when presence.state = 'paused' and privacy.share_pause_status then 'paused'
      else 'online'
    end;
  end if;

  local_day_start := date_trunc('day', clock_timestamp() at time zone friend_profile.time_zone)
    at time zone friend_profile.time_zone;
  local_week_start := date_trunc('week', clock_timestamp() at time zone friend_profile.time_zone)
    at time zone friend_profile.time_zone;

  if privacy.share_today_activity then
    select coalesce(floor(sum(s.duration_seconds) / 60.0), 0)::integer
    into today_minutes_value
    from public.study_sessions s
    where s.user_id = p_friend_id and s.deleted_at is null and s.ended_at >= local_day_start;
  end if;
  if privacy.share_weekly_minutes then
    select coalesce(floor(sum(s.duration_seconds) / 60.0), 0)::integer
    into week_minutes_value
    from public.study_sessions s
    where s.user_id = p_friend_id and s.deleted_at is null and s.ended_at >= local_week_start;
  end if;
  if privacy.share_streak then
    streak_value := private.current_streak_days(p_friend_id, friend_profile.time_zone);
  end if;

  select coalesce(jsonb_agg(g.id order by g.starts_at desc), '[]'::jsonb)
  into shared_goal_ids
  from public.goals g
  join public.goal_participants mine on mine.goal_id = g.id and mine.user_id = p_actor and mine.status = 'accepted'
  join public.goal_participants theirs on theirs.goal_id = g.id and theirs.user_id = p_friend_id and theirs.status = 'accepted'
  where g.scope = 'shared' and g.deleted_at is null;

  select coalesce(jsonb_agg(s.id order by s.starts_at desc), '[]'::jsonb)
  into shared_session_ids
  from public.shared_study_sessions s
  join public.shared_study_session_participants mine on mine.session_id = s.id and mine.user_id = p_actor
    and mine.status in ('joined', 'active', 'paused', 'finished')
  join public.shared_study_session_participants theirs on theirs.session_id = s.id and theirs.user_id = p_friend_id
    and theirs.status in ('joined', 'active', 'paused', 'finished')
  where s.status <> 'cancelled';

  select coalesce(jsonb_agg(g.id order by g.created_at desc), '[]'::jsonb)
  into shared_group_ids
  from public.study_groups g
  join public.study_group_members mine on mine.group_id = g.id and mine.user_id = p_actor and mine.status = 'accepted'
  join public.study_group_members theirs on theirs.group_id = g.id and theirs.user_id = p_friend_id and theirs.status = 'accepted';

  return jsonb_build_object(
    'friend', private.basic_social_profile(p_friend_id),
    'presence_status', presence_status_value,
    'last_active_at', case when privacy.share_last_active_at then presence.last_study_at else null end,
    'today_minutes', today_minutes_value,
    'week_minutes', week_minutes_value,
    'streak_days', streak_value,
    'shared_goal_ids', shared_goal_ids,
    'shared_session_ids', shared_session_ids,
    'shared_group_ids', shared_group_ids
  );
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
          and f.status = 'accepted' and f.deleted_at is null
          and not private.is_blocked_between(f.requester_id, f.addressee_id)
      ), models as (
        select private.friend_overview_read_model(fi.friend_id, actor) as model from friend_ids fi
      )
      select jsonb_agg(model order by model -> 'friend' ->> 'username') from models
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_content_report(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_description text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  saved public.content_reports%rowtype;
  target_visible boolean := false;
begin
  if p_entity_type not in (
    'profile', 'profile_name', 'profile_image',
    'group', 'group_name', 'group_image', 'shared_goal', 'shared_session'
  ) or p_reason not in (
    'harassment', 'hate', 'sexual_content', 'violence',
    'spam', 'impersonation', 'privacy', 'other'
  ) then
    raise exception using errcode = '22023', message = 'invalid_report';
  end if;
  if p_description is not null and char_length(btrim(p_description)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid_report_description';
  end if;

  perform private.consume_rate_limit(actor, 'content_report', 10, interval '1 day');

  if p_entity_type in ('profile', 'profile_name', 'profile_image') then
    target_visible := p_entity_id <> actor and exists (
      select 1 from public.profiles p
      where p.id = p_entity_id and (
        exists (
          select 1 from public.friendships f
          where f.pair_low = least(actor, p.id) and f.pair_high = greatest(actor, p.id)
            and f.status = 'accepted' and f.deleted_at is null
        )
        or private.is_blocked_between(actor, p.id)
        or exists (
          select 1 from public.study_group_members mine
          join public.study_group_members theirs on theirs.group_id = mine.group_id
          where mine.user_id = actor and mine.status = 'accepted'
            and theirs.user_id = p.id and theirs.status = 'accepted'
        )
        or exists (
          select 1 from public.privacy_settings ps
          where ps.user_id = p.id and ps.discoverable_by_username
        )
      )
    );
  elsif p_entity_type in ('group', 'group_name', 'group_image') then
    target_visible := exists (
      select 1 from public.study_group_members gm
      where gm.group_id = p_entity_id and gm.user_id = actor and gm.status in ('invited', 'accepted')
    );
  elsif p_entity_type = 'shared_goal' then
    target_visible := exists (
      select 1 from public.goal_participants gp
      join public.goals g on g.id = gp.goal_id
      where gp.goal_id = p_entity_id and gp.user_id = actor
        and gp.status in ('invited', 'accepted') and g.scope = 'shared' and g.deleted_at is null
    );
  elsif p_entity_type = 'shared_session' then
    target_visible := exists (
      select 1 from public.shared_study_session_participants sp
      where sp.session_id = p_entity_id and sp.user_id = actor
        and sp.status in ('invited', 'joined', 'active', 'paused', 'finished')
    );
  end if;

  if not target_visible then
    raise exception using errcode = '42501', message = 'report_target_not_available';
  end if;

  insert into public.content_reports(reporter_id, entity_type, entity_id, reason, description)
  values (actor, p_entity_type, p_entity_id, p_reason, nullif(btrim(p_description), ''))
  returning * into saved;

  return jsonb_build_object('id', saved.id, 'status', saved.status, 'created_at', saved.created_at);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'report_already_open';
end;
$$;

-- Service-role-only operator path. The client has no grant and never receives
-- an administrative secret. The operator reference should be a short internal
-- ticket or role identifier, not a copy of personal data.
create or replace function public.moderate_content_report(
  p_report_id uuid,
  p_status text,
  p_action text,
  p_resolution_note text default null,
  p_moderator_reference text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare report_row public.content_reports%rowtype;
begin
  if p_status not in ('reviewing', 'resolved', 'rejected')
     or p_action not in ('none', 'hide', 'remove') then
    raise exception using errcode = '22023', message = 'invalid_moderation_transition';
  end if;

  select * into report_row from public.content_reports r where r.id = p_report_id for update;
  if report_row.id is null then
    raise exception using errcode = 'P0001', message = 'report_not_found';
  end if;

  if p_action in ('hide', 'remove') then
    case
      when report_row.entity_type in ('profile', 'profile_name') then
        update public.profiles p
        set username = 'moderated_' || substr(replace(p.id::text, '-', ''), 1, 12),
            display_name = 'Moderiertes Profil',
            avatar_url = null,
            username_needs_review = true
        where p.id = report_row.entity_id;
      when report_row.entity_type = 'profile_image' then
        update public.profiles p set avatar_url = null where p.id = report_row.entity_id;
      when report_row.entity_type in ('group', 'group_name') then
        update public.study_groups g
        set name = 'Moderierter Inhalt', image_url = null, icon = 'shield'
        where g.id = report_row.entity_id;
      when report_row.entity_type = 'group_image' then
        update public.study_groups g set image_url = null where g.id = report_row.entity_id;
      when report_row.entity_type = 'shared_goal' then
        update public.goals g
        set title = 'Moderierter Inhalt', deleted_at = clock_timestamp()
        where g.id = report_row.entity_id and g.scope = 'shared';
      when report_row.entity_type = 'shared_session' then
        update public.shared_study_sessions s
        set title = 'Moderierter Inhalt', status = 'cancelled',
            completed_at = null,
            cancelled_at = coalesce(s.cancelled_at, clock_timestamp())
        where s.id = report_row.entity_id and s.status <> 'cancelled';
      else null;
    end case;
  end if;

  update public.content_reports r
  set status = p_status,
      moderation_action = p_action,
      resolution_note = nullif(btrim(p_resolution_note), ''),
      moderator_reference = nullif(btrim(p_moderator_reference), ''),
      moderated_at = case when p_status in ('resolved', 'rejected') then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where r.id = p_report_id
  returning * into report_row;

  return jsonb_build_object('id', report_row.id, 'status', report_row.status, 'action', report_row.moderation_action);
end;
$$;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor uuid := private.current_actor();
begin
  perform private.consume_rate_limit(actor, 'data_export', 5, interval '1 day');
  return jsonb_build_object(
    'schema_version', 1,
    'exported_at', clock_timestamp(),
    'profile', (
      select to_jsonb(p) || jsonb_build_object('email', u.email)
      from public.profiles p join auth.users u on u.id = p.id where p.id = actor
    ),
    'privacy_settings', (select to_jsonb(ps) from public.privacy_settings ps where ps.user_id = actor),
    'subjects', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.subjects s where s.owner_id = actor), '[]'::jsonb),
    'study_sessions', coalesce((
      select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'segments', coalesce((select jsonb_agg(to_jsonb(seg) order by seg.started_at) from public.study_session_segments seg where seg.session_id = s.id), '[]'::jsonb)
      ) order by s.started_at)
      from public.study_sessions s where s.user_id = actor
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(to_jsonb(g) || jsonb_build_object(
        'session_ids', coalesce((select jsonb_agg(gs.session_id) from public.grade_sessions gs where gs.grade_id = g.id), '[]'::jsonb)
      ) order by g.created_at)
      from public.grades g where g.user_id = actor
    ), '[]'::jsonb),
    'personal_goals', coalesce((
      select jsonb_agg(to_jsonb(g) || jsonb_build_object('details', to_jsonb(pgd)) order by g.created_at)
      from public.goals g join public.personal_goal_details pgd on pgd.goal_id = g.id
      where pgd.owner_id = actor
    ), '[]'::jsonb),
    'shared_goal_contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'goal', jsonb_build_object('id', g.id, 'title', g.title, 'status', g.status, 'starts_at', g.starts_at, 'ends_at', g.ends_at),
        'participation', to_jsonb(gp)
      ) order by gp.created_at)
      from public.goal_participants gp join public.goals g on g.id = gp.goal_id
      where gp.user_id = actor and g.scope = 'shared'
    ), '[]'::jsonb),
    'shared_session_contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session', jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'starts_at', s.starts_at),
        'participation', to_jsonb(sp)
      ) order by sp.created_at)
      from public.shared_study_session_participants sp
      join public.shared_study_sessions s on s.id = sp.session_id
      where sp.user_id = actor
    ), '[]'::jsonb),
    'group_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group', jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at),
        'membership', to_jsonb(gm)
      ) order by gm.created_at)
      from public.study_group_members gm join public.study_groups g on g.id = gm.group_id
      where gm.user_id = actor
    ), '[]'::jsonb),
    'friendships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'other_user_id', case when f.requester_id = actor then f.addressee_id else f.requester_id end,
        'direction', case when f.requester_id = actor then 'outgoing' else 'incoming' end,
        'status', f.status,
        'created_at', f.created_at,
        'responded_at', f.responded_at,
        'deleted_at', f.deleted_at
      ) order by f.created_at)
      from public.friendships f where f.requester_id = actor or f.addressee_id = actor
    ), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.user_blocks b where b.blocker_id = actor), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
        'reason', r.reason, 'description', r.description,
        'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.created_at)
      from public.content_reports r where r.reporter_id = actor
    ), '[]'::jsonb),
    'community_rule_acceptances', coalesce((select jsonb_agg(to_jsonb(a) order by a.accepted_at) from public.community_rule_acceptances a where a.user_id = actor), '[]'::jsonb)
  );
end;
$$;

-- Called only by the authenticated Edge Function through the service role.
-- It transfers shared ownership before auth.users deletion can cascade.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  group_row record;
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

  for group_row in select g.id from public.study_groups g where g.creator_id = p_user_id order by g.id loop
    select gm.user_id into successor
    from public.study_group_members gm
    where gm.group_id = group_row.id and gm.user_id <> p_user_id and gm.status = 'accepted'
    order by gm.accepted_at nulls last, gm.created_at, gm.user_id
    limit 1;

    if successor is null then
      delete from public.goals g using public.shared_goal_details sgd
      where g.id = sgd.goal_id and sgd.group_id = group_row.id;
      delete from public.shared_study_sessions s where s.group_id = group_row.id;
      delete from public.study_groups g where g.id = group_row.id;
    else
      update public.study_group_members gm set role = 'member'
      where gm.group_id = group_row.id and gm.user_id = p_user_id;
      update public.study_group_members gm set role = 'creator'
      where gm.group_id = group_row.id and gm.user_id = successor;
      update public.study_groups g set creator_id = successor where g.id = group_row.id;
      transferred_groups := transferred_groups + 1;
    end if;
  end loop;

  for goal_row in
    select g.id, sgd.group_id from public.goals g
    join public.shared_goal_details sgd on sgd.goal_id = g.id
    where g.creator_id = p_user_id and g.scope = 'shared' and g.deleted_at is null
    order by g.id
  loop
    successor := null;
    if goal_row.group_id is not null then
      select g.creator_id into successor from public.study_groups g where g.id = goal_row.group_id;
    end if;
    if successor is null or successor = p_user_id then
      select gp.user_id into successor
      from public.goal_participants gp
      where gp.goal_id = goal_row.id and gp.user_id <> p_user_id and gp.status = 'accepted'
      order by gp.accepted_at nulls last, gp.created_at, gp.user_id limit 1;
    end if;
    if successor is null then
      delete from public.goals g where g.id = goal_row.id;
    else
      update public.goal_participants gp set role = 'member'
      where gp.goal_id = goal_row.id and gp.user_id = p_user_id;
      update public.goal_participants gp set role = 'creator'
      where gp.goal_id = goal_row.id and gp.user_id = successor;
      update public.goals g set creator_id = successor where g.id = goal_row.id;
      transferred_goals := transferred_goals + 1;
    end if;
  end loop;

  for session_row in
    select s.id, s.group_id from public.shared_study_sessions s
    where s.creator_id = p_user_id order by s.id
  loop
    successor := null;
    if session_row.group_id is not null then
      select g.creator_id into successor from public.study_groups g where g.id = session_row.group_id;
    end if;
    if successor is null or successor = p_user_id then
      select sp.user_id into successor
      from public.shared_study_session_participants sp
      where sp.session_id = session_row.id and sp.user_id <> p_user_id
        and sp.status in ('joined', 'active', 'paused', 'finished')
      order by sp.joined_at nulls last, sp.created_at, sp.user_id limit 1;
    end if;
    if successor is null then
      delete from public.shared_study_sessions s where s.id = session_row.id;
    else
      update public.shared_study_session_participants sp set role = 'member'
      where sp.session_id = session_row.id and sp.user_id = p_user_id;
      update public.shared_study_session_participants sp set role = 'creator'
      where sp.session_id = session_row.id and sp.user_id = successor;
      update public.shared_study_sessions s set creator_id = successor where s.id = session_row.id;
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

revoke all on function private.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_current_community_rules_acceptance(uuid) from public, anon, authenticated;
revoke all on function private.enforce_social_row_quota() from public, anon, authenticated;
revoke all on function private.require_rules_for_shared_content() from public, anon, authenticated;
revoke all on function private.require_rules_for_shared_goal() from public, anon, authenticated;
revoke all on function private.reject_blocked_goal_invitation() from public, anon, authenticated;
revoke all on function private.reject_blocked_group_invitation() from public, anon, authenticated;
revoke all on function private.reject_blocked_session_invitation() from public, anon, authenticated;
revoke all on function public.accept_community_rules(text) from public, anon, authenticated;
revoke all on function public.get_community_rules_acceptance() from public, anon, authenticated;
revoke all on function public.update_privacy_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer) from public, anon, authenticated;
revoke all on function public.find_profile_by_exact_username(text) from public, anon, authenticated;
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
revoke all on function public.list_friend_connections() from public, anon, authenticated;
revoke all on function public.block_user(uuid) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid) from public, anon, authenticated;
revoke all on function public.list_my_blocked_profiles() from public, anon, authenticated;
revoke all on function public.list_friend_overviews() from public, anon, authenticated;
revoke all on function public.submit_content_report(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.moderate_content_report(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.export_my_data() from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated, service_role;

grant execute on function public.accept_community_rules(text) to authenticated;
grant execute on function public.get_community_rules_acceptance() to authenticated;
grant execute on function public.update_privacy_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer) to authenticated;
grant execute on function public.find_profile_by_exact_username(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.list_friend_connections() to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_my_blocked_profiles() to authenticated;
grant execute on function public.list_friend_overviews() to authenticated;
grant execute on function public.submit_content_report(text, uuid, text, text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.moderate_content_report(uuid, text, text, text, text) to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

commit;
