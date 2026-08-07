import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type {
  AccountDataExport,
  AccountStudyUser,
  BlockedProfile,
  ChallengeParticipant,
  ChallengeParticipantProgress,
  CommunityRulesAcceptance,
  ContentReportReceipt,
  FriendOverview,
  FriendSearchResult,
  FriendshipConnection,
  SharedGoalProgress,
  SharedGoalTeamProgress,
  SharedStudySession,
  SharedStudySessionParticipant,
  StudyChallenge,
  StudyGroup,
  StudyGroupMember,
  StudyGoal,
  StudyGrade,
  StudySession,
  StudySharingPreferences,
  StudyUser,
  Subject,
  TimerSegment,
} from '@/types/study';
import { StudyRepositoryError } from '@/data/repositories/repository-error';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, context: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StudyRepositoryError('invalid_data', `${context} hat ein ungültiges Format.`, { retryable: false });
  }
  return value as UnknownRecord;
}

function optionalRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): readonly string[] {
  return [...new Set(list(value)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function valueOf(row: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function requiredString(row: UnknownRecord, context: string, ...keys: string[]): string {
  const value = valueOf(row, ...keys);
  if (typeof value !== 'string' || !value.trim()) {
    throw new StudyRepositoryError('invalid_data', `${context}: ${keys[0]} fehlt.`, { retryable: false });
  }
  return value;
}

function optionalString(row: UnknownRecord, ...keys: string[]): string | null {
  const value = valueOf(row, ...keys);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function clientAlignedExpiry(expiry: string | null, serverObservedAt: string | null): string | null {
  if (!expiry || !serverObservedAt) return expiry;
  const expiryMs = Date.parse(expiry);
  const observedMs = Date.parse(serverObservedAt);
  if (!Number.isFinite(expiryMs) || !Number.isFinite(observedMs)) return expiry;
  const remainingMs = Math.max(0, Math.min(expiryMs - observedMs, 10 * 60_000));
  return new Date(Date.now() + remainingMs).toISOString();
}

function finiteNumber(row: UnknownRecord, fallback: number, ...keys: string[]): number {
  const value = valueOf(row, ...keys);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function booleanValue(row: UnknownRecord, fallback: boolean, ...keys: string[]): boolean {
  const value = valueOf(row, ...keys);
  return typeof value === 'boolean' ? value : fallback;
}

function nullableMetric(row: UnknownRecord, ...keys: string[]): number | null {
  const value = valueOf(row, ...keys);
  if (value === null || value === undefined) return null;
  return finiteNumber(row, 0, ...keys);
}

function statusValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function mapBasicUser(value: unknown): StudyUser {
  const row = record(value, 'Profil');
  return {
    id: requiredString(row, 'Profil', 'id', 'user_id', 'userId'),
    username: requiredString(row, 'Profil', 'username'),
    displayName: requiredString(row, 'Profil', 'display_name', 'displayName'),
    ...(optionalString(row, 'avatar_url', 'avatarUrl') ? { avatarUrl: optionalString(row, 'avatar_url', 'avatarUrl')! } : {}),
  };
}

export function mapAccountProfile(value: unknown): AccountStudyUser {
  const row = record(value, 'Kontoprofil');
  const nested = optionalRecord(valueOf(row, 'profile')) ?? row;
  const basic = mapBasicUser(nested);
  return {
    ...basic,
    timeZone: optionalString(nested, 'time_zone', 'timeZone') ?? 'UTC',
    usernameNeedsReview: booleanValue(nested, false, 'username_needs_review', 'usernameNeedsReview'),
    revision: finiteNumber(nested, 0, 'revision'),
  };
}

export function mapSharingPreferences(value: unknown): StudySharingPreferences {
  const row = record(value, 'Datenschutzfreigaben');
  const nested = optionalRecord(valueOf(row, 'privacy', 'privacy_settings', 'sharing')) ?? row;
  return {
    shareTimerStats: booleanValue(nested, false, 'share_timer_stats', 'shareTimerStats'),
    shareManualStats: booleanValue(nested, false, 'share_manual_stats', 'shareManualStats'),
    shareGoalProgress: booleanValue(nested, false, 'share_goal_progress', 'shareGoalProgress'),
    shareStreak: booleanValue(nested, false, 'share_streak', 'shareStreak'),
    shareCurrentlyLearning: booleanValue(nested, false, 'share_currently_learning', 'shareCurrentlyLearning'),
    sharePauseStatus: booleanValue(nested, false, 'share_pause_status', 'sharePauseStatus'),
    shareLastActiveAt: booleanValue(nested, false, 'share_last_active_at', 'shareLastActiveAt'),
    shareTodayActivity: booleanValue(nested, false, 'share_today_activity', 'shareTodayActivity'),
    shareWeeklyMinutes: booleanValue(nested, false, 'share_weekly_minutes', 'shareWeeklyMinutes'),
    shareAvatar: booleanValue(nested, false, 'share_avatar', 'shareAvatar'),
    discoverableByUsername: booleanValue(nested, false, 'discoverable_by_username', 'discoverableByUsername'),
    revision: finiteNumber(nested, 0, 'revision'),
    updatedAt: optionalString(nested, 'updated_at', 'updatedAt') ?? new Date(0).toISOString(),
  };
}

export function mapSubjectRow(value: unknown): Subject {
  const row = record(value, 'Fach');
  const deletedAt = optionalString(row, 'deleted_at', 'deletedAt');
  return {
    id: requiredString(row, 'Fach', 'id'),
    name: requiredString(row, 'Fach', 'name'),
    color: requiredString(row, 'Fach', 'color'),
    icon: requiredString(row, 'Fach', 'icon'),
    archived: Boolean(optionalString(row, 'archived_at', 'archivedAt')),
    revision: finiteNumber(row, 0, 'revision'),
    syncVersion: String(valueOf(row, 'sync_version', 'syncVersion') ?? '0'),
    updatedAt: optionalString(row, 'updated_at', 'updatedAt') ?? undefined,
    deletedAt,
  };
}

function mapSegments(value: unknown): readonly TimerSegment[] {
  return list(value).map((entry) => {
    const row = record(entry, 'Timersegment');
    return {
      startedAt: requiredString(row, 'Timersegment', 'started_at', 'startedAt'),
      endedAt: requiredString(row, 'Timersegment', 'ended_at', 'endedAt'),
    };
  });
}

export function mapStudySessionProjection(value: unknown): StudySession {
  const row = record(value, 'Lernsession');
  const source = valueOf(row, 'source') === 'timer' ? 'timer' : 'manual';
  const common = {
    id: requiredString(row, 'Lernsession', 'id'),
    userId: requiredString(row, 'Lernsession', 'user_id', 'userId'),
    goalId: optionalString(row, 'goal_id', 'goalId'),
    sharedSessionId: optionalString(row, 'shared_session_id', 'sharedSessionId'),
    subjectId: requiredString(row, 'Lernsession', 'subject_id', 'subjectId'),
    goalTitleSnapshot: optionalString(row, 'goal_title_snapshot', 'goalTitleSnapshot') ?? undefined,
    subjectNameSnapshot: optionalString(row, 'subject_name_snapshot', 'subjectNameSnapshot') ?? undefined,
    startedAt: requiredString(row, 'Lernsession', 'started_at', 'startedAt'),
    endedAt: requiredString(row, 'Lernsession', 'ended_at', 'endedAt'),
    durationMinutes: finiteNumber(row, finiteNumber(row, 0, 'duration_seconds') / 60, 'duration_minutes', 'durationMinutes'),
    plannedDurationMinutes: valueOf(row, 'planned_duration_minutes', 'plannedDurationMinutes') == null
      ? (valueOf(row, 'planned_duration_seconds') == null ? undefined : finiteNumber(row, 0, 'planned_duration_seconds') / 60)
      : finiteNumber(row, 0, 'planned_duration_minutes', 'plannedDurationMinutes'),
    note: optionalString(row, 'legacy_note', 'note') ?? undefined,
    createdAt: requiredString(row, 'Lernsession', 'created_at', 'createdAt'),
    status: 'completed' as const,
    revision: finiteNumber(row, 0, 'revision'),
    syncVersion: String(valueOf(row, 'sync_version', 'syncVersion') ?? '0'),
    updatedAt: optionalString(row, 'updated_at', 'updatedAt') ?? undefined,
    deletedAt: optionalString(row, 'deleted_at', 'deletedAt'),
  };

  if (source === 'timer') {
    return { ...common, source, segments: mapSegments(valueOf(row, 'segments')) };
  }

  return {
    ...common,
    source,
    enteredAt: optionalString(row, 'entered_at', 'enteredAt') ?? common.createdAt,
  };
}

export function mapPersonalGoalProjection(value: unknown): StudyGoal {
  const row = record(value, 'Lernziel');
  const details = optionalRecord(valueOf(row, 'personal_goal_details', 'details')) ?? row;
  const type = statusValue(valueOf(row, 'target_type', 'type'), ['duration', 'sessions'] as const, 'duration');
  const pauseRows = list(valueOf(row, 'pause_intervals', 'paused_intervals', 'pausedIntervals'))
    .map((entry) => record(entry, 'Zielpause'));
  const openPause = pauseRows.find((interval) => optionalString(interval, 'ended_at', 'endedAt') === null);
  const closedPauses = pauseRows.flatMap((interval) => {
    const endedAt = optionalString(interval, 'ended_at', 'endedAt');
    return endedAt ? [{
      startedAt: requiredString(interval, 'Zielpause', 'started_at', 'startedAt'),
      endedAt,
    }] : [];
  });
  const common = {
    id: requiredString(row, 'Lernziel', 'id'),
    userId: requiredString(row, 'Lernziel', 'creator_id', 'owner_id', 'userId'),
    title: optionalString(row, 'title') ?? undefined,
    period: statusValue(valueOf(details, 'period'), ['day', 'week', 'month', 'year', 'custom'] as const, 'week'),
    sourcePolicy: statusValue(valueOf(row, 'source_policy', 'sourcePolicy'), ['all', 'timer_only'] as const, 'all'),
    subjectId: optionalString(details, 'subject_id', 'subjectId') ?? undefined,
    status: statusValue(valueOf(row, 'status'), ['active', 'paused', 'completed', 'archived'] as const, 'active'),
    createdAt: requiredString(row, 'Lernziel', 'created_at', 'createdAt'),
    startsAt: optionalString(row, 'starts_at', 'startsAt') ?? undefined,
    endsAt: optionalString(row, 'ends_at', 'endsAt') ?? undefined,
    pausedAt: openPause ? requiredString(openPause, 'Zielpause', 'started_at', 'startedAt') : undefined,
    pausedIntervals: closedPauses,
    completedAt: optionalString(row, 'completed_at', 'completedAt') ?? undefined,
    archivedAt: optionalString(row, 'archived_at', 'archivedAt') ?? undefined,
    revision: finiteNumber(row, 0, 'revision'),
    syncVersion: String(valueOf(row, 'sync_version', 'syncVersion') ?? '0'),
    updatedAt: optionalString(row, 'updated_at', 'updatedAt') ?? undefined,
    deletedAt: optionalString(row, 'deleted_at', 'deletedAt'),
  };

  if (type === 'sessions') {
    return {
      ...common,
      type,
      targetSessions: finiteNumber(row, finiteNumber(row, 0, 'target_value'), 'target_sessions', 'targetSessions'),
      minimumSessionMinutes: finiteNumber(
        row,
        finiteNumber(row, 0, 'minimum_session_seconds') / 60,
        'minimum_session_minutes',
        'minimumSessionMinutes',
      ),
    };
  }

  return {
    ...common,
    type,
    targetMinutes: finiteNumber(row, finiteNumber(row, 0, 'target_value') / 60, 'target_minutes', 'targetMinutes'),
  };
}

export function mapGradeProjection(value: unknown): StudyGrade {
  const row = record(value, 'Note');
  return {
    id: requiredString(row, 'Note', 'id'),
    userId: requiredString(row, 'Note', 'user_id', 'userId'),
    subjectId: requiredString(row, 'Note', 'subject_id', 'subjectId'),
    subjectNameSnapshot: optionalString(row, 'subject_name_snapshot', 'subjectNameSnapshot') ?? undefined,
    assessmentType: statusValue(valueOf(row, 'assessment_type', 'assessmentType'), ['exam', 'other'] as const, 'other'),
    title: optionalString(row, 'title') ?? undefined,
    assessmentDate: optionalString(row, 'assessment_date', 'assessmentDate') ?? undefined,
    points: finiteNumber(row, 0, 'points'),
    additionalStudyMinutes: finiteNumber(
      row,
      finiteNumber(row, 0, 'additional_study_seconds') / 60,
      'additional_study_minutes',
      'additionalStudyMinutes',
    ),
    sessionIds: list(valueOf(row, 'session_ids', 'sessionIds')).filter((entry): entry is string => typeof entry === 'string'),
    createdAt: requiredString(row, 'Note', 'created_at', 'createdAt'),
    updatedAt: requiredString(row, 'Note', 'updated_at', 'updatedAt'),
    revision: finiteNumber(row, 0, 'revision'),
    syncVersion: String(valueOf(row, 'sync_version', 'syncVersion') ?? '0'),
    deletedAt: optionalString(row, 'deleted_at', 'deletedAt'),
  };
}

export function toSubjectPayload(subject: Subject): Readonly<Record<string, unknown>> {
  return {
    id: subject.id,
    name: subject.name,
    color: subject.color,
    icon: subject.icon,
    archived: Boolean(subject.archived),
    expected_revision: subject.revision ?? 0,
  };
}

export function toPersonalGoalPayload(goal: StudyGoal): Readonly<Record<string, unknown>> {
  return {
    id: goal.id,
    title: goal.title ?? null,
    period: goal.period,
    source_policy: goal.sourcePolicy,
    subject_id: goal.subjectId ?? null,
    status: goal.status,
    starts_at: goal.startsAt ?? goal.createdAt,
    ends_at: goal.endsAt ?? null,
    type: goal.type,
    target_type: goal.type,
    target_value: goal.type === 'duration' ? goal.targetMinutes * 60 : goal.targetSessions,
    minimum_session_seconds: goal.type === 'sessions' ? goal.minimumSessionMinutes * 60 : null,
    pause_intervals: (goal.pausedIntervals ?? []).map((entry) => ({
      started_at: entry.startedAt,
      ended_at: entry.endedAt,
    })),
    expected_revision: goal.revision ?? 0,
  };
}

export function toSessionPayload(session: StudySession): Readonly<Record<string, unknown>> {
  return {
    id: session.id,
    subject_id: session.subjectId,
    goal_id: session.goalId ?? null,
    shared_session_id: session.sharedSessionId ?? null,
    source: session.source,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    entered_at: session.source === 'manual' ? session.enteredAt : null,
    planned_duration_seconds: session.plannedDurationMinutes == null ? null : session.plannedDurationMinutes * 60,
    subject_name_snapshot: session.subjectNameSnapshot ?? null,
    goal_title_snapshot: session.goalTitleSnapshot ?? null,
    legacy_note: session.note ?? null,
    segments: session.source === 'timer'
      ? session.segments.map((entry, ordinal) => ({ ordinal, started_at: entry.startedAt, ended_at: entry.endedAt }))
      : [],
    expected_revision: session.revision ?? 0,
  };
}

export function toGradePayload(grade: StudyGrade): Readonly<Record<string, unknown>> {
  return {
    id: grade.id,
    subject_id: grade.subjectId,
    subject_name_snapshot: grade.subjectNameSnapshot ?? null,
    assessment_type: grade.assessmentType,
    title: grade.title ?? null,
    assessment_date: grade.assessmentDate ?? null,
    points: grade.points,
    additional_study_seconds: grade.additionalStudyMinutes * 60,
    session_ids: [...grade.sessionIds],
    expected_revision: grade.revision ?? 0,
  };
}

export function mapFriendSearchResult(value: unknown): FriendSearchResult | null {
  if (value == null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const row = record(first, 'Benutzersuche');
  const connection = optionalRecord(valueOf(row, 'connection'));
  return {
    user: mapBasicUser(optionalRecord(valueOf(row, 'user', 'profile')) ?? row),
    connection: connection ? {
      id: requiredString(connection, 'Freundschaft', 'id'),
      status: statusValue(valueOf(connection, 'status'), ['pending', 'accepted', 'declined'] as const, 'pending'),
      direction: statusValue(valueOf(connection, 'direction'), ['incoming', 'outgoing'] as const, 'outgoing'),
    } : null,
  };
}

export function mapFriendshipConnection(value: unknown): FriendshipConnection {
  const row = record(value, 'Freundschaft');
  const friendship = optionalRecord(valueOf(row, 'friendship')) ?? row;
  const otherUser = optionalRecord(valueOf(row, 'other_user', 'otherUser', 'profile', 'user'));
  return {
    id: requiredString(friendship, 'Freundschaft', 'id'),
    requesterId: requiredString(friendship, 'Freundschaft', 'requester_id', 'requesterId'),
    addresseeId: requiredString(friendship, 'Freundschaft', 'addressee_id', 'addresseeId'),
    status: statusValue(valueOf(friendship, 'status'), ['pending', 'accepted', 'declined'] as const, 'pending'),
    direction: statusValue(valueOf(row, 'direction'), ['incoming', 'outgoing'] as const, 'outgoing'),
    otherUser: mapBasicUser(otherUser ?? row),
    createdAt: requiredString(friendship, 'Freundschaft', 'created_at', 'createdAt'),
    respondedAt: optionalString(friendship, 'responded_at', 'respondedAt'),
  };
}

export function mapFriendOverview(value: unknown): FriendOverview {
  const row = record(value, 'Freundesüberblick');
  const summary = optionalRecord(valueOf(row, 'overview', 'summary', 'visibility')) ?? row;
  const rawPresenceStatus = valueOf(summary, 'presence_status', 'presenceStatus');
  const legacyLearningStatus = valueOf(summary, 'learning_status', 'learningStatus', 'status');
  const presenceStatus = rawPresenceStatus === 'learning' || legacyLearningStatus === 'learning'
    || legacyLearningStatus === 'learning_now'
    ? 'learning'
    : rawPresenceStatus === 'paused'
      ? 'paused'
    : rawPresenceStatus === 'online'
      ? 'online'
      : 'offline';
  const serverObservedAt = optionalString(summary, 'server_observed_at', 'serverObservedAt');
  const presenceExpiresAt = optionalString(
    summary,
    'presence_expires_at',
    'presenceExpiresAt',
    'expires_at',
    'expiresAt',
  );
  const onlineExpiresAt = optionalString(summary, 'online_expires_at', 'onlineExpiresAt');

  return {
    friend: mapBasicUser(optionalRecord(valueOf(row, 'friend', 'profile', 'user')) ?? row),
    presenceStatus,
    lastActiveAt: optionalString(summary, 'last_active_at', 'lastActiveAt', 'last_seen_at', 'lastSeenAt'),
    presenceExpiresAt: clientAlignedExpiry(presenceExpiresAt, serverObservedAt),
    onlineExpiresAt: clientAlignedExpiry(onlineExpiresAt, serverObservedAt),
    todayMinutes: nullableMetric(summary, 'today_minutes', 'todayMinutes'),
    weekMinutes: nullableMetric(summary, 'week_minutes', 'weekMinutes'),
    streakDays: nullableMetric(summary, 'streak_days', 'streakDays'),
    sharedGoalIds: stringList(valueOf(row, 'shared_goal_ids', 'sharedGoalIds')),
    sharedSessionIds: stringList(valueOf(row, 'shared_session_ids', 'sharedSessionIds')),
    groupIds: stringList(valueOf(row, 'group_ids', 'groupIds', 'shared_group_ids', 'sharedGroupIds')),
  };
}

export function mapBlockedProfile(value: unknown): BlockedProfile {
  const row = record(value, 'Blockiertes Profil');
  return {
    user: mapBasicUser(optionalRecord(valueOf(row, 'user', 'profile')) ?? row),
    blockedAt: requiredString(row, 'Blockiertes Profil', 'blocked_at', 'blockedAt'),
  };
}

export function mapCommunityRulesAcceptance(value: unknown): CommunityRulesAcceptance {
  const row = record(value, 'Community-Zustimmung');
  return {
    accepted: booleanValue(row, false, 'accepted'),
    version: requiredString(row, 'Community-Zustimmung', 'version'),
    acceptedAt: optionalString(row, 'accepted_at', 'acceptedAt'),
  };
}

export function mapContentReportReceipt(value: unknown): ContentReportReceipt {
  const row = record(value, 'Meldungsbestätigung');
  return {
    id: requiredString(row, 'Meldungsbestätigung', 'id'),
    status: 'open',
    createdAt: requiredString(row, 'Meldungsbestätigung', 'created_at', 'createdAt'),
  };
}

export function mapAccountDataExport(value: unknown): AccountDataExport {
  return record(value, 'Datenexport');
}

function mapStudyGroupMember(value: unknown): StudyGroupMember {
  const row = record(value, 'Gruppenmitglied');
  const userValue = optionalRecord(valueOf(row, 'user', 'profile')) ?? row;
  const user = mapBasicUser(userValue);
  const rawRole = valueOf(row, 'role');
  const rawStatus = valueOf(row, 'status', 'membership_status', 'membershipStatus');

  return {
    userId: optionalString(row, 'user_id', 'userId') ?? user.id,
    user,
    role: rawRole === 'owner' || rawRole === 'creator' ? 'owner' : 'member',
    status: statusValue(
      rawStatus,
      ['invited', 'accepted', 'declined', 'left'] as const,
      'accepted',
    ),
  };
}

export function mapStudyGroup(value: unknown): StudyGroup {
  const row = record(value, 'Lerngruppe');
  const group = optionalRecord(valueOf(row, 'group')) ?? row;
  const creator = optionalRecord(valueOf(row, 'creator'));
  const membersById = new Map<string, StudyGroupMember>();
  for (const rawMember of [
    ...list(valueOf(row, 'members')),
    ...list(valueOf(row, 'invitations')),
  ]) {
    const member = mapStudyGroupMember(rawMember);
    membersById.set(member.userId, member);
  }
  const selfMembership = optionalRecord(valueOf(row, 'self_membership', 'selfMembership'));
  if (
    selfMembership &&
    (optionalRecord(valueOf(selfMembership, 'user', 'profile')) || optionalString(selfMembership, 'username'))
  ) {
    const member = mapStudyGroupMember(selfMembership);
    membersById.set(member.userId, member);
  }
  const imageUrl = optionalString(group, 'image_url', 'imageUrl', 'avatar_url', 'avatarUrl');

  return {
    id: requiredString(group, 'Lerngruppe', 'id', 'group_id', 'groupId'),
    creatorId: optionalString(group, 'creator_id', 'creatorId')
      ?? (creator ? requiredString(creator, 'Lerngruppe', 'id') : requiredString(
        group,
        'Lerngruppe',
        'creator_id',
        'creatorId',
      )),
    name: requiredString(group, 'Lerngruppe', 'name'),
    icon: optionalString(group, 'icon') ?? 'people',
    ...(imageUrl ? { imageUrl } : {}),
    members: [...membersById.values()],
    sharedGoalIds: stringList(valueOf(row, 'shared_goal_ids', 'sharedGoalIds')),
    sharedSessionIds: stringList(valueOf(row, 'shared_session_ids', 'sharedSessionIds')),
    createdAt: requiredString(group, 'Lerngruppe', 'created_at', 'createdAt'),
    updatedAt: requiredString(group, 'Lerngruppe', 'updated_at', 'updatedAt'),
  };
}

function mapSharedStudySessionParticipant(value: unknown): SharedStudySessionParticipant {
  const row = record(value, 'Teilnehmer der gemeinsamen Session');
  const userValue = optionalRecord(valueOf(row, 'user', 'profile')) ?? row;
  const user = mapBasicUser(userValue);
  const rawStatus = valueOf(row, 'status', 'participant_status', 'participantStatus');
  const normalizedStatus = rawStatus === 'accepted'
    ? 'joined'
    : rawStatus === 'withdrawn'
      ? 'left'
      : statusValue(
          rawStatus,
          ['invited', 'joined', 'active', 'paused', 'finished', 'declined', 'left'] as const,
          'invited',
        );
  const rawElapsedMinutes = valueOf(row, 'elapsed_minutes', 'elapsedMinutes');
  const elapsedMinutes = rawElapsedMinutes == null
    ? finiteNumber(row, 0, 'active_seconds', 'elapsed_seconds', 'activeSeconds', 'elapsedSeconds') / 60
    : finiteNumber(row, 0, 'elapsed_minutes', 'elapsedMinutes');
  const activeSince = optionalString(row, 'active_since', 'activeSince');
  const joinedAt = optionalString(row, 'joined_at', 'joinedAt');
  const finishedAt = optionalString(row, 'finished_at', 'finishedAt');

  return {
    userId: optionalString(row, 'user_id', 'userId') ?? user.id,
    user,
    status: normalizedStatus,
    elapsedMinutes: Math.max(0, elapsedMinutes),
    ...(activeSince ? { activeSince } : {}),
    ...(joinedAt ? { joinedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
  };
}

export function mapSharedStudySession(value: unknown): SharedStudySession {
  const row = record(value, 'Gemeinsame Lernsession');
  const session = optionalRecord(valueOf(row, 'session')) ?? row;
  const creator = optionalRecord(valueOf(row, 'creator'));
  const calculatedAt = optionalString(row, 'calculated_at', 'calculatedAt');
  const rawPlannedMinutes = valueOf(
    session,
    'planned_duration_minutes',
    'plannedDurationMinutes',
  );
  const plannedDurationMinutes = rawPlannedMinutes == null
    ? finiteNumber(
        session,
        0,
        'planned_duration_seconds',
        'plannedDurationSeconds',
      ) / 60
    : finiteNumber(session, 0, 'planned_duration_minutes', 'plannedDurationMinutes');

  const participantsById = new Map<string, SharedStudySessionParticipant>();
  for (const rawParticipant of list(valueOf(row, 'participants'))) {
    const participant = mapSharedStudySessionParticipant(rawParticipant);
    participantsById.set(participant.userId, participant);
  }
  const selfParticipant = optionalRecord(valueOf(row, 'self_participant', 'selfParticipant'));
  if (
    selfParticipant &&
    (optionalRecord(valueOf(selfParticipant, 'user', 'profile')) || optionalString(selfParticipant, 'username'))
  ) {
    const participant = mapSharedStudySessionParticipant(selfParticipant);
    participantsById.set(participant.userId, {
      ...participantsById.get(participant.userId),
      ...participant,
    });
  }

  return {
    id: requiredString(session, 'Gemeinsame Lernsession', 'id', 'session_id', 'sessionId'),
    creatorId: optionalString(session, 'creator_id', 'creatorId')
      ?? (creator ? requiredString(creator, 'Gemeinsame Lernsession', 'id') : requiredString(
        session,
        'Gemeinsame Lernsession',
        'creator_id',
        'creatorId',
      )),
    groupId: optionalString(session, 'group_id', 'groupId'),
    title: requiredString(session, 'Gemeinsame Lernsession', 'title'),
    startsAt: requiredString(
      session,
      'Gemeinsame Lernsession',
      'starts_at',
      'startsAt',
      'scheduled_for',
      'scheduledFor',
    ),
    plannedDurationMinutes: Math.max(0, plannedDurationMinutes),
    status: statusValue(
      valueOf(session, 'status'),
      ['planned', 'active', 'completed', 'cancelled'] as const,
      'planned',
    ),
    startedAt: optionalString(session, 'started_at', 'startedAt')
      ?? optionalString(session, 'actual_started_at', 'actualStartedAt'),
    endedAt: optionalString(session, 'ended_at', 'endedAt')
      ?? optionalString(session, 'completed_at', 'completedAt')
      ?? optionalString(session, 'cancelled_at', 'cancelledAt'),
    participants: [...participantsById.values()],
    createdAt: requiredString(session, 'Gemeinsame Lernsession', 'created_at', 'createdAt'),
    updatedAt: requiredString(session, 'Gemeinsame Lernsession', 'updated_at', 'updatedAt'),
    calculatedAt,
    ...(calculatedAt && Number.isFinite(Date.parse(calculatedAt))
      ? { receivedAt: new Date(Date.now()).toISOString() }
      : {}),
  };
}

function mapChallengeParticipant(value: unknown): ChallengeParticipant {
  const row = record(value, 'Zielteilnehmer');
  const userId = requiredString(row, 'Zielteilnehmer', 'user_id', 'userId');
  const userValue = optionalRecord(valueOf(row, 'user', 'profile'));
  const user = userValue ? mapBasicUser(userValue) : null;
  return {
    userId,
    ...(user?.id === userId ? { user } : {}),
    status: statusValue(valueOf(row, 'status'), ['invited', 'accepted', 'declined', 'withdrawn'] as const, 'invited'),
  };
}

export function mapStudyChallenge(value: unknown): StudyChallenge {
  const row = record(value, 'Gemeinsames Lernziel');
  const goal = optionalRecord(valueOf(row, 'goal')) ?? row;
  const details = optionalRecord(valueOf(row, 'details')) ?? row;
  const participantsById = new Map<string, ChallengeParticipant>();
  for (const rawParticipant of list(valueOf(row, 'participants'))) {
    const participant = mapChallengeParticipant(rawParticipant);
    participantsById.set(participant.userId, participant);
  }
  const selfParticipation = optionalRecord(valueOf(
    row,
    'self_participation',
    'selfParticipation',
  ));
  if (selfParticipation) {
    const self = mapChallengeParticipant(selfParticipation);
    const existing = participantsById.get(self.userId);
    const user = self.user ?? existing?.user;
    participantsById.set(self.userId, {
      ...existing,
      ...self,
      ...(user ? { user } : {}),
    });
  }
  const type = statusValue(valueOf(goal, 'target_type', 'type'), ['duration', 'sessions'] as const, 'duration');
  const mode = statusValue(valueOf(details, 'mode'), ['per_participant', 'shared'] as const, 'per_participant');
  const period = statusValue(
    valueOf(details, 'period'),
    ['day', 'week', 'month', 'year', 'custom'] as const,
    'week',
  );
  const cadence = statusValue(
    valueOf(details, 'cadence'),
    ['daily', 'weekly'] as const,
    period === 'day' ? 'daily' : 'weekly',
  );
  const startsAt = requiredString(goal, 'Gemeinsames Lernziel', 'starts_at', 'startsAt');
  const endsAt = optionalString(goal, 'ends_at', 'endsAt') ?? undefined;
  const rawStatus = optionalString(goal, 'status');
  const challengeStatus = rawStatus === 'completed' || rawStatus === 'archived'
    ? 'completed'
    : endsAt && Date.parse(endsAt) <= Date.now()
      ? 'completed'
      : Date.parse(startsAt) > Date.now()
        ? 'upcoming'
        : 'active';
  const target = type === 'duration'
    ? { type, mode, targetMinutes: finiteNumber(goal, finiteNumber(goal, 0, 'target_value') / 60, 'target_minutes', 'targetMinutes') }
    : {
        type,
        mode,
        targetSessions: finiteNumber(goal, 0, 'target_value', 'target_sessions', 'targetSessions'),
        minimumSessionMinutes: finiteNumber(goal, finiteNumber(goal, 0, 'minimum_session_seconds') / 60, 'minimum_session_minutes', 'minimumSessionMinutes'),
      };
  return {
    id: requiredString(goal, 'Gemeinsames Lernziel', 'id', 'goal_id', 'goalId'),
    creatorId: requiredString(goal, 'Gemeinsames Lernziel', 'creator_id', 'creatorId'),
    title: requiredString(goal, 'Gemeinsames Lernziel', 'title'),
    description: optionalString(details, 'description') ?? '',
    cadence,
    groupId: optionalString(details, 'group_id', 'groupId')
      ?? optionalString(goal, 'group_id', 'groupId'),
    target,
    sourcePolicy: statusValue(valueOf(goal, 'source_policy', 'sourcePolicy'), ['all', 'timer_only'] as const, 'all'),
    startsAt,
    endsAt,
    status: challengeStatus,
    participants: [...participantsById.values()],
    revision: finiteNumber(goal, 0, 'revision'),
    syncVersion: String(valueOf(goal, 'sync_version', 'syncVersion') ?? '0'),
    updatedAt: optionalString(goal, 'updated_at', 'updatedAt') ?? undefined,
    deletedAt: optionalString(goal, 'deleted_at', 'deletedAt'),
  };
}

function mapParticipantProgress(
  value: unknown,
  goalType: 'duration' | 'sessions',
  mode: 'per_participant' | 'shared',
  rootTarget: number,
): ChallengeParticipantProgress {
  const row = record(value, 'Teilnehmerfortschritt');
  const userValue = valueOf(row, 'user', 'profile');
  const userId = optionalString(row, 'user_id', 'userId')
    ?? optionalRecord(userValue)?.id as string | undefined
    ?? '';
  const user = optionalRecord(userValue)
    ? mapBasicUser(userValue)
    : { id: userId, username: '', displayName: 'Teilnehmer' };
  const contribution = finiteNumber(row, 0, 'contribution');
  return {
    userId,
    user,
    status: statusValue(valueOf(row, 'status'), ['invited', 'accepted', 'declined', 'withdrawn'] as const, 'invited'),
    contribution,
    contributionMinutes: finiteNumber(row, goalType === 'duration' ? contribution : 0, 'contribution_minutes', 'contributionMinutes'),
    sessionCount: finiteNumber(row, goalType === 'sessions' ? contribution : 0, 'session_count', 'sessionCount'),
    target: mode === 'per_participant' ? nullableMetric(row, 'target') ?? rootTarget : null,
    progressPercent: nullableMetric(row, 'progress_percent', 'progressPercent'),
    remaining: nullableMetric(row, 'remaining'),
    achieved: valueOf(row, 'achieved') == null ? null : booleanValue(row, false, 'achieved'),
    exceededBy: nullableMetric(row, 'exceeded_by', 'exceededBy', 'excess'),
  };
}

function calculateProgressSummary(
  contribution: number,
  target: number,
): SharedGoalTeamProgress {
  const safeContribution = Math.max(0, contribution);
  const safeTarget = Math.max(0, target);
  const rounded = (value: number) => Math.round(value * 10) / 10;
  return {
    contribution: rounded(safeContribution),
    target: rounded(safeTarget),
    progressPercent: safeTarget > 0 ? rounded(safeContribution / safeTarget * 100) : 0,
    remaining: rounded(Math.max(0, safeTarget - safeContribution)),
    achieved: safeTarget > 0 && safeContribution >= safeTarget,
    exceededBy: rounded(Math.max(0, safeContribution - safeTarget)),
  };
}

export function mapSharedGoalProgress(value: unknown): SharedGoalProgress {
  const row = record(value, 'Gemeinsamer Zielfortschritt');
  const team = optionalRecord(valueOf(row, 'team'));
  const goalType = statusValue(valueOf(row, 'goal_type', 'target_type', 'goalType', 'type'), ['duration', 'sessions'] as const, 'duration');
  const mode = statusValue(valueOf(row, 'mode'), ['per_participant', 'shared'] as const, 'per_participant');
  const rootTarget = finiteNumber(row, 0, 'target');
  const participants = list(valueOf(row, 'participants')).map((entry) => (
    mapParticipantProgress(entry, goalType, mode, rootTarget)
  ));
  const mappedTeam = team ? {
    contribution: finiteNumber(team, 0, 'contribution'),
    target: finiteNumber(team, finiteNumber(row, 0, 'target'), 'target'),
    progressPercent: finiteNumber(team, 0, 'progress_percent', 'progressPercent'),
    remaining: finiteNumber(team, 0, 'remaining'),
    achieved: booleanValue(team, false, 'achieved'),
    exceededBy: finiteNumber(team, 0, 'exceeded_by', 'exceededBy', 'excess'),
  } : null;
  const overall = mode === 'shared' && mappedTeam
    ? mappedTeam
    : calculateProgressSummary(
        participants.reduce((sum, participant) => sum + participant.contribution, 0),
        mode === 'shared'
          ? rootTarget
          : participants.reduce((sum, participant) => sum + Math.max(0, participant.target ?? 0), 0),
      );
  return {
    goalId: requiredString(row, 'Gemeinsamer Zielfortschritt', 'goal_id', 'goalId'),
    goalType,
    mode,
    sourcePolicy: statusValue(valueOf(row, 'source_policy', 'sourcePolicy'), ['all', 'timer_only'] as const, 'all'),
    startsAt: optionalString(row, 'starts_at', 'startsAt') ?? '',
    endsAt: optionalString(row, 'ends_at', 'endsAt') ?? undefined,
    revision: finiteNumber(row, 0, 'revision'),
    participants,
    team: mappedTeam,
    overall,
    calculatedAt: optionalString(row, 'calculated_at', 'calculatedAt') ?? new Date().toISOString(),
  };
}

function mergeChanges<T extends { id: string; deletedAt?: string | null }>(
  current: readonly T[],
  changes: readonly T[],
  fullSnapshot: boolean,
): readonly T[] {
  const entries = new Map((fullSnapshot ? [] : current).map((entry) => [entry.id, entry]));
  for (const entry of changes) {
    if (entry.deletedAt) entries.delete(entry.id);
    else entries.set(entry.id, entry);
  }
  return [...entries.values()];
}

export interface MappedPullChanges {
  snapshot: StudyStateSnapshot;
  syncVersion: string;
  sharingPreferences: StudySharingPreferences;
}

export function mapPullStudyChanges(
  value: unknown,
  current: StudyStateSnapshot | null,
): MappedPullChanges {
  const outer = record(value, 'Synchronisationsantwort');
  const row = optionalRecord(valueOf(outer, 'snapshot')) ?? outer;
  const fullSnapshot = booleanValue(outer, current == null, 'full_snapshot', 'is_full_snapshot') || current == null;
  const rawProfile = valueOf(row, 'profile');
  const currentUser = current?.data.currentUser;
  const profile = rawProfile
    ? mapAccountProfile(rawProfile)
    : currentUser
      ? {
          ...currentUser,
          timeZone: 'timeZone' in currentUser && typeof currentUser.timeZone === 'string' ? currentUser.timeZone : 'UTC',
          usernameNeedsReview: 'usernameNeedsReview' in currentUser && currentUser.usernameNeedsReview === true,
          revision: 'revision' in currentUser && typeof currentUser.revision === 'number' ? currentUser.revision : 0,
        }
      : (() => { throw new StudyRepositoryError('invalid_data', 'Das synchronisierte Profil fehlt.'); })();
  const rawPrivacy = valueOf(row, 'privacy', 'privacy_settings');
  const sharing = rawPrivacy ? mapSharingPreferences(rawPrivacy) : {
    shareTimerStats: current?.privacy.shareAutomaticMinutes ?? false,
    shareManualStats: current?.privacy.shareManualMinutes ?? false,
    shareGoalProgress: current?.privacy.shareGoalProgress ?? false,
    shareStreak: current?.privacy.shareStreak ?? false,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
  };
  const subjects = list(valueOf(row, 'subjects')).map(mapSubjectRow);
  const goals = list(valueOf(row, 'goals', 'personal_goals')).map(mapPersonalGoalProjection);
  const sessions = list(valueOf(row, 'sessions')).map(mapStudySessionProjection);
  const grades = list(valueOf(row, 'grades')).map(mapGradeProjection);
  const rawChallenges = valueOf(row, 'shared_goals', 'challenges');
  const challenges = list(rawChallenges).map(mapStudyChallenge);
  const base = current?.data;

  return {
    snapshot: {
      privacy: {
        friendComparisonsEnabled: current?.privacy.friendComparisonsEnabled ?? false,
        shareAutomaticMinutes: sharing.shareTimerStats,
        shareManualMinutes: sharing.shareManualStats,
        shareGoalProgress: sharing.shareGoalProgress,
        shareStreak: sharing.shareStreak,
      },
      data: {
        currentUser: profile,
        subjects: mergeChanges(base?.subjects ?? [], subjects, fullSnapshot),
        sessions: mergeChanges(base?.sessions ?? [], sessions, fullSnapshot),
        grades: mergeChanges(base?.grades ?? [], grades, fullSnapshot),
        goals: mergeChanges(base?.goals ?? [], goals, fullSnapshot),
        // Account-mode social projections are never trusted from local JSON.
        friends: [],
        challenges: rawChallenges === undefined
          ? base?.challenges ?? []
          : challenges.filter((challenge) => !challenge.deletedAt),
        activeTimer: base?.activeTimer ?? null,
      },
    },
    syncVersion: String(valueOf(outer, 'sync_version', 'syncVersion') ?? '0'),
    sharingPreferences: sharing,
  };
}
