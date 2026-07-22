import {
  useCallback,
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { randomUUID } from 'expo-crypto';

import { supabase } from '@/auth/supabase';
import { createInitialData, subjectColorPalette } from '@/data/initial-data';
import { createLocalStudyRepository } from '@/data/repositories/local-study-repository';
import { asRepositoryError } from '@/data/repositories/repository-error';
import {
  type CreateSharedGoalInput,
  type LocalImportReport,
  type SyncStatus,
  type StudyRepository,
} from '@/data/repositories/study-repository';
import { createSupabaseStudyRepository } from '@/data/repositories/supabase-study-repository';
import { useNetworkStatus } from '@/hooks/use-network-status';
import '@/lib/local-storage';
import { isValidGradeDate } from '@/lib/grades';
import { prepareAvatarUpload } from '@/lib/avatar-upload';
import { getGoalSubjectId, getGoalTitle } from '@/lib/goals';
import {
  assignStudyStateToAccount,
  mergeLocalStudyStateIntoAccount,
  type StudyStateSnapshot,
} from '@/lib/study-state-transfer';
import {
  createLocalImportManifest,
  ImportCoordinator,
  type ImportProgress,
  sha256Hex,
  stableStringify,
} from '@/services/sync/import-coordinator';
import {
  buildTimerSession,
  getTimerFinishDecision,
  pauseActiveTimer,
  resumeActiveTimer,
} from '@/lib/timer';
import type {
  AccountStudyUser,
  ActiveTimer,
  ChallengeMode,
  ChallengeParticipant,
  FriendProfileStatistics,
  FriendSearchResult,
  FriendshipConnection,
  Friend,
  FriendStudySnapshot,
  GradeAssessmentType,
  GoalPeriod,
  GoalSourcePolicy,
  GoalStatus,
  ManualStudySession,
  SessionSource,
  StudyChallenge,
  StudyData,
  StudyGrade,
  StudyGoal,
  StudySession,
  StudySharingPreferences,
  StudyUser,
  SharedGoalProgress,
  Subject,
  TimerStudySession,
} from '@/types/study';

const LEGACY_STORAGE_KEY = 'lernzeit.study-state.v1';
const STORAGE_KEY_PREFIX = 'lernzeit.study-state.v2';
const IMPORT_DECISION_KEY_PREFIX = 'lernzeit.study-import.v2';
const DEVICE_FINGERPRINT_KEY = 'lernzeit.device-fingerprint.v1';
const CURRENT_SCHEMA_VERSION = 3;
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
  shareManualMinutes: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
}

export interface StudyState {
  data: StudyData;
  privacy: PrivacyPreferences;
}

export interface LocalImportPreview {
  subjects: number;
  sessions: number;
  goals: number;
  grades: number;
  hasActiveTimer: boolean;
  warnings: readonly string[];
}

export type MigrationStatus =
  | 'idle'
  | 'preview'
  | 'importing'
  | 'completed'
  | 'completed_with_conflicts'
  | 'error';

interface PersistedStudyState extends StudyState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
}

export interface NewManualEntry {
  /** Optional when `goalId` resolves to exactly one subject. */
  subjectId?: string;
  goalId?: string | null;
  durationMinutes: number;
  studiedOn: string;
  note?: string;
}

export interface NewGrade {
  subjectId: string;
  assessmentType: GradeAssessmentType;
  title?: string;
  assessmentDate?: string;
  points: number;
  additionalStudyMinutes: number;
  sessionIds: readonly string[];
}

export interface StartTimerOptions {
  /** Optional when `goalId` resolves to exactly one subject. */
  subjectId?: string;
  goalId?: string | null;
  plannedDurationMinutes?: number;
  note?: string;
}

export interface StartTimer {
  (subjectId: string, options?: Omit<StartTimerOptions, 'subjectId'>): ActiveTimer | null;
  (options: StartTimerOptions): ActiveTimer | null;
}

export interface NewGoal {
  title: string;
  type: 'duration' | 'sessions';
  /** Minutes for duration goals, session count for session goals. */
  target: number;
  subjectId: string;
  sourcePolicy: GoalSourcePolicy;
  period?: GoalPeriod;
  startsAt?: string;
  endsAt?: string;
  minimumSessionMinutes?: number;
}

export interface GoalUpdate {
  title?: string | null;
  type?: 'duration' | 'sessions';
  target?: number;
  subjectId?: string | null;
  sourcePolicy?: GoalSourcePolicy;
  period?: GoalPeriod;
  startsAt?: string | null;
  endsAt?: string | null;
  minimumSessionMinutes?: number;
}

export interface LocalProfileUpdate {
  userId?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  avatarColor?: string;
}

export interface AccountProfileUpdate {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  timeZone?: string;
}

export interface AvatarUploadAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

export interface FinishTimerOptions {
  /** The UI must obtain explicit confirmation before setting this for <60 s. */
  allowShortSession?: boolean;
}

export interface StudyStoreValue extends StudyState {
  hydrated: boolean;
  localImportPreview: LocalImportPreview | null;
  migrationStatus: MigrationStatus;
  migrationProgress: ImportProgress | null;
  migrationError: string | null;
  migrationReport: LocalImportReport | null;
  confirmLocalImport: () => Promise<StudyState | null>;
  acknowledgeLocalImportReport: () => void;
  deferLocalImport: () => void;
  syncStatus: SyncStatus;
  pendingMutationCount: number;
  lastSyncError: string | null;
  retrySync: () => Promise<void>;
  socialLoading: boolean;
  socialError: string | null;
  friendConnections: readonly FriendshipConnection[];
  sharingPreferences: StudySharingPreferences | null;
  refreshSocial: () => Promise<void>;
  updateAccountProfile: (profile: AccountProfileUpdate) => Promise<AccountStudyUser | null>;
  uploadAvatar: (asset: AvatarUploadAsset) => Promise<string | null>;
  findFriendByUsername: (username: string) => Promise<FriendSearchResult | null>;
  sendFriendRequest: (username: string) => Promise<void>;
  acceptFriendRequest: (friendshipId: string) => Promise<void>;
  declineFriendRequest: (friendshipId: string) => Promise<void>;
  removeFriendship: (friendshipId: string) => Promise<void>;
  getFriendProfileStats: (friendId: string) => Promise<FriendProfileStatistics>;
  createSharedGoal: (input: CreateSharedGoalInput) => Promise<StudyChallenge | null>;
  respondSharedGoalInvitation: (
    goalId: string,
    accept: boolean,
  ) => Promise<StudyChallenge | null>;
  withdrawFromSharedGoal: (goalId: string) => Promise<void>;
  getSharedGoalDetails: (goalId: string) => Promise<StudyChallenge | null>;
  getSharedGoalProgress: (goalId: string) => Promise<SharedGoalProgress | null>;
  subscribeSharedGoalProgress: StudyRepository['subscribeSharedGoalProgress'];
  addSubject: (name: string) => Subject;
  updateLocalProfile: (profile: LocalProfileUpdate) => StudyUser | null;
  clearLocalProfile: () => void;
  startTimer: StartTimer;
  pauseTimer: () => ActiveTimer | null;
  resumeTimer: () => ActiveTimer | null;
  finishTimer: (options?: FinishTimerOptions) => TimerStudySession | null;
  discardTimer: () => void;
  addManualEntry: (entry: NewManualEntry) => ManualStudySession | null;
  deleteSession: (sessionId: string) => boolean;
  addGrade: (grade: NewGrade) => StudyGrade | null;
  deleteGrade: (gradeId: string) => boolean;
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
  | { type: 'delete-session'; payload: string }
  | { type: 'add-grade'; payload: StudyGrade }
  | { type: 'delete-grade'; payload: string }
  | { type: 'add-goal'; payload: StudyGoal }
  | { type: 'replace-goal'; payload: StudyGoal }
  | { type: 'delete-goal'; payload: string }
  | { type: 'upsert-challenge'; payload: StudyChallenge }
  | { type: 'withdraw-from-challenge'; payload: { goalId: string; userId: string } }
  | {
      type: 'apply-account-profile';
      payload: {
        profile: StudyUser;
        sharing: StudySharingPreferences;
      };
    }
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
  shareManualMinutes: false,
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
      if (state.data.sessions.some((session) => session.id === action.payload.id)) {
        return {
          ...state,
          data: { ...state.data, activeTimer: null },
        };
      }
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
    case 'delete-session':
      return {
        ...state,
        data: {
          ...state.data,
          sessions: state.data.sessions.filter((session) => session.id !== action.payload),
          grades: state.data.grades.map((grade) => ({
            ...grade,
            sessionIds: grade.sessionIds.filter((sessionId) => sessionId !== action.payload),
          })),
        },
      };
    case 'add-grade':
      return {
        ...state,
        data: { ...state.data, grades: [action.payload, ...state.data.grades] },
      };
    case 'delete-grade':
      return {
        ...state,
        data: {
          ...state.data,
          grades: state.data.grades.filter((grade) => grade.id !== action.payload),
        },
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
    case 'upsert-challenge': {
      const exists = state.data.challenges.some(
        (challenge) => challenge.id === action.payload.id,
      );
      return {
        ...state,
        data: {
          ...state.data,
          challenges: exists
            ? state.data.challenges.map((challenge) =>
                challenge.id === action.payload.id ? action.payload : challenge,
              )
            : [action.payload, ...state.data.challenges],
        },
      };
    }
    case 'withdraw-from-challenge':
      return {
        ...state,
        data: {
          ...state.data,
          challenges: state.data.challenges.map((challenge) =>
            challenge.id !== action.payload.goalId
              ? challenge
              : {
                  ...challenge,
                  participants: challenge.participants.map((participant) =>
                    participant.userId === action.payload.userId
                      ? { ...participant, status: 'withdrawn' as const }
                      : participant,
                  ),
                },
          ),
        },
      };
    case 'apply-account-profile':
      return {
        data: { ...state.data, currentUser: action.payload.profile },
        privacy: {
          ...state.privacy,
          shareAutomaticMinutes: action.payload.sharing.shareTimerStats,
          shareManualMinutes: action.payload.sharing.shareManualStats,
          shareGoalProgress: action.payload.sharing.shareGoalProgress,
          shareStreak: action.payload.sharing.shareStreak,
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

function makeId(_prefix: string): string {
  return randomUUID();
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

interface ResolvedSessionBinding {
  goalId: string | null;
  subjectId: string;
  goalTitleSnapshot?: string;
  subjectNameSnapshot: string;
}

/**
 * Resolves a goal/subject pair without guessing. A legacy goal without a
 * subject stays valid data, but cannot receive new sessions until assigned.
 */
function resolveSessionBinding(
  data: StudyData,
  requestedSubjectId: string | undefined,
  requestedGoalId: string | null | undefined,
  source: SessionSource,
): ResolvedSessionBinding | null {
  const goalId = cleanOptionalText(requestedGoalId);
  const explicitSubjectId = cleanOptionalText(requestedSubjectId);
  const goal = goalId
    ? data.goals.find((entry) => entry.id === goalId)
    : undefined;
  const sharedGoal = goalId
    ? data.challenges.find((entry) => entry.id === goalId)
    : undefined;

  if (
    goalId &&
    !goal &&
    (
      !sharedGoal ||
      sharedGoal.status !== 'active' ||
      !sharedGoal.participants.some(
        (participant) => participant.userId === actorId(data) && participant.status === 'accepted',
      )
    )
  ) {
    return null;
  }

  if (goal && (goal.status !== 'active' || goal.userId !== actorId(data))) {
    return null;
  }
  if ((goal ?? sharedGoal)?.sourcePolicy === 'timer_only' && source !== 'timer') {
    return null;
  }

  const boundGoalSubjectId = goal ? getGoalSubjectId(goal) ?? undefined : undefined;
  if (goal && !boundGoalSubjectId) return null;
  if (goal && explicitSubjectId && explicitSubjectId !== boundGoalSubjectId) return null;

  const subjectId = goal ? boundGoalSubjectId : explicitSubjectId;
  if (!subjectId) return null;

  const subject = data.subjects.find(
    (entry) => entry.id === subjectId && !entry.archived,
  );
  if (!subject) return null;

  return {
    goalId: goal?.id ?? sharedGoal?.id ?? null,
    subjectId: subject.id,
    goalTitleSnapshot: goal
      ? getGoalTitle(goal, data.subjects)
      : sharedGoal?.title,
    subjectNameSnapshot: subject.name,
  };
}

function parseStartDate(value: string | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isFinite(dateOnly.getTime()) ? dateOnly.toISOString() : fallback.toISOString();
}

function parseEndDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999`)
    : new Date(value);
  return Number.isFinite(dateOnly.getTime()) ? dateOnly.toISOString() : undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function createStudyGoal(input: NewGoal, userId: string, now: Date): StudyGoal {
  const subjectId = input.subjectId.trim();
  const common = {
    id: makeId('goal'),
    userId,
    title: cleanOptionalText(input.title),
    period: input.period ?? ('week' as const),
    sourcePolicy: input.sourcePolicy,
    subjectId,
    subjectIds: [subjectId],
    status: 'active' as const,
    createdAt: now.toISOString(),
    startsAt: parseStartDate(input.startsAt, now),
    endsAt: parseEndDate(input.endsAt),
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
  let subjectId = goal.subjectId ??
    (goal.subjectIds?.length === 1 ? goal.subjectIds[0] : undefined);
  let subjectIds = goal.subjectIds;

  if (hasOwn(update, 'subjectId')) {
    subjectId = cleanOptionalText(update.subjectId);
    subjectIds = subjectId ? [subjectId] : undefined;
  }

  const common = {
    id: goal.id,
    userId: goal.userId,
    title: nextTitle,
    period: update.period ?? goal.period,
    sourcePolicy: update.sourcePolicy ?? goal.sourcePolicy,
    subjectId,
    subjectIds: subjectIds?.length ? [...new Set(subjectIds)] : undefined,
    status: goal.status,
    createdAt: goal.createdAt,
    startsAt: hasOwn(update, 'startsAt')
      ? update.startsAt
        ? parseStartDate(update.startsAt, new Date(goal.startsAt ?? goal.createdAt))
        : undefined
      : goal.startsAt,
    endsAt: hasOwn(update, 'endsAt')
      ? parseEndDate(update.endsAt ?? undefined)
      : goal.endsAt,
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

function parsedGoalId(record: Record<string, unknown>): { goalId?: string | null } {
  if (!hasOwn(record, 'goalId')) return {};
  const value = record.goalId;
  if (value === null) return { goalId: null };
  const id = optionalString(value);
  return id ? { goalId: id } : {};
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
    value.durationMinutes < 0 ||
    (value.status !== undefined && value.status !== 'completed')
  ) {
    return null;
  }
  const base = {
    id: value.id,
    userId: value.userId,
    ...parsedGoalId(value),
    subjectId: value.subjectId,
    goalTitleSnapshot: optionalString(value.goalTitleSnapshot),
    subjectNameSnapshot: optionalString(value.subjectNameSnapshot),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    createdAt: value.createdAt,
    durationMinutes: value.durationMinutes,
    plannedDurationMinutes:
      isFiniteNumber(value.plannedDurationMinutes) && value.plannedDurationMinutes > 0
        ? Math.max(1, Math.round(value.plannedDurationMinutes))
        : undefined,
    note: optionalString(value.note),
    status: 'completed' as const,
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

function parseGrade(value: unknown): StudyGrade | null {
  if (!isRecord(value)) return null;
  const title = optionalString(value.title);
  const assessmentDate = optionalString(value.assessmentDate);
  if (
    !isString(value.id) ||
    !isString(value.userId) ||
    !isString(value.subjectId) ||
    (value.assessmentType !== 'exam' && value.assessmentType !== 'other') ||
    (assessmentDate !== undefined && !isValidGradeDate(assessmentDate)) ||
    !isFiniteNumber(value.points) ||
    !Number.isInteger(value.points) ||
    value.points < 0 ||
    value.points > 15 ||
    !isFiniteNumber(value.additionalStudyMinutes) ||
    !Number.isInteger(value.additionalStudyMinutes) ||
    value.additionalStudyMinutes < 0 ||
    !Array.isArray(value.sessionIds) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return null;
  }

  const sessionIds = [...new Set(
    value.sessionIds
      .filter(isString)
      .map((sessionId) => sessionId.trim())
      .filter(Boolean),
  )];

  return {
    id: value.id,
    userId: value.userId,
    subjectId: value.subjectId,
    subjectNameSnapshot: optionalString(value.subjectNameSnapshot),
    assessmentType: value.assessmentType,
    ...(title ? { title } : {}),
    ...(assessmentDate ? { assessmentDate } : {}),
    points: value.points,
    additionalStudyMinutes: value.additionalStudyMinutes,
    sessionIds,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
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
    ...parsedGoalId(value),
    subjectId: value.subjectId,
    goalTitleSnapshot: optionalString(value.goalTitleSnapshot),
    subjectNameSnapshot: optionalString(value.subjectNameSnapshot),
    status: value.status,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    plannedDurationMinutes:
      isFiniteNumber(value.plannedDurationMinutes) && value.plannedDurationMinutes > 0
        ? Math.max(1, Math.round(value.plannedDurationMinutes))
        : undefined,
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
    (period !== 'day' &&
      period !== 'week' &&
      period !== 'month' &&
      period !== 'year' &&
      period !== 'custom') ||
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
  const subjectId = isString(value.subjectId) && value.subjectId.trim()
    ? value.subjectId.trim()
    : subjectIds?.length === 1
      ? subjectIds[0]
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
    subjectId,
    subjectIds: subjectId ? [subjectId] : subjectIds?.length ? subjectIds : undefined,
    status: normalizedStatus,
    createdAt: value.createdAt,
    startsAt: isIsoDate(value.startsAt) ? value.startsAt : value.createdAt,
    endsAt: isIsoDate(value.endsAt) ? value.endsAt : undefined,
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
        participant.status !== 'withdrawn')
    ) {
      return [];
    }
    const participantStatus: ChallengeParticipant['status'] = participant.status;
    return [{
      userId: participant.userId,
      status: participantStatus,
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
    shareManualMinutes:
      typeof value.shareManualMinutes === 'boolean'
        ? value.shareManualMinutes
        : defaultPrivacy.shareManualMinutes,
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
  const parsedSessions = Array.isArray(value.sessions)
    ? value.sessions.map(parseSession).filter((entry): entry is StudySession => entry !== null)
    : [];
  const seenSessionIds = new Set<string>();
  const sessions = parsedSessions.filter((session) => {
    if (seenSessionIds.has(session.id)) return false;
    seenSessionIds.add(session.id);
    return true;
  });
  const parsedGrades = Array.isArray(value.grades)
    ? value.grades.map(parseGrade).filter((entry): entry is StudyGrade => entry !== null)
    : [];
  const seenGradeIds = new Set<string>();
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const grades = parsedGrades.flatMap((grade) => {
    if (seenGradeIds.has(grade.id)) return [];
    seenGradeIds.add(grade.id);
    return [{
      ...grade,
      sessionIds: grade.sessionIds.filter((sessionId) => {
        const session = sessionById.get(sessionId);
        return session?.userId === grade.userId && session.subjectId === grade.subjectId;
      }),
    }];
  });
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

  const parsedActiveTimer = value.activeTimer === null
    ? null
    : parseActiveTimer(value.activeTimer);
  const activeTimer = parsedActiveTimer &&
    sessions.some((session) => session.id === parsedActiveTimer.id)
    ? null
    : parsedActiveTimer;

  return {
    currentUser: value.currentUser === null ? null : parseUser(value.currentUser),
    subjects,
    sessions,
    grades,
    goals,
    friends,
    challenges,
    activeTimer,
  };
}

function removeLegacyDemoContent(data: StudyData): StudyData {
  const sessions = data.sessions.filter((session) => !LEGACY_SEEDED_SESSION_IDS.has(session.id));
  const goals = data.goals.filter((goal) => !LEGACY_SEEDED_GOAL_IDS.has(goal.id));
  const activeTimer = data.activeTimer;
  const subjects = data.subjects;

  return {
    currentUser: data.currentUser?.id === 'user-lea' ? null : data.currentUser,
    subjects,
    sessions,
    grades: data.grades,
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
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3)
  ) {
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
  /** Optional device workspace copied once when an account is connected. */
  importStorageScope?: string;
  /** Authenticated owner used to rebind imported device records. */
  accountUserId?: string;
}

function scopedStorageKey(storageScope: string): string {
  const safeScope = storageScope.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'local';
  return `${STORAGE_KEY_PREFIX}.${safeScope}`;
}

function readStoredState(storageScope: string): {
  raw: string | null;
  state: StudyState | null;
} {
  const raw = localStorage.getItem(scopedStorageKey(storageScope))
    ?? (storageScope === 'local' ? localStorage.getItem(LEGACY_STORAGE_KEY) : null);
  if (!raw) return { raw: null, state: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    return { raw, state: migratePersistedStudyState(parsed) };
  } catch {
    return { raw, state: null };
  }
}

function getDeviceFingerprint(): string {
  try {
    const existing = localStorage.getItem(DEVICE_FINGERPRINT_KEY)?.trim();
    if (existing) return existing;
    const created = randomUUID();
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, created);
    return created;
  } catch {
    // The value is an idempotency aid, not an identity secret. A temporary
    // fingerprint still allows the import UI to remain usable without storage.
    return randomUUID();
  }
}

function sameSnapshot(left: StudyStateSnapshot, right: StudyStateSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rebaseEntityList<T extends { id: string }>(
  baseline: readonly T[],
  current: readonly T[],
  server: readonly T[],
): readonly T[] {
  const baselineById = new Map(baseline.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  const merged = new Map(server.map((entry) => [entry.id, entry]));

  for (const entry of baseline) {
    if (!currentById.has(entry.id)) merged.delete(entry.id);
  }
  for (const entry of current) {
    const previous = baselineById.get(entry.id);
    if (!previous || !sameValue(previous, entry)) merged.set(entry.id, entry);
  }

  const orderedIds = [
    ...current.map((entry) => entry.id),
    ...server.map((entry) => entry.id).filter((id) => !currentById.has(id)),
  ];
  return orderedIds.flatMap((id) => {
    const entry = merged.get(id);
    return entry ? [entry] : [];
  });
}

/**
 * Rebases edits made while a sync request was in flight onto the freshly
 * pulled server snapshot. This prevents a late response from replacing a
 * newer timer/session edit while still retaining remote-device changes.
 */
function rebaseOptimisticState(
  baseline: StudyStateSnapshot,
  current: StudyStateSnapshot,
  server: StudyStateSnapshot,
): StudyStateSnapshot {
  const currentUserChanged = !sameValue(baseline.data.currentUser, current.data.currentUser);
  const privacyValue = <K extends keyof PrivacyPreferences>(key: K): PrivacyPreferences[K] => (
    !sameValue(baseline.privacy[key], current.privacy[key])
      ? current.privacy[key]
      : server.privacy[key]
  );

  return {
    privacy: {
      friendComparisonsEnabled: current.privacy.friendComparisonsEnabled,
      shareAutomaticMinutes: privacyValue('shareAutomaticMinutes'),
      shareManualMinutes: privacyValue('shareManualMinutes'),
      shareGoalProgress: privacyValue('shareGoalProgress'),
      shareStreak: privacyValue('shareStreak'),
    },
    data: {
      currentUser: currentUserChanged ? current.data.currentUser : server.data.currentUser,
      subjects: rebaseEntityList(baseline.data.subjects, current.data.subjects, server.data.subjects),
      sessions: rebaseEntityList(baseline.data.sessions, current.data.sessions, server.data.sessions),
      grades: rebaseEntityList(baseline.data.grades, current.data.grades, server.data.grades),
      goals: rebaseEntityList(baseline.data.goals, current.data.goals, server.data.goals),
      friends: rebaseEntityList(baseline.data.friends, current.data.friends, server.data.friends),
      challenges: rebaseEntityList(
        baseline.data.challenges,
        current.data.challenges,
        server.data.challenges,
      ),
      activeTimer: current.data.activeTimer,
    },
  };
}

function localImportDecisionFingerprint(snapshot: StudyStateSnapshot): string {
  return sha256Hex(stableStringify({
    subjects: snapshot.data.subjects,
    goals: snapshot.data.goals,
    sessions: snapshot.data.sessions,
    grades: snapshot.data.grades,
    activeTimer: snapshot.data.activeTimer,
  }));
}

const INITIAL_SYNC_STATUS: Readonly<SyncStatus> = {
  phase: 'idle',
  pendingMutationCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

export function StudyStoreProvider({
  accountUserId,
  children,
  importStorageScope,
  storageScope = 'local',
}: StudyStoreProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialStudyState);
  const [hydrated, setHydrated] = useState(false);
  const [localImportPreview, setLocalImportPreview] = useState<LocalImportPreview | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>('idle');
  const [migrationProgress, setMigrationProgress] = useState<ImportProgress | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationReport, setMigrationReport] = useState<LocalImportReport | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_SYNC_STATUS);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [friendConnections, setFriendConnections] = useState<readonly FriendshipConnection[]>([]);
  const [sharingPreferences, setSharingPreferences] = useState<StudySharingPreferences | null>(null);
  const online = useNetworkStatus();
  const stateRef = useRef(state);
  const stateGenerationRef = useRef(0);
  const persistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const storageKey = scopedStorageKey(storageScope);
  const importDecisionKey = accountUserId
    ? `${IMPORT_DECISION_KEY_PREFIX}.${accountUserId}`
    : null;
  const repository = useMemo<StudyRepository>(() => {
    if (accountUserId && supabase) {
      return createSupabaseStudyRepository({
        accountId: accountUserId,
        cacheSnapshotKey: storageKey,
        cacheStoreSchemaVersion: CURRENT_SCHEMA_VERSION,
        client: supabase,
        storage: localStorage,
      });
    }
    return createLocalStudyRepository({
      externallyPersisted: true,
      snapshotKey: storageKey,
      storage: localStorage,
      storageScope,
      storeSchemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }, [accountUserId, storageKey, storageScope]);

  useEffect(() => {
    stateRef.current = state;
    stateGenerationRef.current += 1;
  }, [state]);

  useEffect(() => repository.subscribeSyncStatus(setSyncStatus), [repository]);

  useEffect(() => () => {
    void repository.dispose();
  }, [repository]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const hydrate = async () => {
      try {
      const accountStorage = readStoredState(storageScope);
      let nextState = accountStorage.state;

      if (
        accountUserId &&
        importStorageScope &&
        importStorageScope !== storageScope
      ) {
        const localStorageState = readStoredState(importStorageScope);
        const decisionFingerprint = localStorageState.state
          ? localImportDecisionFingerprint(localStorageState.state)
          : null;
        const importCompleted = Boolean(
          importDecisionKey &&
          decisionFingerprint &&
          localStorage.getItem(importDecisionKey) === decisionFingerprint,
        );

        if (localStorageState.state && !importCompleted) {
          const localData = localStorageState.state.data;
          const preview = {
            subjects: localData.subjects.length,
            sessions: localData.sessions.length,
            goals: localData.goals.length,
            grades: localData.grades.length,
            hasActiveTimer: localData.activeTimer !== null,
          };
          if (
            preview.subjects > 0 ||
            preview.sessions > 0 ||
            preview.goals > 0 ||
            preview.grades > 0 ||
            preview.hasActiveTimer
          ) {
            let warnings: readonly string[] = [];
            try {
              warnings = createLocalImportManifest(
                localStorageState.state,
                getDeviceFingerprint(),
              ).warnings;
            } catch {
              // The confirmation step repeats full validation and shows any
              // actionable import error without blocking this safe preview.
            }
            if (mounted) {
              setLocalImportPreview({ ...preview, warnings });
              setMigrationStatus('preview');
            }
          }
        }

        if (nextState) {
          nextState = assignStudyStateToAccount(nextState, accountUserId);
        }
      }

      const repositorySnapshot = await repository.loadSnapshot(controller.signal);
      if (!nextState && repositorySnapshot) {
        nextState = accountUserId
          ? assignStudyStateToAccount(repositorySnapshot, accountUserId)
          : repositorySnapshot;
      }

      if (nextState && mounted) {
        dispatch({ type: 'hydrate', payload: nextState });
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      // Corrupt or unavailable storage must never prevent an empty app start.
    } finally {
      if (mounted) {
        setHydrated(true);
        console.log('[BOOT] Study store hydrated');
      }
    }
    };

    void hydrate();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [accountUserId, importDecisionKey, importStorageScope, repository, storageKey, storageScope]);

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

  const applyRepositorySnapshot = useCallback((snapshot: StudyStateSnapshot | null) => {
    if (!snapshot || sameSnapshot(stateRef.current, snapshot)) return;
    dispatch({ type: 'hydrate', payload: snapshot });
  }, []);

  const retrySync = useCallback(async (): Promise<void> => {
    if (repository.mode !== 'supabase' || !online) return;
    const baseline = stateRef.current;
    const generation = stateGenerationRef.current;
    const run = async () => {
      try {
        const result = await repository.sync();
        if (!result.snapshot) return;
        const snapshot = generation === stateGenerationRef.current
          ? result.snapshot
          : rebaseOptimisticState(baseline, stateRef.current, result.snapshot);
        applyRepositorySnapshot(snapshot);
      } catch {
        // Repository status contains the typed, user-facing retry information.
      }
    };
    const task = persistenceTailRef.current.then(run, run);
    persistenceTailRef.current = task.then(() => undefined, () => undefined);
    await task;
  }, [applyRepositorySnapshot, online, repository]);

  const runSocialOperation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setSocialLoading(true);
    setSocialError(null);
    try {
      return await operation();
    } catch (error) {
      const normalized = asRepositoryError(error);
      setSocialError(normalized.message);
      throw normalized;
    } finally {
      setSocialLoading(false);
    }
  }, []);

  const refreshSocial = useCallback(async (): Promise<void> => {
    if (repository.mode !== 'supabase') return;
    setSocialLoading(true);
    setSocialError(null);
    try {
      const [profile, sharing, connections] = await Promise.all([
        repository.social.getMyProfile(),
        repository.social.getSharingPreferences(),
        repository.social.listFriendConnections(),
      ]);
      setSharingPreferences(sharing);
      setFriendConnections(connections);
      dispatch({ type: 'apply-account-profile', payload: { profile, sharing } });
    } catch (error) {
      setSocialError(asRepositoryError(error).message);
    } finally {
      setSocialLoading(false);
    }
  }, [repository]);

  const getFriendProfileStatsCommand = useCallback(
    (friendId: string) => runSocialOperation(
      () => repository.social.getFriendProfileStats(friendId),
    ),
    [repository, runSocialOperation],
  );

  const getSharedGoalDetailsCommand = useCallback(async (goalId: string) => {
    try {
      const challenge = await runSocialOperation(
        () => repository.social.getSharedGoalDetails(goalId),
      );
      dispatch({ type: 'upsert-challenge', payload: challenge });
      return challenge;
    } catch {
      return null;
    }
  }, [repository, runSocialOperation]);

  const getSharedGoalProgressCommand = useCallback(async (goalId: string) => {
    try {
      return await runSocialOperation(
        () => repository.social.getSharedGoalProgress(goalId),
      );
    } catch {
      return null;
    }
  }, [repository, runSocialOperation]);

  const subscribeSharedGoalProgressCommand = useCallback<StudyRepository['subscribeSharedGoalProgress']>(
    (goalId, listener, signal) => repository.subscribeSharedGoalProgress(goalId, listener, signal),
    [repository],
  );

  useEffect(() => {
    if (!hydrated || repository.mode !== 'supabase') return;
    const timeout = setTimeout(() => {
      void retrySync();
      void refreshSocial();
    }, 0);
    return () => clearTimeout(timeout);
  }, [hydrated, refreshSocial, repository.mode, retrySync]);

  useEffect(() => {
    if (!hydrated) return;
    const generation = stateGenerationRef.current;
    const baseline = state;
    persistenceTailRef.current = persistenceTailRef.current.then(async () => {
      try {
        await repository.saveSnapshot(baseline);
        if (repository.mode === 'supabase' && online) {
          const result = await repository.sync();
          if (result.snapshot) {
            const snapshot = generation === stateGenerationRef.current
              ? result.snapshot
              : rebaseOptimisticState(baseline, stateRef.current, result.snapshot);
            applyRepositorySnapshot(snapshot);
          }
        }
      } catch {
        // The repository publishes errors through syncStatus and retains
        // queued operations for a later retry.
      }
    });
  }, [applyRepositorySnapshot, hydrated, online, repository, state]);

  const value = useMemo<StudyStoreValue>(() => {
    const currentActorId = accountUserId?.trim() || actorId(state.data);

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
        id: profile.userId?.trim() || previous?.id || currentActorId,
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

    const startTimer: StartTimer = (
      input: string | StartTimerOptions,
      legacyOptions: Omit<StartTimerOptions, 'subjectId'> = {},
    ): ActiveTimer | null => {
      if (state.data.activeTimer) return null;
      const options = typeof input === 'string'
        ? { ...legacyOptions, subjectId: input }
        : input;
      const binding = resolveSessionBinding(
        state.data,
        options.subjectId,
        options.goalId,
        'timer',
      );
      if (!binding) return null;
      if (
        options.plannedDurationMinutes !== undefined &&
        (!Number.isFinite(options.plannedDurationMinutes) ||
          options.plannedDurationMinutes <= 0)
      ) {
        return null;
      }
      const now = new Date().toISOString();
      const timer: ActiveTimer = {
        schemaVersion: 1,
        id: makeId('timer'),
        userId: currentActorId,
        goalId: binding.goalId,
        subjectId: binding.subjectId,
        goalTitleSnapshot: binding.goalTitleSnapshot,
        subjectNameSnapshot: binding.subjectNameSnapshot,
        status: 'running',
        startedAt: now,
        segments: [{ startedAt: now, endedAt: null }],
        plannedDurationMinutes: options.plannedDurationMinutes === undefined
          ? undefined
          : Math.max(1, Math.round(options.plannedDurationMinutes)),
        note: cleanOptionalText(options.note),
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

    const addManualEntry = (entry: NewManualEntry): ManualStudySession | null => {
      const binding = resolveSessionBinding(
        state.data,
        entry.subjectId,
        entry.goalId,
        'manual',
      );
      if (!binding) return null;
      const requestedStart = new Date(`${entry.studiedOn}T12:00:00`);
      const start = Number.isFinite(requestedStart.getTime()) ? requestedStart : new Date();
      const safeMinutes = safeWholeNumber(entry.durationMinutes, 1, 1);
      const end = new Date(start.getTime() + safeMinutes * 60_000);
      const now = new Date().toISOString();
      const session: ManualStudySession = {
        id: makeId('manual'),
        userId: currentActorId,
        goalId: binding.goalId,
        subjectId: binding.subjectId,
        goalTitleSnapshot: binding.goalTitleSnapshot,
        subjectNameSnapshot: binding.subjectNameSnapshot,
        source: 'manual',
        status: 'completed',
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

    const addGrade = (input: NewGrade): StudyGrade | null => {
      const subject = state.data.subjects.find(
        (entry) => entry.id === input.subjectId && !entry.archived,
      );
      const title = cleanOptionalText(input.title);
      const assessmentDate = cleanOptionalText(input.assessmentDate);
      const userId = currentActorId;
      if (
        !subject ||
        (input.assessmentType !== 'exam' && input.assessmentType !== 'other') ||
        (assessmentDate !== undefined && !isValidGradeDate(assessmentDate)) ||
        !Number.isInteger(input.points) ||
        input.points < 0 ||
        input.points > 15 ||
        !Number.isInteger(input.additionalStudyMinutes) ||
        input.additionalStudyMinutes < 0
      ) {
        return null;
      }

      const sessionIds = [...new Set(
        input.sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean),
      )];
      const sessionsAreValid = sessionIds.every((sessionId) => {
        const session = state.data.sessions.find((entry) => entry.id === sessionId);
        return session?.userId === userId &&
          session.subjectId === subject.id &&
          (!session.status || session.status === 'completed');
      });
      if (!sessionsAreValid) return null;

      const now = new Date().toISOString();
      const grade: StudyGrade = {
        id: makeId('grade'),
        userId,
        subjectId: subject.id,
        subjectNameSnapshot: subject.name,
        assessmentType: input.assessmentType,
        ...(title ? { title } : {}),
        ...(assessmentDate ? { assessmentDate } : {}),
        points: input.points,
        additionalStudyMinutes: input.additionalStudyMinutes,
        sessionIds,
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'add-grade', payload: grade });
      return grade;
    };

    const createGoal = (input: NewGoal): StudyGoal => {
      const goal = createStudyGoal(input, currentActorId, new Date());
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
      if (repository.mode === 'supabase' && accountUserId) {
        // Account data remains canonical in Supabase. Only this device's
        // projection is refreshed; pending outbox mutations are retained.
        try {
          // Keep the current snapshot until the full pull succeeds so an
          // active local timer survives offline errors and process exits.
          localStorage.removeItem(`lernzeit.repository.v1.account-${accountUserId}`);
          localStorage.removeItem(`lernzeit.sync-cursor.v1.account-${accountUserId}`);
        } catch {
          // A network refresh below can still restore the projection.
        }
        void repository.refresh().then((snapshot) => {
          if (!snapshot) return;
          dispatch({
            type: 'hydrate',
            payload: {
              ...snapshot,
              data: { ...snapshot.data, activeTimer: state.data.activeTimer },
            },
          });
        }).catch(() => undefined);
        return;
      }

      try {
        localStorage.removeItem(storageKey);
        if (storageScope === 'local') localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // The reducer still clears every in-memory user value.
      }
      dispatch({ type: 'reset' });
    };

    const confirmLocalImport = async (): Promise<StudyState | null> => {
      if (!accountUserId || !importStorageScope || importStorageScope === storageScope) {
        return null;
      }
      const localState = readStoredState(importStorageScope).state;
      if (!localState) return null;

      setMigrationStatus('importing');
      setMigrationProgress(null);
      setMigrationError(null);
      setMigrationReport(null);

      try {
        const assignedLocal = assignStudyStateToAccount(localState, accountUserId);
        const imported = mergeLocalStudyStateIntoAccount(state, localState, accountUserId);
        let merged: StudyState = {
          ...imported,
          privacy: {
            ...state.privacy,
            friendComparisonsEnabled: localState.privacy.friendComparisonsEnabled,
          },
        };
        let completedStatus: MigrationStatus = 'completed';

        if (repository.mode === 'supabase') {
          const manifest = createLocalImportManifest(assignedLocal, getDeviceFingerprint());
          const report = await new ImportCoordinator(repository.imports).execute(
            manifest,
            setMigrationProgress,
          );
          if (report.state === 'staging') {
            throw new Error('Der Import wurde noch nicht serverseitig finalisiert.');
          }
          completedStatus = report.state;
          setMigrationReport(report);
          const refreshed = await repository.refresh();
          if (refreshed) {
            merged = {
              ...refreshed,
              privacy: {
                ...refreshed.privacy,
                friendComparisonsEnabled: localState.privacy.friendComparisonsEnabled,
              },
              data: {
                ...refreshed.data,
                activeTimer: assignedLocal.data.activeTimer ?? refreshed.data.activeTimer,
              },
            };
          }
          await repository.saveSnapshot(merged);
        }

        dispatch({ type: 'hydrate', payload: merged });
        if (importDecisionKey) {
          try {
            localStorage.setItem(
              importDecisionKey,
              localImportDecisionFingerprint(localState),
            );
          } catch {
            // Server finalization remains idempotent if the local receipt fails.
          }
        }
        if (repository.mode !== 'supabase') setLocalImportPreview(null);
        setMigrationStatus(completedStatus);
        return merged;
      } catch (error) {
        const normalized = asRepositoryError(error);
        setMigrationStatus('error');
        setMigrationError(normalized.message);
        return null;
      }
    };

    const enqueueSoftDelete = (
      name: 'soft_delete_session' | 'soft_delete_grade' | 'soft_delete_personal_goal',
      entityType: 'session' | 'grade' | 'goal',
      entityId: string,
      expectedRevision: number | undefined,
    ) => {
      if (repository.mode !== 'supabase') return;
      void repository.enqueueMutation({
        operationId: randomUUID(),
        name,
        entityType,
        entityId,
        expectedRevision,
        payload: {},
      }).then(() => {
        if (online) void retrySync();
      }).catch(() => undefined);
    };

    return {
      ...state,
      hydrated,
      localImportPreview,
      migrationStatus,
      migrationProgress,
      migrationError,
      migrationReport,
      confirmLocalImport,
      acknowledgeLocalImportReport: () => {
        setLocalImportPreview(null);
        setMigrationReport(null);
        setMigrationProgress(null);
        setMigrationError(null);
        setMigrationStatus('idle');
      },
      deferLocalImport: () => {
        setLocalImportPreview(null);
        setMigrationReport(null);
        setMigrationStatus('idle');
        setMigrationError(null);
      },
      syncStatus: repository.mode === 'supabase' && !online
        ? { ...syncStatus, phase: 'offline' }
        : syncStatus,
      pendingMutationCount: syncStatus.pendingMutationCount,
      lastSyncError: syncStatus.lastError?.message ?? null,
      retrySync,
      socialLoading,
      socialError,
      friendConnections,
      sharingPreferences,
      refreshSocial,
      updateAccountProfile: async (profile) => {
        if (repository.mode !== 'supabase') return null;
        const current = state.data.currentUser as Partial<AccountStudyUser> | null;
        try {
          const updated = await runSocialOperation(
            () => repository.social.updateMyProfile({
              username: profile.username,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl?.trim() || null,
              timeZone: profile.timeZone
                ?? current?.timeZone
                ?? Intl.DateTimeFormat().resolvedOptions().timeZone
                ?? 'UTC',
              expectedRevision: current?.revision ?? 1,
            }),
          );
          const sharing = sharingPreferences ?? {
            shareTimerStats: state.privacy.shareAutomaticMinutes,
            shareManualStats: state.privacy.shareManualMinutes,
            shareGoalProgress: state.privacy.shareGoalProgress,
            shareStreak: state.privacy.shareStreak,
            revision: 1,
            updatedAt: new Date().toISOString(),
          };
          dispatch({ type: 'apply-account-profile', payload: { profile: updated, sharing } });
          return updated;
        } catch {
          return null;
        }
      },
      uploadAvatar: async (asset) => {
        if (repository.mode !== 'supabase') return null;
        const userId = state.data.currentUser?.id;
        if (!userId) return null;
        // Errors intentionally propagate: runSocialOperation records the concrete
        // message in socialError and rethrows so the UI can show exactly why the
        // upload failed instead of a silent null.
        return runSocialOperation(async () => {
          const { body, contentType, fileExtension } = await prepareAvatarUpload(asset);
          return repository.social.uploadAvatar({ userId, body, contentType, fileExtension });
        });
      },
      findFriendByUsername: (username) => runSocialOperation(
        () => repository.social.findProfileByExactUsername(username),
      ),
      sendFriendRequest: async (username) => {
        await runSocialOperation(() => repository.social.sendFriendRequest(username));
        await refreshSocial();
      },
      acceptFriendRequest: async (friendshipId) => {
        await runSocialOperation(() => repository.social.acceptFriendRequest(friendshipId));
        await refreshSocial();
      },
      declineFriendRequest: async (friendshipId) => {
        await runSocialOperation(() => repository.social.declineFriendRequest(friendshipId));
        await refreshSocial();
      },
      removeFriendship: async (friendshipId) => {
        await runSocialOperation(() => repository.social.removeFriendship(friendshipId));
        await refreshSocial();
      },
      getFriendProfileStats: getFriendProfileStatsCommand,
      createSharedGoal: async (input) => {
        try {
          const challenge = await runSocialOperation(
            () => repository.social.createSharedGoal(input),
          );
          dispatch({ type: 'upsert-challenge', payload: challenge });
          return challenge;
        } catch {
          return null;
        }
      },
      respondSharedGoalInvitation: async (goalId, accept) => {
        try {
          const challenge = await runSocialOperation(
            () => repository.social.respondSharedGoalInvitation(goalId, accept),
          );
          dispatch({ type: 'upsert-challenge', payload: challenge });
          return challenge;
        } catch {
          return null;
        }
      },
      withdrawFromSharedGoal: async (goalId) => {
        await runSocialOperation(() => repository.social.withdrawFromSharedGoal(goalId));
        dispatch({
          type: 'withdraw-from-challenge',
          payload: { goalId, userId: currentActorId },
        });
      },
      getSharedGoalDetails: getSharedGoalDetailsCommand,
      getSharedGoalProgress: getSharedGoalProgressCommand,
      subscribeSharedGoalProgress: subscribeSharedGoalProgressCommand,
      addSubject,
      updateLocalProfile,
      clearLocalProfile: () => dispatch({ type: 'set-current-user', payload: null }),
      startTimer,
      pauseTimer,
      resumeTimer,
      finishTimer,
      discardTimer: () => dispatch({ type: 'set-active-timer', payload: null }),
      addManualEntry,
      addGrade,
      deleteGrade: (gradeId) => {
        const grade = state.data.grades.find((entry) => entry.id === gradeId);
        if (!grade || grade.userId !== currentActorId) return false;
        enqueueSoftDelete('soft_delete_grade', 'grade', grade.id, grade.revision);
        dispatch({ type: 'delete-grade', payload: gradeId });
        return true;
      },
      deleteSession: (sessionId) => {
        const session = state.data.sessions.find((entry) => entry.id === sessionId);
        if (!session || session.userId !== currentActorId) return false;
        enqueueSoftDelete('soft_delete_session', 'session', session.id, session.revision);
        dispatch({ type: 'delete-session', payload: sessionId });
        return true;
      },
      createGoal,
      addGoal: createGoal,
      updateGoal,
      pauseGoal: (goalId) => setGoalStatus(goalId, 'paused'),
      resumeGoal: (goalId) => setGoalStatus(goalId, 'active'),
      completeGoal: (goalId) => setGoalStatus(goalId, 'completed'),
      archiveGoal: (goalId) => setGoalStatus(goalId, 'archived'),
      deleteGoal: (goalId) => {
        const goal = state.data.goals.find((entry) => entry.id === goalId);
        if (!goal || goal.userId !== currentActorId) return;
        enqueueSoftDelete('soft_delete_personal_goal', 'goal', goal.id, goal.revision);
        dispatch({ type: 'delete-goal', payload: goalId });
      },
      setFriendComparisonsEnabled: (enabled) =>
        dispatch({ type: 'set-friend-comparisons', payload: enabled }),
      setPrivacyPreference: (key, enabled) => {
        if (repository.mode !== 'supabase') {
          dispatch({ type: 'set-privacy-preference', key, payload: enabled });
          return;
        }
        if (!online) {
          setSocialError('Datenschutzfreigaben können nur mit einer aktiven Verbindung geändert werden.');
          return;
        }
        if (!sharingPreferences) {
          setSocialError('Die aktuellen Datenschutzfreigaben werden noch geladen.');
          void refreshSocial();
          return;
        }
        const next = {
          shareTimerStats: key === 'shareAutomaticMinutes'
            ? enabled
            : state.privacy.shareAutomaticMinutes,
          shareManualStats: key === 'shareManualMinutes'
            ? enabled
            : state.privacy.shareManualMinutes,
          shareGoalProgress: key === 'shareGoalProgress'
            ? enabled
            : state.privacy.shareGoalProgress,
          shareStreak: key === 'shareStreak'
            ? enabled
            : state.privacy.shareStreak,
          expectedRevision: sharingPreferences.revision,
        };
        void runSocialOperation(
          () => repository.social.updateSharingPreferences(next),
        ).then((sharing) => {
          setSharingPreferences(sharing);
          const profile = stateRef.current.data.currentUser;
          if (profile) {
            dispatch({ type: 'apply-account-profile', payload: { profile, sharing } });
          }
        }).catch(() => undefined);
      },
      clearAllData,
    };
  }, [
    accountUserId,
    friendConnections,
    getFriendProfileStatsCommand,
    getSharedGoalDetailsCommand,
    getSharedGoalProgressCommand,
    hydrated,
    importDecisionKey,
    importStorageScope,
    localImportPreview,
    migrationError,
    migrationProgress,
    migrationReport,
    migrationStatus,
    online,
    refreshSocial,
    repository,
    retrySync,
    runSocialOperation,
    sharingPreferences,
    socialError,
    socialLoading,
    state,
    storageKey,
    storageScope,
    syncStatus,
    subscribeSharedGoalProgressCommand,
  ]);

  return <StudyStoreContext value={value}>{children}</StudyStoreContext>;
}

export function useStudyStore(): StudyStoreValue {
  const context = use(StudyStoreContext);
  if (!context) throw new Error('useStudyStore must be used inside StudyStoreProvider');
  return context;
}
