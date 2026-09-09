begin;

-- Keep every Data API table behind RLS even if a later migration accidentally
-- changes a grant. SECURITY DEFINER RPCs remain responsible for all writes.
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
alter table public.learning_presence enable row level security;
alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;
alter table public.shared_study_sessions enable row level security;
alter table public.shared_study_session_participants enable row level security;

-- Start from no client privileges. Restore only the owner-filtered reads kept
-- for backwards compatibility and the purpose-built authenticated RPC API.
revoke all privileges on all tables in schema public
from public, anon, authenticated;
revoke all privileges on all sequences in schema public
from public, anon, authenticated;
revoke all privileges on all functions in schema public
from public, anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all privileges on all tables in schema private
from public, anon, authenticated;
revoke all privileges on all sequences in schema private
from public, anon, authenticated;
revoke all privileges on all functions in schema private
from public, anon, authenticated;

revoke all on schema public from public, anon;
grant usage on schema public to authenticated;

-- These relations expose only the caller's own rows through restrictive RLS
-- policies. Collaborative raw tables remain RPC-only.
grant select on
  public.profiles,
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

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.list_friend_connections() to authenticated;
grant execute on function public.get_friend_overview(uuid) to authenticated;
grant execute on function public.list_friend_overviews() to authenticated;

grant execute on function public.update_learning_presence(text, timestamptz) to authenticated;
grant execute on function public.update_learning_presence(uuid, text, timestamptz) to authenticated;
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
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.list_my_stale_avatar_objects() to authenticated;

-- New relations and functions must opt in to client exposure explicitly.
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges in schema private
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema private
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private
  revoke all on functions from public, anon, authenticated;

commit;
