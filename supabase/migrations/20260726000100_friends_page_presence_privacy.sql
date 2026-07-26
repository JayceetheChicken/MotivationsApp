begin;

-- Friends receive only presence and genuinely shared references. Private
-- session timestamps, totals and streaks never cross this RPC boundary.
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
  presence_is_fresh boolean := false;
  presence_status_value text := 'offline';
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

  presence_is_fresh := presence.user_id is not null
    and presence.expires_at > clock_timestamp();
  presence_status_value := case
    when presence_is_fresh and presence.state = 'learning' then 'learning'
    when presence_is_fresh then 'online'
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
    'last_active_at', presence.last_seen_at,
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
        select case
          when f.requester_id = actor then f.addressee_id
          else f.requester_id
        end as friend_id
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
          case model ->> 'presence_status'
            when 'learning' then 0
            when 'online' then 1
            else 2
          end,
          (model ->> 'last_active_at')::timestamptz desc nulls last,
          model -> 'friend' ->> 'username'
      )
      from models
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.friend_overview_read_model(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.list_friend_overviews() from public, anon, authenticated;
grant execute on function public.list_friend_overviews() to authenticated;

commit;
