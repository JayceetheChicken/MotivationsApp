begin;

-- Profile pictures are public assets, but uploads are deliberately limited to
-- small raster images below the authenticated user's canonical profile folder.
update storage.buckets
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'avatars';

drop policy if exists "Avatar images are publicly readable" on storage.objects;
drop policy if exists "Users can upload their own avatar" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can delete their own avatar" on storage.objects;
drop policy if exists "Users can read their own avatar metadata" on storage.objects;

create policy "Users can read their own avatar metadata"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

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
    when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
      then (metadata ->> 'size')::bigint
    else 0
  end between 1 and 5242880
  and (
    (name ~ '\.jpg$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/jpeg')
    or (name ~ '\.png$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/png')
    or (name ~ '\.webp$' and lower(coalesce(metadata ->> 'mimetype', '')) = 'image/webp')
  )
);

-- Deletion remains broad inside the caller's own folder so clients can remove
-- legacy `<uid>/avatar.ext` objects after a successful replacement. The
-- current object itself is protected, including during cross-device races.
create policy "Users can delete their own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.avatar_url is not null
      and right(
        split_part(p.avatar_url, '?', 1),
        char_length('/storage/v1/object/public/avatars/' || name)
      ) = '/storage/v1/object/public/avatars/' || name
  )
);

-- Existing third-party image URLs can reveal a user's IP address to an
-- unrelated host. Keep only legacy images that already live in this user's
-- own public avatar folder; all future changes use set_my_avatar().
update public.profiles p
set avatar_url = null
where p.avatar_url is not null
  and not (
    p.avatar_url ~ (
      '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
      || p.id::text
      || '/(avatar\.(jpg|jpeg|png|webp)|profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp))([?]v=[A-Za-z0-9-]+)?$'
    )
    or p.avatar_url ~ (
      '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/storage/v1/object/public/avatars/'
      || p.id::text
      || '/(avatar\.(jpg|jpeg|png|webp)|profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp))([?]v=[A-Za-z0-9-]+)?$'
    )
  );

alter table public.profiles drop constraint if exists profiles_avatar_https;
alter table public.profiles
  add constraint profiles_avatar_https check (
    avatar_url is null
    or (
      char_length(avatar_url) <= 2048
      and (
        avatar_url ~ (
          '^https://[^/?#]+/storage/v1/object/public/avatars/'
          || id::text
          || '/(avatar\.(jpg|jpeg|png|webp)|profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp))([?]v=[A-Za-z0-9-]+)?$'
        )
        or avatar_url ~ (
          '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/storage/v1/object/public/avatars/'
          || id::text
          || '/(avatar\.(jpg|jpeg|png|webp)|profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp))([?]v=[A-Za-z0-9-]+)?$'
        )
      )
    )
  );

-- OAuth/auth metadata is untrusted input. A profile starts without an avatar
-- and can receive one only after the corresponding Storage object exists.
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

  begin
    perform now() at time zone chosen_time_zone;
  exception when invalid_parameter_value then
    chosen_time_zone := 'UTC';
  end;

  begin
    insert into public.profiles(
      id, username, display_name, time_zone, username_needs_review
    ) values (
      p_user_id, chosen_username, chosen_display_name, chosen_time_zone, needs_review
    );
  exception when unique_violation then
    insert into public.profiles(
      id, username, display_name, time_zone, username_needs_review
    ) values (
      p_user_id,
      'user_' || substr(replace(p_user_id::text, '-', ''), 1, 12),
      chosen_display_name,
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
  perform private.ensure_profile(
    new.id,
    coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'avatar_url' - 'picture'
  );
  return new;
end;
$$;

-- General profile edits may preserve the existing avatar, but only the
-- Storage-backed avatar RPC below is allowed to change it.
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
  current_profile public.profiles%rowtype;
  requested_avatar text := nullif(btrim(p_avatar_url), '');
  updated_profile public.profiles%rowtype;
begin
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected_revision_required';
  end if;

  select * into current_profile
  from public.profiles p
  where p.id = actor
  for update;

  if current_profile.id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  if requested_avatar is distinct from current_profile.avatar_url then
    raise exception using errcode = '42501', message = 'avatar_update_requires_storage';
  end if;

  update public.profiles p
  set username = lower(btrim(p_username)),
      display_name = btrim(p_display_name),
      time_zone = p_time_zone,
      username_needs_review = false
  where p.id = actor
    and p.revision = p_expected_revision
  returning p.* into updated_profile;

  if updated_profile.id is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  return to_jsonb(updated_profile);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'username_taken';
end;
$$;

revoke all on function public.update_my_profile(text, text, text, text, integer)
from public, anon, authenticated;
grant execute on function public.update_my_profile(text, text, text, text, integer)
to authenticated;

create or replace function public.set_my_avatar(p_object_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_actor();
  issuer text := coalesce(
    nullif(auth.jwt() ->> 'iss', ''),
    nullif(current_setting('request.jwt.claim.iss', true), '')
  );
  project_url text;
  object_metadata jsonb;
  object_size bigint;
  object_mime text;
  canonical_url text;
  previous_avatar_url text;
  updated_profile public.profiles%rowtype;
begin
  if p_object_path is null or p_object_path !~ (
    '^' || actor::text || '/profile/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    || '\.(jpg|png|webp)$'
  ) then
    raise exception using errcode = '22023', message = 'invalid_avatar_object_path';
  end if;

  select o.metadata into object_metadata
  from storage.objects o
  where o.bucket_id = 'avatars' and o.name = p_object_path;
  if object_metadata is null then
    raise exception using errcode = 'P0001', message = 'avatar_object_not_found';
  end if;

  object_mime := lower(coalesce(object_metadata ->> 'mimetype', ''));
  begin
    object_size := (object_metadata ->> 'size')::bigint;
  exception when others then
    object_size := 0;
  end;
  if object_mime not in ('image/jpeg', 'image/png', 'image/webp')
     or object_size not between 1 and 5242880
     or not (
       (p_object_path ~ '\.jpg$' and object_mime = 'image/jpeg')
       or (p_object_path ~ '\.png$' and object_mime = 'image/png')
       or (p_object_path ~ '\.webp$' and object_mime = 'image/webp')
     ) then
    raise exception using errcode = '22023', message = 'invalid_avatar_object';
  end if;

  if issuer is null or issuer !~ '/auth/v1/?$' or not (
    issuer ~ '^https://'
    or issuer ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'
  ) then
    raise exception using errcode = '22023', message = 'invalid_auth_issuer';
  end if;
  project_url := regexp_replace(issuer, '/auth/v1/?$', '');
  canonical_url := project_url
    || '/storage/v1/object/public/avatars/'
    || p_object_path
    || '?v=' || extensions.gen_random_uuid()::text;

  -- The profile row lock serialises replacements across devices. Returning
  -- the exact previous URL lets the winning client delete only that object,
  -- never a newer avatar uploaded concurrently on another device.
  select p.avatar_url into previous_avatar_url
  from public.profiles p
  where p.id = actor
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  update public.profiles p
  set avatar_url = canonical_url
  where p.id = actor
  returning p.* into updated_profile;
  if updated_profile.id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  return jsonb_build_object(
    'profile', to_jsonb(updated_profile),
    'object_path', p_object_path,
    'previous_avatar_url', previous_avatar_url
  );
end;
$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- Orphan cleanup is deliberately selected by the server and delayed for a
-- full day. A freshly uploaded object on another device therefore cannot be
-- mistaken for garbage in the short window before set_my_avatar commits.
create or replace function public.list_my_stale_avatar_objects()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select private.current_actor() as id
  ), stale as (
    select o.name
    from storage.objects o
    cross join actor a
    where o.bucket_id = 'avatars'
      and (storage.foldername(o.name))[1] = a.id::text
      and o.created_at <= now() - interval '24 hours'
      and (
        o.name ~ (
          '^' || a.id::text
          || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
          || '\.(jpg|png|webp)$'
        )
        or o.name ~ ('^' || a.id::text || '/avatar\.(jpg|jpeg|png|webp)$')
      )
      and not exists (
        select 1
        from public.profiles p
        where p.id = a.id
          and p.avatar_url is not null
          and right(
            split_part(p.avatar_url, '?', 1),
            char_length('/storage/v1/object/public/avatars/' || o.name)
          ) = '/storage/v1/object/public/avatars/' || o.name
      )
    order by o.created_at, o.name
    limit 100
  )
  select jsonb_build_object(
    'object_paths', coalesce(jsonb_agg(stale.name order by stale.name), '[]'::jsonb)
  )
  from stale;
$$;

revoke all on function public.list_my_stale_avatar_objects()
from public, anon;
grant execute on function public.list_my_stale_avatar_objects()
to authenticated;

-- Presence is device-scoped. An idle phone can no longer overwrite a running
-- timer on another device belonging to the same account.
alter table public.learning_presence add column device_id uuid;
update public.learning_presence
set device_id = user_id
where device_id is null;
alter table public.learning_presence alter column device_id set not null;
alter table public.learning_presence drop constraint learning_presence_pkey;
alter table public.learning_presence
  add constraint learning_presence_pkey primary key (user_id, device_id);

drop function if exists public.update_learning_presence(text, timestamptz);
create or replace function public.update_learning_presence(
  p_device_id uuid,
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
  if p_device_id is null then
    raise exception using errcode = '22023', message = 'presence_device_required';
  end if;
  if p_state is null or p_state not in ('offline', 'idle', 'learning', 'paused') then
    raise exception using errcode = '22023', message = 'invalid_presence_state';
  end if;
  if p_state in ('offline', 'idle') and p_active_since is not null then
    raise exception using errcode = '22023', message = 'inactive_presence_cannot_be_active';
  end if;
  if p_active_since is not null and (
    p_active_since > observed_at + interval '1 minute'
    or p_active_since < observed_at - interval '7 days'
  ) then
    raise exception using errcode = '22023', message = 'invalid_presence_active_since';
  end if;

  perform private.consume_rate_limit(actor, 'learning_presence', 180, interval '1 minute');

  -- Serialise device registration per account, discard stale device rows while
  -- retaining the newest tombstone for "last active", and cap row growth.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text, 0)
  );
  if not exists (
    select 1 from public.learning_presence lp
    where lp.user_id = actor and lp.device_id = p_device_id
  ) then
    delete from public.learning_presence stale
    where stale.user_id = actor
      and stale.expires_at <= observed_at
      and stale.device_id not in (
        select newest.device_id
        from public.learning_presence newest
        where newest.user_id = actor
        order by newest.last_seen_at desc, newest.device_id
        limit 1
      );

    if (
      select count(*) from public.learning_presence lp where lp.user_id = actor
    ) >= 16 then
      raise exception using errcode = '54000', message = 'presence_device_limit';
    end if;
  end if;

  select * into previous
  from public.learning_presence lp
  where lp.user_id = actor and lp.device_id = p_device_id
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
     and p_state in ('paused', 'idle', 'offline')
     and previous.state is distinct from p_state then
    resolved_last_study_at := observed_at;
  end if;

  if p_state = 'offline' then
    insert into public.learning_presence(
      user_id, device_id, state, active_since, last_study_at, last_seen_at, expires_at
    ) values (
      actor, p_device_id, 'idle', null, resolved_last_study_at, observed_at, observed_at
    )
    on conflict (user_id, device_id) do update
    set state = 'idle',
        active_since = null,
        last_study_at = excluded.last_study_at,
        last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at
    returning * into saved;

    return jsonb_build_object(
      'device_id', saved.device_id,
      'state', 'offline',
      'active_since', null,
      'last_study_at', saved.last_study_at,
      'last_seen_at', saved.last_seen_at,
      'expires_at', saved.expires_at
    );
  end if;

  insert into public.learning_presence(
    user_id, device_id, state, active_since, last_study_at, last_seen_at, expires_at
  ) values (
    actor, p_device_id, p_state, resolved_active_since, resolved_last_study_at,
    observed_at, observed_at + interval '2 minutes'
  )
  on conflict (user_id, device_id) do update
  set state = excluded.state,
      active_since = excluded.active_since,
      last_study_at = excluded.last_study_at,
      last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at
  returning * into saved;

  return jsonb_build_object(
    'device_id', saved.device_id,
    'state', saved.state,
    'active_since', saved.active_since,
    'last_study_at', saved.last_study_at,
    'last_seen_at', saved.last_seen_at,
    'expires_at', saved.expires_at
  );
end;
$$;

revoke all on function public.update_learning_presence(uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.update_learning_presence(uuid, text, timestamptz)
to authenticated;

-- One-release compatibility for clients deployed before device-scoped
-- presence. Their user id is a stable, account-owned legacy device key.
create or replace function public.update_learning_presence(
  p_state text,
  p_active_since timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select public.update_learning_presence(
    private.current_actor(), p_state, p_active_since
  );
$$;

revoke all on function public.update_learning_presence(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.update_learning_presence(text, timestamptz)
to authenticated;

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
  observed_at timestamptz := clock_timestamp();
  presence_status_value text := 'offline';
  last_active_at_value timestamptz;
  learning_expires_at_value timestamptz;
  online_expires_at_value timestamptz;
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

  select
    max(lp.last_seen_at),
    max(lp.expires_at) filter (where lp.state = 'learning'),
    max(lp.expires_at)
  into last_active_at_value, learning_expires_at_value, online_expires_at_value
  from public.learning_presence lp
  where lp.user_id = p_friend_id;

  presence_status_value := case
    when learning_expires_at_value > observed_at then 'learning'
    when online_expires_at_value > observed_at then 'online'
    else 'offline'
  end;

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
    'presence_status', presence_status_value,
    'last_active_at', last_active_at_value,
    'server_observed_at', observed_at,
    'presence_expires_at', case
      when presence_status_value = 'learning' then learning_expires_at_value
      when presence_status_value = 'online' then online_expires_at_value
      else null
    end,
    'online_expires_at', online_expires_at_value,
    'shared_goal_ids', shared_goal_ids,
    'shared_session_ids', shared_session_ids,
    'shared_group_ids', shared_group_ids
  );
end;
$$;

-- The old aggregate-statistics RPC is intentionally removed. Shared progress
-- is available only through participant-scoped goal/session projections.
drop function if exists public.get_friend_profile_stats(uuid);

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
  if p_recipient is null then return; end if;
  perform realtime.send(
    jsonb_build_object('kind', coalesce(nullif(p_kind, ''), 'social')),
    'social_invalidated',
    'social:user:' || p_recipient::text,
    true
  );
end;
$$;

revoke all on function private.send_social_invalidation(uuid, text)
from public, anon, authenticated;

drop policy if exists social_user_can_receive on realtime.messages;
create policy social_user_can_receive
on realtime.messages for select to authenticated
using (realtime.topic() = 'social:user:' || auth.uid()::text);

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
    select case when f.requester_id = affected_user then f.addressee_id else f.requester_id end
    from public.friendships f
    where (f.requester_id = affected_user or f.addressee_id = affected_user)
      and f.status = 'accepted' and f.deleted_at is null
  loop
    perform private.send_social_invalidation(recipient, 'presence');
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger learning_presence_broadcast_social
after insert or update or delete on public.learning_presence
for each row execute function private.broadcast_presence_invalidation();

create or replace function private.broadcast_profile_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare recipient uuid;
begin
  perform private.send_social_invalidation(new.id, 'profile');
  for recipient in
    select distinct recipients.user_id
    from (
      select case when f.requester_id = new.id then f.addressee_id else f.requester_id end
      as user_id
      from public.friendships f
      where (f.requester_id = new.id or f.addressee_id = new.id)
        and f.status in ('pending', 'accepted') and f.deleted_at is null
      union all
      select peers.user_id
      from public.goal_participants mine
      join public.goal_participants peers on peers.goal_id = mine.goal_id
      join public.goals g on g.id = mine.goal_id and g.scope = 'shared'
      where mine.user_id = new.id and mine.status in ('invited', 'accepted')
        and peers.status in ('invited', 'accepted')
      union all
      select peers.user_id
      from public.shared_study_session_participants mine
      join public.shared_study_session_participants peers
        on peers.session_id = mine.session_id
      where mine.user_id = new.id and mine.status not in ('declined', 'left')
        and peers.status not in ('declined', 'left')
      union all
      select peers.user_id
      from public.study_group_members mine
      join public.study_group_members peers on peers.group_id = mine.group_id
      where mine.user_id = new.id and mine.status in ('invited', 'accepted')
        and peers.status in ('invited', 'accepted')
    ) recipients
    where recipients.user_id <> new.id
  loop
    perform private.send_social_invalidation(recipient, 'profile');
  end loop;
  return new;
end;
$$;

create trigger profiles_broadcast_social
after update of username, display_name, avatar_url on public.profiles
for each row
when (
  old.username is distinct from new.username
  or old.display_name is distinct from new.display_name
  or old.avatar_url is distinct from new.avatar_url
)
execute function private.broadcast_profile_invalidation();

create or replace function private.broadcast_friendship_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requester uuid := case when tg_op = 'DELETE' then old.requester_id else new.requester_id end;
  addressee uuid := case when tg_op = 'DELETE' then old.addressee_id else new.addressee_id end;
begin
  perform private.send_social_invalidation(requester, 'friendship');
  perform private.send_social_invalidation(addressee, 'friendship');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger friendships_broadcast_social
after insert or update or delete on public.friendships
for each row execute function private.broadcast_friendship_invalidation();

create or replace function private.notify_shared_session_participants(
  p_session_id uuid,
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
      select sp.user_id
      from public.shared_study_session_participants sp
      where sp.session_id = p_session_id
        and sp.status not in ('declined', 'left')
      union all select p_additional_user
    ) candidates
    where candidates.user_id is not null
  loop
    perform private.send_social_invalidation(recipient, p_kind);
  end loop;
end;
$$;

create or replace function private.broadcast_shared_session_social()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_session uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  perform private.notify_shared_session_participants(affected_session, 'shared_session');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger shared_study_sessions_broadcast_social
after insert or update or delete on public.shared_study_sessions
for each row execute function private.broadcast_shared_session_social();

create or replace function private.broadcast_shared_session_participant_social()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_session uuid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  affected_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  perform private.notify_shared_session_participants(
    affected_session, 'shared_session', affected_user
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger shared_session_participants_broadcast_social
after insert or update or delete on public.shared_study_session_participants
for each row execute function private.broadcast_shared_session_participant_social();

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
    perform private.send_social_invalidation(recipient, p_kind);
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
    perform private.send_social_invalidation(affected_user, 'shared_goal');
  end if;
  if exists (select 1 from public.goals g where g.id = affected_goal and g.scope = 'shared') then
    perform private.notify_shared_goal_participants(
      affected_goal, 'shared_goal', affected_user
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger goal_participants_broadcast_social
after insert or update or delete on public.goal_participants
for each row execute function private.broadcast_shared_goal_participant_social();

create or replace function private.broadcast_shared_goal_social()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_goal uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if (case when tg_op = 'DELETE' then old.scope else new.scope end) = 'shared' then
    perform private.notify_shared_goal_participants(affected_goal, 'shared_goal');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger goals_broadcast_social
after insert or update or delete on public.goals
for each row execute function private.broadcast_shared_goal_social();

create or replace function private.broadcast_study_session_social()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_goal uuid := case when tg_op in ('UPDATE', 'DELETE') then old.goal_id end;
  current_goal uuid := case when tg_op in ('INSERT', 'UPDATE') then new.goal_id end;
  previous_shared_session uuid := case
    when tg_op in ('UPDATE', 'DELETE') then old.shared_session_id end;
  current_shared_session uuid := case
    when tg_op in ('INSERT', 'UPDATE') then new.shared_session_id end;
begin
  if current_goal is not null and exists (
    select 1 from public.goals g where g.id = current_goal and g.scope = 'shared'
  ) then
    perform private.notify_shared_goal_participants(current_goal, 'shared_goal_progress');
  end if;
  if previous_goal is distinct from current_goal and previous_goal is not null and exists (
    select 1 from public.goals g where g.id = previous_goal and g.scope = 'shared'
  ) then
    perform private.notify_shared_goal_participants(previous_goal, 'shared_goal_progress');
  end if;
  if current_shared_session is not null then
    perform private.notify_shared_session_participants(
      current_shared_session, 'shared_session_progress'
    );
  end if;
  if previous_shared_session is distinct from current_shared_session
     and previous_shared_session is not null then
    perform private.notify_shared_session_participants(
      previous_shared_session, 'shared_session_progress'
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger study_sessions_broadcast_social
after insert or update or delete on public.study_sessions
for each row execute function private.broadcast_study_session_social();

commit;
