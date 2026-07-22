import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type {
  AccountStudyUser,
  ChallengeParticipant,
  ChallengeParticipantProgress,
  FriendPeriodStatistics,
  FriendProfileStatistics,
  FriendSearchResult,
  FriendshipConnection,
  FriendStatsPeriod,
  SharedGoalProgress,
  StudyChallenge,
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

const FRIEND_PERIODS: readonly FriendStatsPeriod[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
];

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

function hiddenPeriod(period: FriendStatsPeriod): FriendPeriodStatistics {
  return {
    period,
    startsAt: new Date(0).toISOString(),
    endsAt: new Date(0).toISOString(),
    timerMinutes: null,
    timerSessionCount: null,
    manualMinutes: null,
    manualSessionCount: null,
    totalMinutes: null,
    totalSessionCount: null,
  };
}

function mapFriendPeriod(value: unknown, period: FriendStatsPeriod): FriendPeriodStatistics {
  const row = record(value, `Freundesstatistik ${period}`);
  return {
    period,
    startsAt: requiredString(row, `Freundesstatistik ${period}`, 'starts_at', 'startsAt'),
    endsAt: requiredString(row, `Freundesstatistik ${period}`, 'ends_at', 'endsAt'),
    timerMinutes: nullableMetric(row, 'timer_minutes', 'timerMinutes'),
    timerSessionCount: nullableMetric(row, 'timer_session_count', 'timerSessionCount'),
    manualMinutes: nullableMetric(row, 'manual_minutes', 'manualMinutes'),
    manualSessionCount: nullableMetric(row, 'manual_session_count', 'manualSessionCount'),
    totalMinutes: nullableMetric(row, 'total_minutes', 'totalMinutes'),
    totalSessionCount: nullableMetric(row, 'total_session_count', 'totalSessionCount'),
  };
}

export function mapFriendProfileStatistics(value: unknown): FriendProfileStatistics {
  const row = record(value, 'Freundesprofil');
  const rawPeriods = valueOf(row, 'periods');
  const periodRecord = optionalRecord(rawPeriods);
  const periodList = list(rawPeriods);
  const periods = Object.fromEntries(FRIEND_PERIODS.map((period) => {
    const fromRecord = periodRecord?.[period];
    const fromList = periodList.find((entry) => {
      const candidate = optionalRecord(entry);
      return candidate?.period === period || candidate?.key === period;
    });
    return [period, fromRecord || fromList ? mapFriendPeriod(fromRecord ?? fromList, period) : hiddenPeriod(period)];
  })) as Record<FriendStatsPeriod, FriendPeriodStatistics>;
  const visibilityRow = optionalRecord(valueOf(row, 'visibility', 'permissions')) ?? {};
  const goalsRow = optionalRecord(valueOf(row, 'goals'));
  const goalReached = valueOf(row, 'goal_reached', 'goalReached');

  return {
    friend: mapAccountProfile(valueOf(row, 'friend', 'profile')),
    periods,
    streakDays: nullableMetric(row, 'streak_days', 'streakDays'),
    goals: goalsRow || typeof goalReached === 'boolean' ? {
      reached: typeof goalReached === 'boolean'
        ? goalReached
        : finiteNumber(goalsRow ?? {}, 0, 'achieved_goal_count', 'achievedGoalCount') > 0,
      achievedGoalCount: goalsRow
        ? finiteNumber(goalsRow, 0, 'achieved_goal_count', 'achievedGoalCount')
        : goalReached === true ? 1 : 0,
      evaluatedGoalCount: goalsRow
        ? finiteNumber(goalsRow, 0, 'evaluated_goal_count', 'evaluatedGoalCount')
        : 1,
    } : null,
    visibility: {
      timer: booleanValue(visibilityRow, false, 'timer'),
      manual: booleanValue(visibilityRow, false, 'manual'),
      goals: booleanValue(visibilityRow, false, 'goals', 'goal_progress'),
      streak: booleanValue(visibilityRow, false, 'streak'),
    },
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
  const type = statusValue(valueOf(goal, 'target_type', 'type'), ['duration', 'sessions'] as const, 'duration');
  const mode = statusValue(valueOf(details, 'mode'), ['per_participant', 'shared'] as const, 'per_participant');
  const startsAt = requiredString(goal, 'Gemeinsames Lernziel', 'starts_at', 'startsAt');
  const endsAt = requiredString(goal, 'Gemeinsames Lernziel', 'ends_at', 'endsAt');
  const rawStatus = optionalString(goal, 'status');
  const challengeStatus = rawStatus === 'completed' || rawStatus === 'archived'
    ? 'completed'
    : Date.parse(endsAt) <= Date.now()
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
    target,
    sourcePolicy: statusValue(valueOf(goal, 'source_policy', 'sourcePolicy'), ['all', 'timer_only'] as const, 'all'),
    startsAt,
    endsAt,
    status: challengeStatus,
    participants: list(valueOf(row, 'participants')).map(mapChallengeParticipant),
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

export function mapSharedGoalProgress(value: unknown): SharedGoalProgress {
  const row = record(value, 'Gemeinsamer Zielfortschritt');
  const team = optionalRecord(valueOf(row, 'team'));
  const goalType = statusValue(valueOf(row, 'goal_type', 'target_type', 'goalType', 'type'), ['duration', 'sessions'] as const, 'duration');
  const mode = statusValue(valueOf(row, 'mode'), ['per_participant', 'shared'] as const, 'per_participant');
  const rootTarget = finiteNumber(row, 0, 'target');
  return {
    goalId: requiredString(row, 'Gemeinsamer Zielfortschritt', 'goal_id', 'goalId'),
    goalType,
    mode,
    sourcePolicy: statusValue(valueOf(row, 'source_policy', 'sourcePolicy'), ['all', 'timer_only'] as const, 'all'),
    startsAt: optionalString(row, 'starts_at', 'startsAt') ?? '',
    endsAt: optionalString(row, 'ends_at', 'endsAt') ?? '',
    revision: finiteNumber(row, 0, 'revision'),
    participants: list(valueOf(row, 'participants')).map((entry) => mapParticipantProgress(entry, goalType, mode, rootTarget)),
    team: team ? {
      contribution: finiteNumber(team, 0, 'contribution'),
      target: finiteNumber(team, finiteNumber(row, 0, 'target'), 'target'),
      progressPercent: finiteNumber(team, 0, 'progress_percent', 'progressPercent'),
      remaining: finiteNumber(team, 0, 'remaining'),
      achieved: booleanValue(team, false, 'achieved'),
      exceededBy: finiteNumber(team, 0, 'exceeded_by', 'exceededBy', 'excess'),
    } : null,
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
