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
        share_currently_learning: boolean;
        share_pause_status: boolean;
        share_last_active_at: boolean;
        share_today_activity: boolean;
        share_weekly_minutes: boolean;
        share_avatar: boolean;
        discoverable_by_username: boolean;
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
        cadence: 'daily' | 'weekly';
        group_id: string | null;
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
        shared_session_id: string | null;
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
      learning_presence: TableDefinition<{
        user_id: string;
        device_id: string;
        state: 'idle' | 'learning' | 'paused';
        active_since: string | null;
        last_study_at: string | null;
        last_seen_at: string;
        expires_at: string;
      }>;
      study_groups: TableDefinition<{
        id: string;
        creator_id: string;
        name: string;
        icon: string | null;
        image_url: string | null;
        revision: number;
        created_at: string;
        updated_at: string;
      }>;
      study_group_members: TableDefinition<{
        group_id: string;
        user_id: string;
        role: 'creator' | 'member';
        status: 'invited' | 'accepted' | 'declined' | 'left';
        invited_by: string | null;
        invited_at: string;
        responded_at: string | null;
        accepted_at: string | null;
        left_at: string | null;
        revision: number;
        created_at: string;
        updated_at: string;
      }>;
      shared_study_sessions: TableDefinition<{
        id: string;
        creator_id: string;
        group_id: string | null;
        title: string;
        starts_at: string;
        planned_duration_seconds: number;
        status: 'planned' | 'active' | 'completed' | 'cancelled';
        actual_started_at: string | null;
        completed_at: string | null;
        cancelled_at: string | null;
        revision: number;
        created_at: string;
        updated_at: string;
      }>;
      shared_study_session_participants: TableDefinition<{
        session_id: string;
        user_id: string;
        role: 'creator' | 'member';
        status: 'invited' | 'joined' | 'active' | 'paused' | 'finished' | 'declined' | 'left';
        invited_by: string | null;
        invited_at: string;
        responded_at: string | null;
        joined_at: string | null;
        active_since: string | null;
        elapsed_seconds: number;
        finished_at: string | null;
        left_at: string | null;
        revision: number;
        created_at: string;
        updated_at: string;
      }>;
      user_blocks: TableDefinition<{
        blocker_id: string;
        blocked_id: string;
        created_at: string;
      }>;
      community_rule_acceptances: TableDefinition<{
        user_id: string;
        version: string;
        accepted_at: string;
      }>;
      content_reports: TableDefinition<{
        id: string;
        reporter_id: string;
        entity_type: 'profile' | 'profile_name' | 'profile_image' | 'group' | 'group_name' | 'group_image' | 'shared_goal' | 'shared_session';
        entity_id: string;
        reason: 'harassment' | 'hate' | 'sexual_content' | 'violence' | 'spam' | 'impersonation' | 'privacy' | 'other';
        description: string | null;
        status: 'open' | 'reviewing' | 'resolved' | 'rejected';
        moderation_action: 'none' | 'hide' | 'remove';
        resolution_note: string | null;
        moderator_reference: string | null;
        created_at: string;
        updated_at: string;
        moderated_at: string | null;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_my_profile: { Args: Record<PropertyKey, never>; Returns: Json };
      update_my_profile: {
        Args: { p_username: string; p_display_name: string; p_avatar_url: string | null; p_time_zone: string; p_expected_revision: number };
        Returns: Json;
      };
      set_my_avatar: {
        Args: { p_object_path: string };
        Returns: Json;
      };
      list_my_stale_avatar_objects: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      update_privacy_settings: {
        Args: {
          p_share_timer_stats: boolean;
          p_share_manual_stats: boolean;
          p_share_goal_progress: boolean;
          p_share_streak: boolean;
          p_share_currently_learning: boolean;
          p_share_pause_status: boolean;
          p_share_last_active_at: boolean;
          p_share_today_activity: boolean;
          p_share_weekly_minutes: boolean;
          p_share_avatar: boolean;
          p_discoverable_by_username: boolean;
          p_expected_revision: number;
        };
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
      block_user: { Args: { p_user_id: string }; Returns: Json };
      unblock_user: { Args: { p_user_id: string }; Returns: Json };
      list_my_blocked_profiles: { Args: Record<PropertyKey, never>; Returns: Json };
      submit_content_report: {
        Args: { p_entity_type: string; p_entity_id: string; p_reason: string; p_description?: string | null };
        Returns: Json;
      };
      get_community_rules_acceptance: { Args: Record<PropertyKey, never>; Returns: Json };
      accept_community_rules: { Args: { p_version: string }; Returns: Json };
      export_my_data: { Args: Record<PropertyKey, never>; Returns: Json };
      moderate_content_report: {
        Args: {
          p_report_id: string;
          p_status: 'reviewing' | 'resolved' | 'rejected';
          p_action: 'none' | 'hide' | 'remove';
          p_resolution_note?: string | null;
          p_moderator_reference?: string | null;
        };
        Returns: Json;
      };
      prepare_account_deletion: { Args: { p_user_id: string }; Returns: Json };
      get_friend_overview: { Args: { p_friend_id: string }; Returns: Json };
      list_friend_overviews: { Args: Record<PropertyKey, never>; Returns: Json };
      create_shared_goal: { Args: { p_goal: Json; p_invitee_ids: string[]; p_operation_id: string }; Returns: Json };
      respond_shared_goal_invitation: { Args: { p_goal_id: string; p_accept: boolean }; Returns: Json };
      withdraw_from_shared_goal: { Args: { p_goal_id: string }; Returns: Json };
      get_shared_goal_details: { Args: { p_goal_id: string }; Returns: Json };
      get_shared_goal_progress: { Args: { p_goal_id: string }; Returns: Json };
      list_shared_goal_progress: { Args: Record<PropertyKey, never>; Returns: Json };
      list_shared_goals: { Args: Record<PropertyKey, never>; Returns: Json };
      list_study_groups: { Args: Record<PropertyKey, never>; Returns: Json };
      get_study_group_details: { Args: { p_group_id: string }; Returns: Json };
      create_study_group: {
        Args: { p_group: Json; p_member_ids: string[]; p_operation_id: string };
        Returns: Json;
      };
      respond_study_group_invitation: {
        Args: { p_group_id: string; p_accept: boolean };
        Returns: Json;
      };
      leave_study_group: { Args: { p_group_id: string }; Returns: Json };
      list_shared_study_sessions: { Args: Record<PropertyKey, never>; Returns: Json };
      get_shared_study_session_details: { Args: { p_session_id: string }; Returns: Json };
      create_shared_study_session: {
        Args: { p_session: Json; p_invitee_ids: string[]; p_operation_id: string };
        Returns: Json;
      };
      respond_shared_study_session_invitation: {
        Args: { p_session_id: string; p_accept: boolean };
        Returns: Json;
      };
      update_shared_study_session_participant: {
        Args: {
          p_session_id: string;
          p_action: 'start' | 'pause' | 'resume' | 'finish' | 'leave';
        };
        Returns: Json;
      };
      cancel_shared_study_session: { Args: { p_session_id: string }; Returns: Json };
      update_learning_presence: {
        Args: {
          p_device_id: string;
          p_state: 'offline' | 'idle' | 'learning' | 'paused';
          p_active_since: string | null;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
