import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';

import { createInitialData, subjectColorPalette } from '@/data/initial-data';
import '@/lib/local-storage';
import {
  buildTimerSession,
  getTimerFinishDecision,
  pauseActiveTimer,
  resumeActiveTimer,
} from '@/lib/timer';
import type {
  ActiveTimer,
  ChallengeMode,
  ChallengeParticipant,
  Friend,
  FriendStudySnapshot,
  GoalPeriod,
  GoalSourcePolicy,
  GoalStatus,
  ManualStudySession,
  StudyChallenge,
  StudyData,
  StudyGoal,
  StudySession,
  StudyUser,
  Subject,
  TimerStudySession,
} from '@/types/study';

const LEGACY_STORAGE_KEY = 'lernzeit.study-state.v1';
const STORAGE_KEY_PREFIX = 'lernzeit.study-state.v2';
const CURRENT_SCHEMA_VERSION = 2;
const LOCAL_USER_ID = 'local-user';

const LEGACY_SEEDED_SESSION_IDS = new Set([
  'session-today',
  ...Array.from({ length: 15 }, (_, index) => `session-${index + 1}`),
]);
const LEGACY_SEEDED_GOAL_IDS = new Set([
  'goal-weekly-time',
  'goal-weekly-sessions',
  'goal-monthly-mathe',
]);
const LEGACY_SEEDED_FRIEND_IDS = new Set([
  'friend-jonas',
  'friend-aylin',
  'friend-noah',
]);
const LEGACY_SEEDED_CHALLENGE_IDS = new Set([
  'challenge-sommer-fokus',
  'challenge-drei-sessions',
]);

export interface PrivacyPreferences {
  friendComparisonsEnabled: boolean;
  shareAutomaticMinutes: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
}

export interface StudyState {
  data: StudyData;
  privacy: PrivacyPreferences;
}

interface PersistedStudyState extends StudyState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
}

export interface NewManualEntry {
  subjectId: string;
  durationMinutes: number;
  studiedOn: string;
  note?: string;
}

export interface NewGoal {
  title?: string;
  type: 'duration' | 'sessions';
  /** Minutes for duration goals, session count for session goals. */
  target: number;
  subjectId?: string;
  subjectIds?: readonly string[];
  sourcePolicy: GoalSourcePolicy;
  period?: GoalPeriod;
  startsAt?: string;
  minimumSessionMinutes?: number;
}

export interface GoalUpdate {
  title?: string | null;
  type?: 'duration' | 'sessions';
  target?: number;
  subjectId?: string | null;
  subjectIds?: readonly string[] | null;
  sourcePolicy?: GoalSourcePolicy;
  period?: GoalPeriod;
  startsAt?: string;
  minimumSessionMinutes?: number;
}

export interface LocalProfileUpdate {
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  avatarColor?: string;
}

export interface FinishTimerOptions {
  /** The UI must obtain explicit confirmation before setting this for <60 s. */
  allowShortSession?: boolean;
}

export interface StudyStoreValue extends StudyState {
  hydrated: boolean;
  addSubject: (name: string) => Subject;
  updateLocalProfile: (profile: LocalProfileUpdate) => StudyUser | null;
  clearLocalProfile: () => void;
  startTimer: (subjectId: string) => ActiveTimer | null;
  pauseTimer: () => ActiveTimer | null;
  resumeTimer: () => ActiveTimer | null;
  finishTimer: (options?: FinishTimerOptions) => TimerStudySession | null;
  discardTimer: () => void;
  addManualEntry: (entry: NewManualEntry) => ManualStudySession;
  createGoal: (goal: NewGoal) => StudyGoal;
  /** Backwards-compatible alias for createGoal. */
  addGoal: (goal: NewGoal) => StudyGoal;
  updateGoal: (goalId: string, update: GoalUpdate) => StudyGoal | null;
  pauseGoal: (goalId: string) => StudyGoal | null;
  resumeGoal: (goalId: string) => StudyGoal | null;
  completeGoal: (goalId: string) => StudyGoal | null;
  archiveGoal: (goalId: string) => StudyGoal | null;
  deleteGoal: (goalId: string) => void;
  setFriendComparisonsEnabled: (enabled: boolean) => void;
  setPrivacyPreference: (
    key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>,
    enabled: boolean,
  ) => void;
  clearAllData: () => void;
}

type Action =
  | { type: 'hydrate'; payload: StudyState }
  | { type: 'set-current-user'; payload: StudyUser | null }
  | { type: 'add-subject'; payload: Subject }
  | { type: 'set-active-timer'; payload: ActiveTimer | null }
  | { type: 'finish-timer'; payload: TimerStudySession }
  | { type: 'add-manual-entry'; payload: ManualStudySession }
  | { type: 'add-goal'; payload: StudyGoal }
  | { type: 'replace-goal'; payload: StudyGoal }
  | { type: 'delete-goal'; payload: string }
  | { type: 'set-friend-comparisons'; payload: boolean }
  | {
      type: 'set-privacy-preference';
      key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>;
      payload: boolean;
    }
  | { type: 'reset' };

export const defaultPrivacy: Readonly<PrivacyPreferences> = {
  friendComparisonsEnabled: false,
  shareAutomaticMinutes: false,
  shareGoalProgress: false,
  shareStreak: false,
};

export function createInitialStudyState(): StudyState {
  return { data: createInitialData(), privacy: { ...defaultPrivacy } };
}

function reducer(state: StudyState, action: Action): StudyState {
  switch (action.type) {
    case 'hydrate':
      return action.payload;
    case 'set-current-user':
      return { ...state, data: { ...state.data, currentUser: action.payload } };
    case 'add-subject':
      return {
        ...state,
        data: { ...state.data, subjects: [...state.data.subjects, action.payload] },
      };
    case 'set-active-timer':
      if (
        action.payload &&
        state.data.activeTimer &&
        action.payload.id !== state.data.activeTimer.id
      ) {
        return state;
      }
      return { ...state, data: { ...state.data, activeTimer: action.payload } };
    case 'finish-timer':
      if (state.data.activeTimer?.id !== action.payload.id) return state;
      return {
        ...state,
        data: {
          ...state.data,
          activeTimer: null,
          sessions: [action.payload, ...state.data.sessions],
        },
      };
    case 'add-manual-entry':
      return {
        ...state,
        data: { ...state.data, sessions: [action.payload, ...state.data.sessions] },
      };
    case 'add-goal':
      return {
        ...state,
        data: { ...state.data, goals: [action.payload, ...state.data.goals] },
      };
    case 'replace-goal':
      return {
        ...state,
        data: {
          ...state.data,
          goals: state.data.goals.map((goal) =>
            goal.id === action.payload.id ? action.payload : goal,
          ),
        },
      };
    case 'delete-goal':
      return {
        ...state,
        data: {
          ...state.data,
          goals: state.data.goals.filter((goal) => goal.id !== action.payload),
        },
      };
    case 'set-friend-comparisons':
      return {
        ...state,
        privacy: { ...state.privacy, friendComparisonsEnabled: action.payload },
      };
    case 'set-privacy-preference':
      return {
        ...state,
        privacy: { ...state.privacy, [action.key]: action.payload },
      };
    case 'reset':
      return createInitialStudyState();
    default:
      return state;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanOptionalText(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function safeWholeNumber(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.round(value)) : fallback;
}

function initialsForName(name: string): string | undefined {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || undefined;
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, '').replace(/\s+/g, '.').toLowerCase();
}

function actorId(data: StudyData): string {
  return data.currentUser?.id ?? LOCAL_USER_ID;
}

function parseStartDate(value: string | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isFinite(dateOnly.getTime()) ? dateOnly.toISOString() : fallback.toISOString();
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function createStudyGoal(input: NewGoal, userId: string, now: Date): StudyGoal {
  const subjectIds = input.subjectIds?.filter(Boolean) ??
    (input.subjectId ? [input.subjectId] : undefined);
  const common = {
    id: makeId('goal'),
    userId,
    title: cleanOptionalText(input.title),
    period: input.period ?? ('week' as const),
    sourcePolicy: input.sourcePolicy,
    subjectIds: subjectIds?.length ? [...new Set(subjectIds)] : undefined,
    status: 'active' as const,
    createdAt: now.toISOString(),
    startsAt: parseStartDate(input.startsAt, now),
  };

  return input.type === 'duration'
    ? {
        ...common,
        type: 'duration',
        targetMinutes: safeWholeNumber(input.target, 1, 1),
      }
    : {
        ...common,
        type: 'sessions',
        targetSessions: safeWholeNumber(input.target, 1, 1),
        minimumSessionMinutes: safeWholeNumber(
          input.minimumSessionMinutes ?? 10,
          0,
          10,
        ),
      };
}

function applyGoalUpdate(goal: StudyGoal, update: GoalUpdate): StudyGoal {
  const nextType = update.type ?? goal.type;
  const nextTitle = hasOwn(update, 'title')
    ? cleanOptionalText(update.title)
    : goal.title;
  let subjectIds = goal.subjectIds;

  if (hasOwn(update, 'subjectIds')) {
    subjectIds = update.subjectIds?.filter(Boolean) ?? undefined;
  } else if (hasOwn(update, 'subjectId')) {
    subjectIds = update.subjectId ? [update.subjectId] : undefined;
  }

  const common = {
    id: goal.id,
    userId: goal.userId,
    title: nextTitle,
    period: update.period ?? goal.period,
    sourcePolicy: update.sourcePolicy ?? goal.sourcePolicy,
    subjectIds: subjectIds?.length ? [...new Set(subjectIds)] : undefined,
    status: goal.status,
    createdAt: goal.createdAt,
    startsAt: update.startsAt
      ? parseStartDate(update.startsAt, new Date(goal.startsAt ?? goal.createdAt))
      : goal.startsAt,
    pausedAt: goal.pausedAt,
    pausedIntervals: goal.pausedIntervals,
    completedAt: goal.completedAt,
    archivedAt: goal.archivedAt,
  };

  if (nextType === 'duration') {
    const previousTarget = goal.type === 'duration' ? goal.targetMinutes : 1;
    return {
      ...common,
      type: 'duration',
      targetMinutes: safeWholeNumber(update.target ?? previousTarget, 1, previousTarget),
    };
  }

  const previousTarget = goal.type === 'sessions' ? goal.targetSessions : 1;
  const previousMinimum = goal.type === 'sessions' ? goal.minimumSessionMinutes : 10;
  return {
    ...common,
    type: 'sessions',
    targetSessions: safeWholeNumber(update.target ?? previousTarget, 1, previousTarget),
    minimumSessionMinutes: safeWholeNumber(
      update.minimumSessionMinutes ?? previousMinimum,
      0,
      previousMinimum,
    ),
  };
}

function transitionGoal(
  goal: StudyGoal,
  status: StudyGoal['status'],
  changedAt: string,
): StudyGoal {
  if (status === 'paused') {
    return { ...goal, status, pausedAt: changedAt };
  }
  const closedPause = goal.pausedAt
    ? [...(goal.pausedIntervals ?? []), { startedAt: goal.pausedAt, endedAt: changedAt }]
    : goal.pausedIntervals;
  if (status === 'completed') {
    return {
      ...goal,
      status,
      pausedAt: undefined,
      pausedIntervals: closedPause,
      completedAt: changedAt,
    };
  }
  if (status === 'archived') {
    return {
      ...goal,
      status,
      pausedAt: undefined,
      pausedIntervals: closedPause,
      archivedAt: changedAt,
    };
  }
  return {
    ...goal,
    status,
    pausedAt: undefined,
    pausedIntervals: closedPause,
    completedAt: undefined,
    archivedAt: undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return isString(value) && Number.isFinite(new Date(value).getTime());
}

function optionalString(value: unknown): string | undefined {
  return isString(value) && value.trim() ? value.trim() : undefined;
}

function parseUser(value: unknown): StudyUser | null {
  if (!isRecord(value)) return null;
  if (!isString(value.id) || !isString(value.username) || !isString(value.displayName)) {
    return null;
  }
  return {
    id: value.id,
    username: value.username,
    displayName: value.displayName,
    avatarUrl: optionalString(value.avatarUrl),
    avatarInitials: optionalString(value.avatarInitials),
    avatarColor: optionalString(value.avatarColor),
  };
}

function parseSubject(value: unknown): Subject | null {
  if (!isRecord(value)) return null;
  if (
    !isString(value.id) ||
    !isString(value.name) ||
    !isString(value.color) ||
    !isString(value.icon)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    icon: value.icon,
    archived: typeof value.archived === 'boolean' ? value.archived : undefined,
  };
}

function parseSession(value: unknown): StudySession | null {
  if (!isRecord(value)) return null;
  if (
    !isString(value.id) ||
    !isString(value.userId) ||
    !isString(value.subjectId) ||
    !isIsoDate(value.startedAt) ||
    !isIsoDate(value.endedAt) ||
    !isIsoDate(value.createdAt) ||
    !isFiniteNumber(value.durationMinutes) ||
    value.durationMinutes < 0
  ) {
    return null;
  }
  const base = {
    id: value.id,
    userId: value.userId,
    subjectId: value.subjectId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    createdAt: value.createdAt,
    durationMinutes: value.durationMinutes,
    note: optionalString(value.note),
  };

  if (value.source === 'manual' && isIsoDate(value.enteredAt)) {
    return { ...base, source: 'manual', enteredAt: value.enteredAt };
  }
  if (value.source !== 'timer' || !Array.isArray(value.segments)) return null;
  const segments = value.segments.flatMap((segment) => {
    if (!isRecord(segment) || !isIsoDate(segment.startedAt) || !isIsoDate(segment.endedAt)) {
      return [];
    }
    return [{ startedAt: segment.startedAt, endedAt: segment.endedAt }];
  });
  return { ...base, source: 'timer', segments };
}

function parseActiveTimer(value: unknown): ActiveTimer | null {
  if (!isRecord(value) || !Array.isArray(value.segments)) return null;
  if (
    !isString(value.id) ||
    !isString(value.userId) ||
    !isString(value.subjectId) ||
    !isIsoDate(value.startedAt) ||
    !isIsoDate(value.updatedAt) ||
    (value.status !== 'running' && value.status !== 'paused')
  ) {
    return null;
  }
  const segments = value.segments.flatMap((segment) => {
    if (!isRecord(segment) || !isIsoDate(segment.startedAt)) return [];
    if (segment.endedAt !== null && !isIsoDate(segment.endedAt)) return [];
    return [{ startedAt: segment.startedAt, endedAt: segment.endedAt }];
  });
  const openSegments = segments.filter((segment) => segment.endedAt === null);
  const hasValidShape = value.status === 'running'
    ? openSegments.length === 1 && segments.at(-1)?.endedAt === null
    : openSegments.length === 0;
  if (!hasValidShape || segments.length === 0) return null;

  return {
    schemaVersion: 1,
    id: value.id,
    userId: value.userId,
    subjectId: value.subjectId,
    status: value.status,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    note: optionalString(value.note),
    segments,
  };
}

function parseGoal(value: unknown): StudyGoal | null {
  if (!isRecord(value)) return null;
  const period = value.period;
  const status = value.status;
  if (
    !isString(value.id) ||
    !isString(value.userId) ||
    !isIsoDate(value.createdAt) ||
    (period !== 'week' && period !== 'month' && period !== 'year') ||
    (value.sourcePolicy !== 'all' && value.sourcePolicy !== 'timer_only') ||
    (status !== 'active' &&
      status !== 'paused' &&
      status !== 'completed' &&
      status !== 'archived')
  ) {
    return null;
  }
  const subjectIds = Array.isArray(value.subjectIds)
    ? value.subjectIds.filter(isString)
    : undefined;
  const pausedIntervals = Array.isArray(value.pausedIntervals)
    ? value.pausedIntervals.flatMap((interval) => {
        if (
          !isRecord(interval) ||
          !isIsoDate(interval.startedAt) ||
          !isIsoDate(interval.endedAt)
        ) {
          return [];
        }
        return [{ startedAt: interval.startedAt, endedAt: interval.endedAt }];
      })
    : undefined;
  const normalizedPeriod: GoalPeriod = period;
  const normalizedSourcePolicy: GoalSourcePolicy = value.sourcePolicy;
  const normalizedStatus: GoalStatus = status;
  const common = {
    id: value.id,
    userId: value.userId,
    title: optionalString(value.title),
    period: normalizedPeriod,
    sourcePolicy: normalizedSourcePolicy,
    subjectIds: subjectIds?.length ? subjectIds : undefined,
    status: normalizedStatus,
    createdAt: value.createdAt,
    startsAt: isIsoDate(value.startsAt) ? value.startsAt : value.createdAt,
    pausedAt: isIsoDate(value.pausedAt) ? value.pausedAt : undefined,
    pausedIntervals: pausedIntervals?.length ? pausedIntervals : undefined,
    completedAt: isIsoDate(value.completedAt) ? value.completedAt : undefined,
    archivedAt: isIsoDate(value.archivedAt) ? value.archivedAt : undefined,
  };

  if (value.type === 'duration' && isFiniteNumber(value.targetMinutes)) {
    return {
      ...common,
      type: 'duration',
      targetMinutes: Math.max(1, Math.round(value.targetMinutes)),
    };
  }
  if (
    value.type === 'sessions' &&
    isFiniteNumber(value.targetSessions) &&
    isFiniteNumber(value.minimumSessionMinutes)
  ) {
    return {
      ...common,
      type: 'sessions',
      targetSessions: Math.max(1, Math.round(value.targetSessions)),
      minimumSessionMinutes: Math.max(0, value.minimumSessionMinutes),
    };
  }
  return null;
}

function parseFriendStats(value: unknown): FriendStudySnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const numericKeys = [
    'weekMinutes',
    'automaticMinutes',
    'manualMinutes',
    'timerSessionCount',
    'weeklyGoalMinutes',
    'streakDays',
  ] as const;
  if (numericKeys.some((key) => !isFiniteNumber(value[key]))) return undefined;
  if (
    value.changeFromPreviousWeekPercent !== null &&
    !isFiniteNumber(value.changeFromPreviousWeekPercent)
  ) {
    return undefined;
  }
  return {
    weekMinutes: value.weekMinutes as number,
    automaticMinutes: value.automaticMinutes as number,
    manualMinutes: value.manualMinutes as number,
    timerSessionCount: value.timerSessionCount as number,
    weeklyGoalMinutes: value.weeklyGoalMinutes as number,
    streakDays: value.streakDays as number,
    changeFromPreviousWeekPercent: value.changeFromPreviousWeekPercent as number | null,
  };
}

function parseFriend(value: unknown): Friend | null {
  if (!isRecord(value)) return null;
  const user = parseUser(value.user);
  if (
    !isString(value.id) ||
    !user ||
    (value.status !== 'accepted' &&
      value.status !== 'pending_sent' &&
      value.status !== 'pending_received') ||
    typeof value.canSeeMyStats !== 'boolean' ||
    typeof value.canSeeTheirStats !== 'boolean'
  ) {
    return null;
  }
  return {
    id: value.id,
    user,
    status: value.status,
    canSeeMyStats: value.canSeeMyStats,
    canSeeTheirStats: value.canSeeTheirStats,
    stats: parseFriendStats(value.stats),
  };
}

function parseChallenge(value: unknown): StudyChallenge | null {
  if (!isRecord(value) || !isRecord(value.target) || !Array.isArray(value.participants)) {
    return null;
  }
  if (
    !isString(value.id) ||
    !isString(value.creatorId) ||
    !isString(value.title) ||
    !isString(value.description) ||
    !isIsoDate(value.startsAt) ||
    !isIsoDate(value.endsAt) ||
    (value.sourcePolicy !== 'all' && value.sourcePolicy !== 'timer_only') ||
    (value.status !== 'upcoming' && value.status !== 'active' && value.status !== 'completed') ||
    (value.target.mode !== 'shared' && value.target.mode !== 'per_participant')
  ) {
    return null;
  }
  const participants: ChallengeParticipant[] = value.participants.flatMap((participant) => {
    if (
      !isRecord(participant) ||
      !isString(participant.userId) ||
      (participant.status !== 'invited' &&
        participant.status !== 'accepted' &&
        participant.status !== 'declined' &&
        participant.status !== 'withdrawn') ||
      !isFiniteNumber(participant.contributionMinutes) ||
      !isFiniteNumber(participant.timerSessionCount)
    ) {
      return [];
    }
    const participantStatus: ChallengeParticipant['status'] = participant.status;
    return [{
      userId: participant.userId,
      status: participantStatus,
      contributionMinutes: participant.contributionMinutes,
      timerSessionCount: participant.timerSessionCount,
    }];
  });
  const mode: ChallengeMode = value.target.mode;
  const target = value.target.type === 'duration' && isFiniteNumber(value.target.targetMinutes)
    ? {
        type: 'duration' as const,
        mode,
        targetMinutes: value.target.targetMinutes,
      }
    : value.target.type === 'sessions' &&
        isFiniteNumber(value.target.targetSessions) &&
        isFiniteNumber(value.target.minimumSessionMinutes)
      ? {
          type: 'sessions' as const,
          mode,
          targetSessions: value.target.targetSessions,
          minimumSessionMinutes: value.target.minimumSessionMinutes,
        }
      : null;
  if (!target) return null;

  return {
    id: value.id,
    creatorId: value.creatorId,
    title: value.title,
    description: value.description,
    target,
    sourcePolicy: value.sourcePolicy,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    status: value.status,
    participants,
  };
}

function parsePrivacy(value: unknown): PrivacyPreferences {
  if (!isRecord(value)) return { ...defaultPrivacy };
  return {
    friendComparisonsEnabled:
      typeof value.friendComparisonsEnabled === 'boolean'
        ? value.friendComparisonsEnabled
        : defaultPrivacy.friendComparisonsEnabled,
    shareAutomaticMinutes:
      typeof value.shareAutomaticMinutes === 'boolean'
        ? value.shareAutomaticMinutes
        : defaultPrivacy.shareAutomaticMinutes,
    shareGoalProgress:
      typeof value.shareGoalProgress === 'boolean'
        ? value.shareGoalProgress
        : defaultPrivacy.shareGoalProgress,
    shareStreak:
      typeof value.shareStreak === 'boolean'
        ? value.shareStreak
        : defaultPrivacy.shareStreak,
  };
}

function parseData(value: unknown): StudyData | null {
  if (!isRecord(value)) return null;
  const subjects = Array.isArray(value.subjects)
    ? value.subjects.map(parseSubject).filter((entry): entry is Subject => entry !== null)
    : [];
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.map(parseSession).filter((entry): entry is StudySession => entry !== null)
    : [];
  const goals = Array.isArray(value.goals)
    ? value.goals.map(parseGoal).filter((entry): entry is StudyGoal => entry !== null)
    : [];
  const friends = Array.isArray(value.friends)
    ? value.friends.map(parseFriend).filter((entry): entry is Friend => entry !== null)
    : [];
  const challenges = Array.isArray(value.challenges)
    ? value.challenges
        .map(parseChallenge)
        .filter((entry): entry is StudyChallenge => entry !== null)
    : [];

  return {
    currentUser: value.currentUser === null ? null : parseUser(value.currentUser),
    subjects,
    sessions,
    goals,
    friends,
    challenges,
    activeTimer: value.activeTimer === null ? null : parseActiveTimer(value.activeTimer),
  };
}

function removeLegacyDemoContent(data: StudyData): StudyData {
  const sessions = data.sessions.filter((session) => !LEGACY_SEEDED_SESSION_IDS.has(session.id));
  const goals = data.goals.filter((goal) => !LEGACY_SEEDED_GOAL_IDS.has(goal.id));
  const activeTimer = data.activeTimer;
  const referencedSubjects = new Set([
    ...sessions.map((session) => session.subjectId),
    ...goals.flatMap((goal) => goal.subjectIds ?? []),
    ...(activeTimer ? [activeTimer.subjectId] : []),
  ]);
  const subjects = data.subjects
    .filter((subject) => referencedSubjects.has(subject.id))
    .map((subject, index) => ({
      ...subject,
      color: subjectColorPalette[index % subjectColorPalette.length],
    }));

  return {
    currentUser: data.currentUser?.id === 'user-lea' ? null : data.currentUser,
    subjects,
    sessions,
    goals,
    friends: data.friends.filter((friend) => !LEGACY_SEEDED_FRIEND_IDS.has(friend.id)),
    challenges: data.challenges.filter(
      (challenge) => !LEGACY_SEEDED_CHALLENGE_IDS.has(challenge.id),
    ),
    activeTimer,
  };
}

/** Parses current data and safely upgrades the former demo-backed v1 payload. */
export function migratePersistedStudyState(value: unknown): StudyState | null {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) {
    return null;
  }
  const data = parseData(value.data);
  if (!data) return null;
  return {
    data: value.schemaVersion === 1 ? removeLegacyDemoContent(data) : data,
    privacy: parsePrivacy(value.privacy),
  };
}

const StudyStoreContext = createContext<StudyStoreValue | null>(null);

interface StudyStoreProviderProps extends PropsWithChildren {
  /** Keeps local caches isolated between authenticated users and local mode. */
  storageScope?: string;
}

function scopedStorageKey(storageScope: string): string {
  const safeScope = storageScope.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'local';
  return `${STORAGE_KEY_PREFIX}.${safeScope}`;
}

export function StudyStoreProvider({ children, storageScope = 'local' }: StudyStoreProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialStudyState);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = scopedStorageKey(storageScope);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
        ?? (storageScope === 'local' ? localStorage.getItem(LEGACY_STORAGE_KEY) : null);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const migrated = migratePersistedStudyState(parsed);
        if (migrated) dispatch({ type: 'hydrate', payload: migrated });
      }
    } catch {
      // Corrupt or unavailable storage must never prevent an empty app start.
    } finally {
      setHydrated(true);
    }
  }, [storageKey, storageScope]);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedStudyState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...state,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      if (storageScope === 'local') localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // In-memory usage remains available when storage is temporarily unavailable.
    }
  }, [hydrated, state, storageKey, storageScope]);

  const value = useMemo<StudyStoreValue>(() => {
    const addSubject = (name: string): Subject => {
      const cleanName = name.trim() || 'Allgemein';
      const existing = state.data.subjects.find(
        (subject) => subject.name.toLocaleLowerCase('de-DE') === cleanName.toLocaleLowerCase('de-DE'),
      );
      if (existing) return existing;
      const subject: Subject = {
        id: makeId('subject'),
        name: cleanName,
        color: subjectColorPalette[state.data.subjects.length % subjectColorPalette.length],
        icon: 'book',
      };
      dispatch({ type: 'add-subject', payload: subject });
      return subject;
    };

    const updateLocalProfile = (profile: LocalProfileUpdate): StudyUser | null => {
      const previous = state.data.currentUser;
      const displayName = profile.displayName?.trim() ?? previous?.displayName ?? '';
      const username = profile.username === undefined
        ? previous?.username ?? normalizeUsername(displayName)
        : normalizeUsername(profile.username);
      if (!displayName || !username) return null;
      const user: StudyUser = {
        id: previous?.id ?? LOCAL_USER_ID,
        displayName,
        username,
        avatarUrl: profile.avatarUrl === null
          ? undefined
          : profile.avatarUrl?.trim() || previous?.avatarUrl,
        avatarColor: profile.avatarColor ?? previous?.avatarColor ?? subjectColorPalette[0],
        avatarInitials: initialsForName(displayName),
      };
      dispatch({ type: 'set-current-user', payload: user });
      return user;
    };

    const startTimer = (subjectId: string): ActiveTimer | null => {
      if (state.data.activeTimer || !subjectId.trim()) return null;
      const now = new Date().toISOString();
      const timer: ActiveTimer = {
        schemaVersion: 1,
        id: makeId('timer'),
        userId: actorId(state.data),
        subjectId,
        status: 'running',
        startedAt: now,
        segments: [{ startedAt: now, endedAt: null }],
        updatedAt: now,
      };
      dispatch({ type: 'set-active-timer', payload: timer });
      return timer;
    };

    const pauseTimer = (): ActiveTimer | null => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'running') return null;
      const paused = pauseActiveTimer(timer);
      dispatch({ type: 'set-active-timer', payload: paused });
      return paused;
    };

    const resumeTimer = (): ActiveTimer | null => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'paused') return null;
      const resumed = resumeActiveTimer(timer);
      dispatch({ type: 'set-active-timer', payload: resumed });
      return resumed;
    };

    const finishTimer = (
      options: FinishTimerOptions = {},
    ): TimerStudySession | null => {
      const active = state.data.activeTimer;
      if (!active) return null;
      const now = new Date();
      if (
        !options.allowShortSession &&
        getTimerFinishDecision(active, now) === 'confirm_short_session'
      ) {
        return null;
      }
      const session = buildTimerSession(active, now);
      dispatch({ type: 'finish-timer', payload: session });
      return session;
    };

    const addManualEntry = (entry: NewManualEntry): ManualStudySession => {
      const requestedStart = new Date(`${entry.studiedOn}T12:00:00`);
      const start = Number.isFinite(requestedStart.getTime()) ? requestedStart : new Date();
      const safeMinutes = safeWholeNumber(entry.durationMinutes, 1, 1);
      const end = new Date(start.getTime() + safeMinutes * 60_000);
      const now = new Date().toISOString();
      const session: ManualStudySession = {
        id: makeId('manual'),
        userId: actorId(state.data),
        subjectId: entry.subjectId,
        source: 'manual',
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        enteredAt: now,
        createdAt: now,
        durationMinutes: safeMinutes,
        note: cleanOptionalText(entry.note),
      };
      dispatch({ type: 'add-manual-entry', payload: session });
      return session;
    };

    const createGoal = (input: NewGoal): StudyGoal => {
      const goal = createStudyGoal(input, actorId(state.data), new Date());
      dispatch({ type: 'add-goal', payload: goal });
      return goal;
    };

    const updateGoal = (goalId: string, update: GoalUpdate): StudyGoal | null => {
      const existing = state.data.goals.find((goal) => goal.id === goalId);
      if (!existing) return null;
      const updated = applyGoalUpdate(existing, update);
      dispatch({ type: 'replace-goal', payload: updated });
      return updated;
    };

    const setGoalStatus = (
      goalId: string,
      status: StudyGoal['status'],
    ): StudyGoal | null => {
      const existing = state.data.goals.find((goal) => goal.id === goalId);
      if (!existing || existing.status === status) return existing ?? null;
      if (status === 'paused' && existing.status !== 'active') return null;
      if (status === 'active' && existing.status !== 'paused') return null;
      if (status === 'completed' && existing.status === 'archived') return null;
      const updated = transitionGoal(existing, status, new Date().toISOString());
      dispatch({ type: 'replace-goal', payload: updated });
      return updated;
    };

    const clearAllData = () => {
      try {
        localStorage.removeItem(storageKey);
        if (storageScope === 'local') localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // The reducer still clears every in-memory user value.
      }
      dispatch({ type: 'reset' });
    };

    return {
      ...state,
      hydrated,
      addSubject,
      updateLocalProfile,
      clearLocalProfile: () => dispatch({ type: 'set-current-user', payload: null }),
      startTimer,
      pauseTimer,
      resumeTimer,
      finishTimer,
      discardTimer: () => dispatch({ type: 'set-active-timer', payload: null }),
      addManualEntry,
      createGoal,
      addGoal: createGoal,
      updateGoal,
      pauseGoal: (goalId) => setGoalStatus(goalId, 'paused'),
      resumeGoal: (goalId) => setGoalStatus(goalId, 'active'),
      completeGoal: (goalId) => setGoalStatus(goalId, 'completed'),
      archiveGoal: (goalId) => setGoalStatus(goalId, 'archived'),
      deleteGoal: (goalId) => dispatch({ type: 'delete-goal', payload: goalId }),
      setFriendComparisonsEnabled: (enabled) =>
        dispatch({ type: 'set-friend-comparisons', payload: enabled }),
      setPrivacyPreference: (key, enabled) =>
        dispatch({ type: 'set-privacy-preference', key, payload: enabled }),
      clearAllData,
    };
  }, [hydrated, state, storageKey, storageScope]);

  return <StudyStoreContext value={value}>{children}</StudyStoreContext>;
}

export function useStudyStore(): StudyStoreValue {
  const context = use(StudyStoreContext);
  if (!context) throw new Error('useStudyStore must be used inside StudyStoreProvider');
  return context;
}
