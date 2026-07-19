/**
 * Checked-in Supabase schema contract. Regenerate this file from the linked
 * local Supabase project after every migration (`supabase gen types`).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableDefinition<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type RevisionColumns = {
  revision: number;
  sync_version: number;
  created_at: string;
  updated_at: string;
};

type SoftDeleteColumns = {
  deleted_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDefinition<RevisionColumns & {
        id: string;
        username: string;
        display_name: string;
        avatar_url: string | null;
        time_zone: string;
        username_needs_review: boolean;
      }>;
      privacy_settings: TableDefinition<{
        user_id: string;
        share_timer_stats: boolean;
        share_manual_stats: boolean;
        share_goal_progress: boolean;
        share_streak: boolean;
        revision: number;
        sync_version: number;
        created_at: string;
        updated_at: string;
      }>;
      subjects: TableDefinition<RevisionColumns & SoftDeleteColumns & {
        id: string;
        owner_id: string;
        name: string;
        name_normalized: string;
        color: string;
        icon: string;
        archived_at: string | null;
      }>;
      goals: TableDefinition<RevisionColumns & SoftDeleteColumns & {
        id: string;
        creator_id: string;
        scope: 'personal' | 'shared';
        title: string | null;
        target_type: 'duration' | 'sessions';
        target_value: number;
        minimum_session_seconds: number | null;
        source_policy: 'all' | 'timer_only';
        starts_at: string;
        ends_at: string | null;
        status: 'active' | 'paused' | 'completed' | 'archived';
        completed_at: string | null;
        archived_at: string | null;
      }>;
      personal_goal_details: TableDefinition<{
        goal_id: string;
        owner_id: string;
        subject_id: string;
        period: 'day' | 'week' | 'month' | 'year' | 'custom';
        revision: number;
        sync_version: number;
        created_at: string;
        updated_at: string;
      }>;
      shared_goal_details: TableDefinition<{
        goal_id: string;
        description: string;
        mode: 'per_participant' | 'shared';
        period: 'day' | 'week' | 'month' | 'year' | 'custom';
        revision: number;
        sync_version: number;
        created_at: string;
        updated_at: string;
      }>;
      goal_participants: TableDefinition<{
        goal_id: string;
        user_id: string;
        invited_by: string | null;
        role: 'creator' | 'member';
        status: 'invited' | 'accepted' | 'declined' | 'withdrawn';
        invited_at: string;
        responded_at: string | null;
        accepted_at: string | null;
        withdrawn_at: string | null;
        revision: number;
        sync_version: number;
        created_at: string;
        updated_at: string;
      }>;
      goal_pause_intervals: TableDefinition<{
        id: string;
        goal_id: string;
        started_at: string;
        ended_at: string | null;
        revision: number;
        sync_version: number;
        created_at: string;
        updated_at: string;
      }>;
      study_sessions: TableDefinition<RevisionColumns & SoftDeleteColumns & {
        id: string;
        user_id: string;
        subject_id: string;
        goal_id: string | null;
        source: 'timer' | 'manual';
        status: 'completed';
        started_at: string;
        ended_at: string;
        entered_at: string | null;
        duration_seconds: number;
        planned_duration_seconds: number | null;
        subject_name_snapshot: string | null;
        goal_title_snapshot: string | null;
        legacy_note: string | null;
        legacy_imported: boolean;
      }>;
      study_session_segments: TableDefinition<{
        session_id: string;
        ordinal: number;
        user_id: string;
        started_at: string;
        ended_at: string;
        sync_version: number;
        created_at: string;
      }>;
      grades: TableDefinition<RevisionColumns & SoftDeleteColumns & {
        id: string;
        user_id: string;
        subject_id: string;
        subject_name_snapshot: string | null;
        assessment_type: 'exam' | 'other';
        title: string | null;
        assessment_date: string | null;
        points: number;
        additional_study_seconds: number;
      }>;
      grade_sessions: TableDefinition<{
        grade_id: string;
        session_id: string;
        user_id: string;
        subject_id: string;
        sync_version: number;
        created_at: string;
      }>;
      friendships: TableDefinition<{
        id: string;
        requester_id: string;
        addressee_id: string;
        pair_low: string;
        pair_high: string;
        status: 'pending' | 'accepted' | 'declined';
        created_at: string;
        responded_at: string | null;
        deleted_at: string | null;
        revision: number;
        sync_version: number;
        updated_at: string;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_my_profile: { Args: Record<PropertyKey, never>; Returns: Json };
      update_my_profile: {
        Args: { p_username: string; p_display_name: string; p_avatar_url: string | null; p_time_zone: string; p_expected_revision: number };
        Returns: Json;
      };
      update_privacy_settings: {
        Args: { p_share_timer_stats: boolean; p_share_manual_stats: boolean; p_share_goal_progress: boolean; p_share_streak: boolean; p_expected_revision: number };
        Returns: Json;
      };
      find_profile_by_exact_username: {
        Args: { p_username: string };
        Returns: Json;
      };
      pull_my_study_changes: { Args: { p_after_sync_version: number }; Returns: Json };
      upsert_subject: { Args: { p_subject: Json; p_operation_id: string }; Returns: Json };
      soft_delete_subject: { Args: { p_id: string; p_expected_revision: number; p_operation_id: string }; Returns: Json };
      upsert_personal_goal: { Args: { p_goal: Json; p_operation_id: string }; Returns: Json };
      soft_delete_personal_goal: { Args: { p_id: string; p_expected_revision: number; p_operation_id: string }; Returns: Json };
      transition_personal_goal: { Args: { p_goal_id: string; p_status: string; p_at: string; p_expected_revision: number; p_operation_id: string }; Returns: Json };
      save_completed_session: { Args: { p_session: Json; p_operation_id: string }; Returns: Json };
      soft_delete_session: { Args: { p_id: string; p_expected_revision: number; p_operation_id: string }; Returns: Json };
      upsert_grade: { Args: { p_grade: Json; p_operation_id: string }; Returns: Json };
      soft_delete_grade: { Args: { p_id: string; p_expected_revision: number; p_operation_id: string }; Returns: Json };
      begin_local_import: { Args: { p_device_fingerprint: string; p_payload_hash: string; p_expected_counts: Json }; Returns: Json };
      stage_local_import_chunk: { Args: { p_import_id: string; p_chunk_index: number; p_chunk_hash: string; p_payload: Json }; Returns: Json };
      finalize_local_import: { Args: { p_import_id: string }; Returns: Json };
      get_local_import_status: { Args: { p_import_id: string }; Returns: Json };
      discard_local_import: { Args: { p_import_id: string }; Returns: Json };
      send_friend_request: { Args: { p_username: string }; Returns: Json };
      accept_friend_request: { Args: { p_friendship_id: string }; Returns: Json };
      decline_friend_request: { Args: { p_friendship_id: string }; Returns: Json };
      remove_friendship: { Args: { p_friendship_id: string }; Returns: Json };
      list_friend_connections: { Args: Record<PropertyKey, never>; Returns: Json };
      get_friend_profile_stats: { Args: { p_friend_id: string }; Returns: Json };
      create_shared_goal: { Args: { p_goal: Json; p_invitee_ids: string[]; p_operation_id: string }; Returns: Json };
      respond_shared_goal_invitation: { Args: { p_goal_id: string; p_accept: boolean }; Returns: Json };
      withdraw_from_shared_goal: { Args: { p_goal_id: string }; Returns: Json };
      get_shared_goal_details: { Args: { p_goal_id: string }; Returns: Json };
      get_shared_goal_progress: { Args: { p_goal_id: string }; Returns: Json };
      list_shared_goals: { Args: Record<PropertyKey, never>; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
