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
import { AppState, type AppStateStatus } from 'react-native';

import { supabase } from '@/auth/supabase';
import { createInitialData, subjectColorPalette } from '@/data/initial-data';
import { createLocalStudyRepository } from '@/data/repositories/local-study-repository';
import {
  asRepositoryError,
  StudyRepositoryError,
} from '@/data/repositories/repository-error';
import {
  type CreateSharedGoalInput,
  type CreateSharedStudySessionInput,
  type CreateStudyGroupInput,
  type LearningPresenceState,
  type LocalImportReport,
  type SharedStudySessionParticipantAction,
  type SocialInvalidationKind,
  type SubmitContentReportInput,
  type SyncStatus,
  type StudyRepository,
} from '@/data/repositories/study-repository';
import { createSupabaseStudyRepository } from '@/data/repositories/supabase-study-repository';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { safeDebug } from '@/lib/safe-logger';
import '@/lib/local-storage';
import { isValidGradeDate } from '@/lib/grades';
import {
  avatarObjectPathFromUrl,
  avatarUrlReferencesObjectPath,
  cleanupTemporaryAvatarUri,
  prepareAvatarUpload,
  reencodeAvatarForUpload,
} from '@/lib/avatar-upload';
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
  AccountDataExport,
  AccountStudyUser,
  ActiveTimer,
  BlockedProfile,
  ChallengeMode,
  ChallengeParticipant,
  CommunityRulesAcceptance,
  ContentReportReceipt,
  FriendOverview,
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
  SharedStudySession,
  StudyGroup,
  Subject,
  TimerStudySession,
} from '@/types/study';

const LEGACY_STORAGE_KEY = 'lernzeit.study-state.v1';
const STORAGE_KEY_PREFIX = 'lernzeit.study-state.v2';
const IMPORT_DECISION_KEY_PREFIX = 'lernzeit.study-import.v2';
const SHARED_SESSION_ACTION_OUTBOX_PREFIX = 'lernzeit.shared-session-actions.v1';
const DEVICE_FINGERPRINT_KEY = 'lernzeit.device-fingerprint.v1';
const CURRENT_SCHEMA_VERSION = 3;
const MAX_PERSISTED_STUDY_STATE_BYTES = 8 * 1024 * 1024;
const MAX_SHARED_SESSION_ACTIONS = 100;
const MAX_SHARED_SESSION_ACTION_BYTES = 64 * 1024;
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

interface PendingSharedSessionAction {
  sessionId: string;
  action: SharedStudySessionParticipantAction;
}

interface PendingPresenceMutation {
  version: number;
  state: LearningPresenceState;
  activeSince: string | null;
}

const SHARED_SESSION_PARTICIPANT_ACTIONS: readonly SharedStudySessionParticipantAction[] = [
  'start',
  'pause',
  'resume',
  'finish',
  'leave',
];

function sharedSessionActionOutboxKey(accountId: string): string {
  const safeAccountId = accountId.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${SHARED_SESSION_ACTION_OUTBOX_PREFIX}.${safeAccountId}`;
}

/**
 * Adjacent/retried duplicates are safe to collapse because the server actions
 * are idempotent. Inverse transitions stay ordered: a request may have reached
 * the server even when its response did not reach this client.
 */
function enqueueSharedSessionAction(
  current: readonly PendingSharedSessionAction[],
  pending: PendingSharedSessionAction,
): PendingSharedSessionAction[] {
  const previousForSession = [...current]
    .reverse()
    .find((entry) => entry.sessionId === pending.sessionId);
  if (
    previousForSession?.action === pending.action
    || previousForSession?.action === 'finish'
    || previousForSession?.action === 'leave'
  ) {
    return [...current];
  }
  if (current.length >= MAX_SHARED_SESSION_ACTIONS) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Die Offline-Warteschlange für gemeinsame Sessions ist voll.',
      { retryable: false },
    );
  }
  return [...current, pending];
}

function readSharedSessionActionOutbox(storageKey: string): PendingSharedSessionAction[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    if (raw.length > MAX_SHARED_SESSION_ACTION_BYTES) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_SHARED_SESSION_ACTIONS) return [];
    return value.reduce<PendingSharedSessionAction[]>((actions, entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return actions;
      const record = entry as Record<string, unknown>;
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
      const action = record.action;
      if (
        !sessionId
        || sessionId.length > 200
        || typeof action !== 'string'
        || !SHARED_SESSION_PARTICIPANT_ACTIONS.includes(
          action as SharedStudySessionParticipantAction,
        )
      ) {
        return actions;
      }
      return enqueueSharedSessionAction(actions, {
        sessionId,
        action: action as SharedStudySessionParticipantAction,
      });
    }, []);
  } catch {
    return [];
  }
}

function writeSharedSessionActionOutbox(
  storageKey: string,
  actions: readonly PendingSharedSessionAction[],
): void {
  try {
    if (actions.length === 0) localStorage.removeItem(storageKey);
    else {
      const serialized = JSON.stringify(actions);
      if (serialized.length <= MAX_SHARED_SESSION_ACTION_BYTES) {
        localStorage.setItem(storageKey, serialized);
      }
    }
  } catch {
    // The in-memory queue remains active when persistent storage is unavailable.
  }
}

export interface NewManualEntry {
  /** Optional when `goalId` resolves to exactly one subject. */
  subjectId?: string;
  goalId?: string | null;
  sharedSessionId?: string | null;
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
  sharedSessionId?: string | null;
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
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
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
  socialRealtimeUnavailable: boolean;
  friendConnections: readonly FriendshipConnection[];
  friendOverviews: readonly FriendOverview[];
  studyGroups: readonly StudyGroup[];
  sharedStudySessions: readonly SharedStudySession[];
  sharedGoalProgressById: Readonly<Record<string, SharedGoalProgress>>;
  sharingPreferences: StudySharingPreferences | null;
  blockedProfiles: readonly BlockedProfile[];
  communityRulesAcceptance: CommunityRulesAcceptance | null;
  refreshSocial: (options?: { silent?: boolean }) => Promise<void>;
  updateAccountProfile: (profile: AccountProfileUpdate) => Promise<AccountStudyUser | null>;
  replaceAccountAvatar: (asset: AvatarUploadAsset) => Promise<AccountStudyUser | null>;
  findFriendByUsername: (username: string) => Promise<FriendSearchResult | null>;
  sendFriendRequest: (username: string) => Promise<void>;
  acceptFriendRequest: (friendshipId: string) => Promise<void>;
  declineFriendRequest: (friendshipId: string) => Promise<void>;
  removeFriendship: (friendshipId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  submitContentReport: (input: SubmitContentReportInput) => Promise<ContentReportReceipt>;
  acceptCommunityRules: () => Promise<CommunityRulesAcceptance>;
  exportAccountData: () => Promise<AccountDataExport>;
  saveSharingPreferences: (
    preferences: Omit<StudySharingPreferences, 'revision' | 'updatedAt'>,
  ) => Promise<StudySharingPreferences>;
  getFriendOverview: (friendId: string) => Promise<FriendOverview | null>;
  createSharedGoal: (input: CreateSharedGoalInput) => Promise<StudyChallenge>;
  respondSharedGoalInvitation: (
    goalId: string,
    accept: boolean,
  ) => Promise<StudyChallenge | null>;
  withdrawFromSharedGoal: (goalId: string) => Promise<void>;
  getSharedGoalDetails: (goalId: string) => Promise<StudyChallenge | null>;
  getSharedGoalProgress: (goalId: string) => Promise<SharedGoalProgress | null>;
  subscribeSharedGoalProgress: StudyRepository['subscribeSharedGoalProgress'];
  createStudyGroup: (input: CreateStudyGroupInput) => Promise<StudyGroup | null>;
  getStudyGroupDetails: (groupId: string) => Promise<StudyGroup | null>;
  respondStudyGroupInvitation: (
    groupId: string,
    accept: boolean,
  ) => Promise<StudyGroup | null>;
  leaveStudyGroup: (groupId: string) => Promise<void>;
  createSharedStudySession: (
    input: CreateSharedStudySessionInput,
  ) => Promise<SharedStudySession>;
  getSharedStudySessionDetails: (sessionId: string) => Promise<SharedStudySession | null>;
  respondSharedStudySessionInvitation: (
    sessionId: string,
    accept: boolean,
  ) => Promise<SharedStudySession | null>;
  updateSharedStudySessionParticipant: (
    sessionId: string,
    action: SharedStudySessionParticipantAction,
  ) => Promise<SharedStudySession | null>;
  cancelSharedStudySession: (sessionId: string) => Promise<SharedStudySession | null>;
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
  | { type: 'set-challenges'; payload: readonly StudyChallenge[] }
  | { type: 'remove-challenge'; payload: string }
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
    case 'set-challenges':
      return {
        ...state,
        data: { ...state.data, challenges: [...action.payload] },
      };
    case 'remove-challenge':
      return {
        ...state,
        data: {
          ...state.data,
          challenges: state.data.challenges.filter((challenge) => challenge.id !== action.payload),
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

function parsedSharedSessionId(
  record: Record<string, unknown>,
): { sharedSessionId?: string | null } {
  if (!hasOwn(record, 'sharedSessionId')) return {};
  const value = record.sharedSessionId;
  if (value === null) return { sharedSessionId: null };
  const id = optionalString(value);
  return id ? { sharedSessionId: id } : {};
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
    ...parsedSharedSessionId(value),
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
    ...parsedSharedSessionId(value),
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
    (value.endsAt !== undefined && value.endsAt !== null && !isIsoDate(value.endsAt)) ||
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
    const participantUser = parseUser(participant.user);
    return [{
      userId: participant.userId,
      ...(participantUser?.id === participant.userId ? { user: participantUser } : {}),
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
  const cadence = value.cadence === 'daily' || value.cadence === 'weekly'
    ? value.cadence
    : 'weekly';
  const groupId = value.groupId === null ? null : optionalString(value.groupId) ?? null;

  return {
    id: value.id,
    creatorId: value.creatorId,
    title: value.title,
    description: value.description,
    cadence,
    groupId,
    target,
    sourcePolicy: value.sourcePolicy,
    startsAt: value.startsAt,
    endsAt: isIsoDate(value.endsAt) ? value.endsAt : undefined,
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
  /** Current session token; changing it replaces and re-authenticates private channels. */
  accountAccessToken?: string;
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
  if (raw.length > MAX_PERSISTED_STUDY_STATE_BYTES) return { raw, state: null };

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

function sharedSessionProjectionIsOlder(
  incoming: SharedStudySession,
  existing: SharedStudySession,
): boolean {
  const incomingCalculatedAt = Date.parse(incoming.calculatedAt ?? '');
  const existingCalculatedAt = Date.parse(existing.calculatedAt ?? '');
  const incomingHasCalculation = Number.isFinite(incomingCalculatedAt);
  const existingHasCalculation = Number.isFinite(existingCalculatedAt);
  if (incomingHasCalculation !== existingHasCalculation) return existingHasCalculation;
  if (incomingHasCalculation && incomingCalculatedAt !== existingCalculatedAt) {
    return incomingCalculatedAt < existingCalculatedAt;
  }

  const incomingUpdatedAt = Date.parse(incoming.updatedAt);
  const existingUpdatedAt = Date.parse(existing.updatedAt);
  return Number.isFinite(existingUpdatedAt)
    && (!Number.isFinite(incomingUpdatedAt) || incomingUpdatedAt < existingUpdatedAt);
}

const INITIAL_SYNC_STATUS: Readonly<SyncStatus> = {
  phase: 'idle',
  pendingMutationCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

export function StudyStoreProvider({
  accountAccessToken,
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
  const [socialRealtimeUnavailable, setSocialRealtimeUnavailable] = useState(false);
  const [avatarMaintenanceError, setAvatarMaintenanceError] = useState<string | null>(null);
  const [friendConnections, setFriendConnections] = useState<readonly FriendshipConnection[]>([]);
  const [friendOverviews, setFriendOverviews] = useState<readonly FriendOverview[]>([]);
  const [studyGroups, setStudyGroups] = useState<readonly StudyGroup[]>([]);
  const [sharedStudySessions, setSharedStudySessions] = useState<readonly SharedStudySession[]>([]);
  const [sharedGoalProgressById, setSharedGoalProgressById] = useState<Readonly<
    Record<string, SharedGoalProgress>
  >>({});
  const [sharingPreferences, setSharingPreferences] = useState<StudySharingPreferences | null>(null);
  const [blockedProfiles, setBlockedProfiles] = useState<readonly BlockedProfile[]>([]);
  const [communityRulesAcceptance, setCommunityRulesAcceptance] = useState<CommunityRulesAcceptance | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState === 'background' || AppState.currentState === 'inactive'
      ? AppState.currentState
      : 'active',
  );
  const online = useNetworkStatus();
  const storageKey = scopedStorageKey(storageScope);
  const deviceId = useMemo(() => getDeviceFingerprint(), []);
  const sharedSessionActionStorageKey = accountUserId
    ? sharedSessionActionOutboxKey(accountUserId)
    : null;
  const stateRef = useRef(state);
  const stateGenerationRef = useRef(0);
  const socialRefreshGenerationRef = useRef(0);
  const friendOverviewRefreshGenerationRef = useRef(0);
  const sharedSessionRefreshGenerationRef = useRef(0);
  const sharedGoalRefreshGenerationRef = useRef(0);
  const persistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const sharedSessionActionDrainTailRef = useRef<Promise<void>>(Promise.resolve());
  const avatarCleanupTailRef = useRef<Promise<void>>(Promise.resolve());
  const presenceMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const presenceMutationVersionRef = useRef(0);
  const pendingPresenceMutationRef = useRef<PendingPresenceMutation | null>(null);
  const [initialSharedSessionActionOutbox] = useState(() => ({
    storageKey: sharedSessionActionStorageKey,
    actions: sharedSessionActionStorageKey
      ? readSharedSessionActionOutbox(sharedSessionActionStorageKey)
      : [],
  }));
  const sharedSessionActionOutboxRef = useRef<{
    storageKey: string | null;
    actions: PendingSharedSessionAction[];
  } | null>(initialSharedSessionActionOutbox);
  useEffect(() => {
    if (sharedSessionActionOutboxRef.current?.storageKey === sharedSessionActionStorageKey) return;
    sharedSessionActionOutboxRef.current = {
      storageKey: sharedSessionActionStorageKey,
      actions: sharedSessionActionStorageKey
        ? readSharedSessionActionOutbox(sharedSessionActionStorageKey)
        : [],
    };
  }, [sharedSessionActionStorageKey]);
  const lastPresenceHeartbeatRef = useRef<Readonly<{
    state: 'idle' | 'learning' | 'paused';
    activeSince: string | null;
    sentAt: number;
  }> | null>(null);
  const previousAppStateRef = useRef(appState);
  const importDecisionKey = accountUserId
    ? `${IMPORT_DECISION_KEY_PREFIX}.${accountUserId}`
    : null;
  const repository = useMemo<StudyRepository>(() => {
    if (accountAccessToken && accountUserId && supabase) {
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
  }, [accountAccessToken, accountUserId, storageKey, storageScope]);

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
        safeDebug('[BOOT] Lernspeicher wiederhergestellt.');
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
      const serialized = JSON.stringify(payload);
      if (serialized.length <= MAX_PERSISTED_STUDY_STATE_BYTES) {
        localStorage.setItem(storageKey, serialized);
      }
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

  const applyAccountProfile = useCallback((
    profile: StudyUser,
    sharing: StudySharingPreferences,
  ) => {
    const action: Action = {
      type: 'apply-account-profile',
      payload: { profile, sharing },
    };

    // Keep command callbacks current before React commits the reducer update.
    // This matters when a picker/upload promise resumes with a callback from an
    // older render and immediately starts the profile mutation afterwards.
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, []);

  const upsertFriendOverview = useCallback((overview: FriendOverview) => {
    setFriendOverviews((current) => [
      overview,
      ...current.filter((entry) => entry.friend.id !== overview.friend.id),
    ]);
  }, []);

  const upsertStudyGroup = useCallback((group: StudyGroup) => {
    setStudyGroups((current) => [group, ...current.filter((entry) => entry.id !== group.id)]);
  }, []);

  const upsertSharedStudySession = useCallback((session: SharedStudySession) => {
    setSharedStudySessions((current) => {
      const existing = current.find((entry) => entry.id === session.id);
      if (existing && sharedSessionProjectionIsOlder(session, existing)) return current;
      return [session, ...current.filter((entry) => entry.id !== session.id)];
    });
  }, []);

  const upsertSharedGoalProgress = useCallback((progress: SharedGoalProgress) => {
    setSharedGoalProgressById((current) => ({ ...current, [progress.goalId]: progress }));
  }, []);

  const removeSharedGoalProgress = useCallback((goalId: string) => {
    setSharedGoalProgressById((current) => {
      if (!(goalId in current)) return current;
      const next = { ...current };
      delete next[goalId];
      return next;
    });
  }, []);

  const refreshSocial = useCallback(async (
    options: { silent?: boolean } = {},
  ): Promise<void> => {
    if (repository.mode !== 'supabase') return;
    const generation = ++socialRefreshGenerationRef.current;
    const friendOverviewGeneration = ++friendOverviewRefreshGenerationRef.current;
    const sharedSessionGeneration = ++sharedSessionRefreshGenerationRef.current;
    const sharedGoalGeneration = ++sharedGoalRefreshGenerationRef.current;
    const silent = options.silent === true;
    if (!silent) setSocialLoading(true);
    setSocialError(null);
    try {
      const [
        profileResult,
        sharingResult,
        connectionsResult,
        overviewsResult,
        sharedGoalsResult,
        goalProgressResult,
        groupsResult,
        sharedSessionsResult,
        blockedProfilesResult,
        communityRulesResult,
      ] = await Promise.allSettled([
        repository.social.getMyProfile(),
        repository.social.getSharingPreferences(),
        repository.social.listFriendConnections(),
        repository.social.listFriendOverviews(),
        repository.social.listSharedGoals(),
        repository.social.listSharedGoalProgress(),
        repository.social.listStudyGroups(),
        repository.social.listSharedStudySessions(),
        typeof repository.social.listBlockedProfiles === 'function'
          ? repository.social.listBlockedProfiles()
          : Promise.resolve([]),
        typeof repository.social.getCommunityRulesAcceptance === 'function'
          ? repository.social.getCommunityRulesAcceptance()
          : Promise.resolve(null),
      ] as const);
      if (generation !== socialRefreshGenerationRef.current) return;

      if (sharingResult.status === 'fulfilled') {
        setSharingPreferences(sharingResult.value);
      }
      if (connectionsResult.status === 'fulfilled') {
        setFriendConnections(connectionsResult.value);
      }
      if (
        overviewsResult.status === 'fulfilled'
        && friendOverviewGeneration === friendOverviewRefreshGenerationRef.current
      ) {
        setFriendOverviews(overviewsResult.value);
      }
      if (
        sharedGoalsResult.status === 'fulfilled'
        && sharedGoalGeneration === sharedGoalRefreshGenerationRef.current
      ) {
        dispatch({ type: 'set-challenges', payload: sharedGoalsResult.value });
      }
      if (
        goalProgressResult.status === 'fulfilled'
        && sharedGoalGeneration === sharedGoalRefreshGenerationRef.current
      ) {
        setSharedGoalProgressById(Object.fromEntries(
          goalProgressResult.value.map((progress) => [progress.goalId, progress]),
        ));
      }
      if (groupsResult.status === 'fulfilled') setStudyGroups(groupsResult.value);
      if (blockedProfilesResult.status === 'fulfilled') setBlockedProfiles(blockedProfilesResult.value);
      if (communityRulesResult.status === 'fulfilled') {
        setCommunityRulesAcceptance(communityRulesResult.value);
      }
      if (
        sharedSessionsResult.status === 'fulfilled'
        && sharedSessionGeneration === sharedSessionRefreshGenerationRef.current
      ) {
        setSharedStudySessions((current) => sharedSessionsResult.value.map((session) => {
          const existing = current.find((entry) => entry.id === session.id);
          return existing && sharedSessionProjectionIsOlder(session, existing)
            ? existing
            : session;
        }));
      }
      if (profileResult.status === 'fulfilled') {
        const currentPrivacy = stateRef.current.privacy;
        const sharing = sharingResult.status === 'fulfilled'
          ? sharingResult.value
          : {
              shareTimerStats: currentPrivacy.shareAutomaticMinutes,
              shareManualStats: currentPrivacy.shareManualMinutes,
              shareGoalProgress: currentPrivacy.shareGoalProgress,
              shareStreak: currentPrivacy.shareStreak,
              shareCurrentlyLearning: false,
              sharePauseStatus: false,
              shareLastActiveAt: false,
              shareTodayActivity: false,
              shareWeeklyMinutes: false,
              shareAvatar: false,
              discoverableByUsername: false,
              revision: 1,
              updatedAt: new Date().toISOString(),
            };
        applyAccountProfile(profileResult.value, sharing);
      }

      const firstFailure = [
        profileResult,
        sharingResult,
        connectionsResult,
        overviewsResult,
        sharedGoalsResult,
        goalProgressResult,
        groupsResult,
        sharedSessionsResult,
        blockedProfilesResult,
        communityRulesResult,
      ].find((result) => result.status === 'rejected');
      setSocialError(firstFailure?.status === 'rejected'
        ? asRepositoryError(firstFailure.reason).message
        : null);
    } finally {
      if (!silent) setSocialLoading(false);
    }
  }, [applyAccountProfile, repository]);

  const refreshSocialProjection = useCallback(async (
    kind: SocialInvalidationKind,
  ): Promise<void> => {
    if (repository.mode !== 'supabase') return;
    try {
      if (kind === 'presence') {
        const generation = ++friendOverviewRefreshGenerationRef.current;
        const overviews = await repository.social.listFriendOverviews();
        if (generation === friendOverviewRefreshGenerationRef.current) {
          setFriendOverviews(overviews);
        }
        return;
      }
      if (kind === 'shared_session' || kind === 'shared_session_progress') {
        const generation = ++sharedSessionRefreshGenerationRef.current;
        const sessions = await repository.social.listSharedStudySessions();
        if (generation === sharedSessionRefreshGenerationRef.current) {
          setSharedStudySessions((current) => sessions.map((session) => {
            const existing = current.find((entry) => entry.id === session.id);
            return existing && sharedSessionProjectionIsOlder(session, existing)
              ? existing
              : session;
          }));
        }
        return;
      }
      if (kind === 'shared_goal' || kind === 'shared_goal_progress') {
        const generation = ++sharedGoalRefreshGenerationRef.current;
        const [goals, progress] = await Promise.all([
          repository.social.listSharedGoals(),
          repository.social.listSharedGoalProgress(),
        ]);
        if (generation === sharedGoalRefreshGenerationRef.current) {
          dispatch({ type: 'set-challenges', payload: goals });
          setSharedGoalProgressById(Object.fromEntries(
            progress.map((entry) => [entry.goalId, entry]),
          ));
        }
        return;
      }
      await refreshSocial({ silent: true });
    } catch (error) {
      setSocialError(asRepositoryError(error).message);
    }
  }, [refreshSocial, repository]);

  const enqueuePresenceMutation = useCallback((
    state: LearningPresenceState,
    activeSince: string | null,
  ): Promise<void> => {
    const mutation: PendingPresenceMutation = {
      version: ++presenceMutationVersionRef.current,
      state,
      activeSince,
    };
    pendingPresenceMutationRef.current = mutation;

    const run = async () => {
      // Collapse commands that have not started yet. If an older network call
      // is already running, this still guarantees the newest state is sent
      // immediately afterwards for this device.
      if (pendingPresenceMutationRef.current?.version !== mutation.version) return;
      try {
        await repository.social.updateLearningPresence(
          deviceId,
          mutation.state,
          mutation.activeSince,
        );
        if (
          pendingPresenceMutationRef.current?.version === mutation.version
          && mutation.state !== 'offline'
        ) {
          lastPresenceHeartbeatRef.current = {
            state: mutation.state,
            activeSince: mutation.activeSince,
            sentAt: Date.now(),
          };
        }
      } finally {
        if (pendingPresenceMutationRef.current?.version === mutation.version) {
          pendingPresenceMutationRef.current = null;
        }
      }
    };
    const task = presenceMutationTailRef.current.then(run, run);
    presenceMutationTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [deviceId, repository]);

  const runAvatarCleanup = useCallback((
    userId: string,
    keepObjectPath: string,
    previousAvatarUrl?: string,
  ): Promise<void> => {
    const run = () => repository.social.cleanupAvatarObjects(
      userId,
      keepObjectPath,
      previousAvatarUrl,
    );
    const task = avatarCleanupTailRef.current.then(run, run);
    avatarCleanupTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [repository]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (
      !hydrated
      || !online
      || repository.mode !== 'supabase'
      || !accountUserId
    ) return;
    const avatarUrl = state.data.currentUser?.avatarUrl;
    const keepObjectPath = avatarObjectPathFromUrl(avatarUrl, accountUserId);
    if (!keepObjectPath?.startsWith(`${accountUserId}/profile/`)) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 30_000;
    const cleanup = async () => {
      try {
        await runAvatarCleanup(accountUserId, keepObjectPath, avatarUrl);
        if (!cancelled) setAvatarMaintenanceError(null);
      } catch {
        if (cancelled) return;
        setAvatarMaintenanceError(
          'Das Profilbild ist gespeichert. Alte Bilddateien werden automatisch erneut bereinigt.',
        );
        retry = setTimeout(() => void cleanup(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
      }
    };
    const start = setTimeout(() => void cleanup(), 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
      if (retry) clearTimeout(retry);
    };
  }, [
    accountUserId,
    hydrated,
    online,
    repository.mode,
    runAvatarCleanup,
    state.data.currentUser?.avatarUrl,
  ]);

  const getFriendOverviewCommand = useCallback(async (friendId: string) => {
    try {
      const overview = await runSocialOperation(
        () => repository.social.getFriendOverview(friendId),
      );
      upsertFriendOverview(overview);
      return overview;
    } catch {
      return null;
    }
  }, [repository, runSocialOperation, upsertFriendOverview]);

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
      const progress = await runSocialOperation(
        () => repository.social.getSharedGoalProgress(goalId),
      );
      upsertSharedGoalProgress(progress);
      return progress;
    } catch {
      return null;
    }
  }, [repository, runSocialOperation, upsertSharedGoalProgress]);

  const getStudyGroupDetailsCommand = useCallback(async (groupId: string) => {
    try {
      const group = await runSocialOperation(
        () => repository.social.getStudyGroupDetails(groupId),
      );
      upsertStudyGroup(group);
      return group;
    } catch {
      return null;
    }
  }, [repository, runSocialOperation, upsertStudyGroup]);

  const getSharedStudySessionDetailsCommand = useCallback(async (sessionId: string) => {
    try {
      const session = await runSocialOperation(
        () => repository.social.getSharedStudySessionDetails(sessionId),
      );
      upsertSharedStudySession(session);
      return session;
    } catch {
      return null;
    }
  }, [repository, runSocialOperation, upsertSharedStudySession]);

  const subscribeSharedGoalProgressCommand = useCallback<StudyRepository['subscribeSharedGoalProgress']>(
    (goalId, listener, signal) => repository.subscribeSharedGoalProgress(goalId, {
      ...listener,
      onProgress: (progress) => {
        upsertSharedGoalProgress(progress);
        listener.onProgress(progress);
      },
    }, signal),
    [repository, upsertSharedGoalProgress],
  );

  const drainSharedSessionActionOutbox = useCallback(async (): Promise<void> => {
    if (
      !hydrated
      || !online
      || repository.mode !== 'supabase'
      || !sharedSessionActionStorageKey
    ) {
      return;
    }
    const queueStorageKey = sharedSessionActionStorageKey;
    const drain = async () => {
      const touchedSessionIds = new Set<string>();
      const initialOutbox = sharedSessionActionOutboxRef.current;
      if (initialOutbox?.storageKey !== queueStorageKey) return;
      // Persist the validated/compacted projection loaded during hydration.
      writeSharedSessionActionOutbox(queueStorageKey, initialOutbox.actions);
      while (true) {
        const outbox = sharedSessionActionOutboxRef.current;
        if (!outbox || outbox.storageKey !== queueStorageKey) return;
        const pending = outbox.actions[0];
        if (!pending) break;

        try {
          sharedSessionRefreshGenerationRef.current += 1;
          const session = await repository.social.updateSharedStudySessionParticipant(
            pending.sessionId,
            pending.action,
          );
          sharedSessionRefreshGenerationRef.current += 1;
          if (sharedSessionActionOutboxRef.current?.storageKey !== queueStorageKey) return;
          outbox.actions.shift();
          writeSharedSessionActionOutbox(queueStorageKey, outbox.actions);
          touchedSessionIds.add(pending.sessionId);
          if (session) upsertSharedStudySession(session);
          else {
            setSharedStudySessions((current) => (
              current.filter((entry) => entry.id !== pending.sessionId)
            ));
          }
        } catch (error) {
          if (sharedSessionActionOutboxRef.current?.storageKey !== queueStorageKey) return;
          const normalized = asRepositoryError(error);
          setSocialError(normalized.message);
          if (normalized.retryable) break;

          // A permanent lifecycle mismatch must not block newer sessions. Its
          // authoritative state is fetched in the reconciliation pass below.
          outbox.actions.shift();
          writeSharedSessionActionOutbox(queueStorageKey, outbox.actions);
          touchedSessionIds.add(pending.sessionId);
        }
      }

      if (touchedSessionIds.size === 0) return;
      await Promise.all([...touchedSessionIds].map(async (sessionId) => {
        try {
          const session = await repository.social.getSharedStudySessionDetails(sessionId);
          if (sharedSessionActionOutboxRef.current?.storageKey === queueStorageKey) {
            upsertSharedStudySession(session);
          }
        } catch (error) {
          const normalized = asRepositoryError(error);
          if (
            sharedSessionActionOutboxRef.current?.storageKey === queueStorageKey
            && (normalized.code === 'forbidden' || normalized.code === 'not_found')
          ) {
            setSharedStudySessions((current) => (
              current.filter((entry) => entry.id !== sessionId)
            ));
          }
        }
      }));
      await retrySync();
    };

    const task = sharedSessionActionDrainTailRef.current.then(drain, drain);
    sharedSessionActionDrainTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }, [
    hydrated,
    online,
    repository,
    retrySync,
    sharedSessionActionStorageKey,
    upsertSharedStudySession,
  ]);

  const fireSharedSessionParticipantAction = useCallback((
    sessionId: string | null | undefined,
    action: SharedStudySessionParticipantAction,
  ) => {
    const cleanSessionId = sessionId?.trim();
    if (
      !cleanSessionId
      || repository.mode !== 'supabase'
      || !sharedSessionActionStorageKey
    ) {
      return;
    }
    const outbox = sharedSessionActionOutboxRef.current;
    if (!outbox || outbox.storageKey !== sharedSessionActionStorageKey) return;
    try {
      outbox.actions = enqueueSharedSessionAction(outbox.actions, {
        sessionId: cleanSessionId,
        action,
      });
    } catch (error) {
      setSocialError(asRepositoryError(error).message);
      return;
    }
    writeSharedSessionActionOutbox(sharedSessionActionStorageKey, outbox.actions);
    if (hydrated && online) void drainSharedSessionActionOutbox();
  }, [
    drainSharedSessionActionOutbox,
    hydrated,
    online,
    repository.mode,
    sharedSessionActionStorageKey,
  ]);

  useEffect(() => {
    if (!hydrated || !online || repository.mode !== 'supabase') return;
    void drainSharedSessionActionOutbox();
  }, [drainSharedSessionActionOutbox, hydrated, online, repository.mode]);

  useEffect(() => {
    if (!hydrated || repository.mode !== 'supabase') return;
    const timeout = setTimeout(() => {
      void retrySync();
      void refreshSocial();
    }, 0);
    return () => clearTimeout(timeout);
  }, [hydrated, refreshSocial, repository.mode, retrySync]);

  useEffect(() => {
    if (
      !hydrated
      || !online
      || repository.mode !== 'supabase'
      || appState !== 'active'
    ) return;
    const controller = new AbortController();
    let cleanup: (() => Promise<void>) | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const pendingKinds = new Set<SocialInvalidationKind>();
    const invalidate = (kind: SocialInvalidationKind) => {
      pendingKinds.add(kind);
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        const kinds = [...pendingKinds];
        pendingKinds.clear();
        if (kinds.some((entry) => (
          entry === 'social'
          || entry === 'profile'
          || entry === 'friendship'
          || entry === 'study_group'
        ))) {
          void refreshSocial({ silent: true });
          return;
        }
        void Promise.all(kinds.map(refreshSocialProjection));
      }, 300);
    };
    void repository.subscribeSocialUpdates({
      onInvalidated: invalidate,
      onError: () => setSocialRealtimeUnavailable(true),
      onSubscribed: () => setSocialRealtimeUnavailable(false),
    }, controller.signal).then((nextCleanup) => {
      if (controller.signal.aborted) void nextCleanup();
      else cleanup = nextCleanup;
    }).catch((error: unknown) => {
      const normalized = asRepositoryError(error);
      if (!controller.signal.aborted && normalized.code !== 'cancelled') {
        setSocialRealtimeUnavailable(true);
      }
    });
    return () => {
      controller.abort();
      if (debounce) clearTimeout(debounce);
      if (cleanup) void cleanup();
    };
  }, [
    appState,
    hydrated,
    online,
    refreshSocial,
    refreshSocialProjection,
    repository,
  ]);

  useEffect(() => {
    const previous = previousAppStateRef.current;
    previousAppStateRef.current = appState;
    if (!hydrated || repository.mode !== 'supabase' || !online) return;
    if (appState === 'active' && previous !== 'active') {
      lastPresenceHeartbeatRef.current = null;
      void refreshSocial({ silent: true });
    } else if (appState === 'background' && previous !== 'background') {
      lastPresenceHeartbeatRef.current = null;
      void enqueuePresenceMutation('offline', null).catch(() => undefined);
    }
  }, [
    appState,
    enqueuePresenceMutation,
    hydrated,
    online,
    refreshSocial,
    repository.mode,
  ]);

  useEffect(() => {
    if (!hydrated || repository.mode !== 'supabase' || !online || appState !== 'active') return;
    const timer = state.data.activeTimer;
    const presence = {
      state: timer?.status === 'running'
        ? 'learning' as const
        : timer?.status === 'paused'
          ? 'paused' as const
          : 'idle' as const,
      activeSince: timer ? timer.startedAt : null,
    };

    const sendPresence = async () => {
      const now = Date.now();
      const previous = lastPresenceHeartbeatRef.current;
      const pending = pendingPresenceMutationRef.current;
      if (
        (
          pending
          && pending.state === presence.state
          && pending.activeSince === presence.activeSince
        )
        || (
        previous &&
        previous.state === presence.state &&
        previous.activeSince === presence.activeSince &&
        now - previous.sentAt < 45_000
        )
      ) return;
      try {
        await enqueuePresenceMutation(presence.state, presence.activeSince);
      } catch {
        // The 15-second retry loop below keeps transient failures from turning
        // into a stale two-minute client-side suppression window.
      }
    };

    void sendPresence();
    const heartbeat = setInterval(() => void sendPresence(), 15_000);
    return () => {
      clearInterval(heartbeat);
    };
  }, [
    hydrated,
    appState,
    enqueuePresenceMutation,
    online,
    repository.mode,
    state.data.activeTimer,
  ]);

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
      const sharedSessionId = cleanOptionalText(options.sharedSessionId);
      const timer: ActiveTimer = {
        schemaVersion: 1,
        id: makeId('timer'),
        userId: currentActorId,
        goalId: binding.goalId,
        sharedSessionId,
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
      fireSharedSessionParticipantAction(sharedSessionId, 'start');
      return timer;
    };

    const pauseTimer = (): ActiveTimer | null => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'running') return null;
      const paused = pauseActiveTimer(timer);
      dispatch({ type: 'set-active-timer', payload: paused });
      fireSharedSessionParticipantAction(timer.sharedSessionId, 'pause');
      return paused;
    };

    const resumeTimer = (): ActiveTimer | null => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'paused') return null;
      const resumed = resumeActiveTimer(timer);
      dispatch({ type: 'set-active-timer', payload: resumed });
      fireSharedSessionParticipantAction(timer.sharedSessionId, 'resume');
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
      const session: TimerStudySession = {
        ...buildTimerSession(active, now),
        sharedSessionId: active.sharedSessionId,
      };
      dispatch({ type: 'finish-timer', payload: session });
      fireSharedSessionParticipantAction(active.sharedSessionId, 'finish');
      return session;
    };

    const discardTimer = () => {
      const active = state.data.activeTimer;
      if (!active) return;
      dispatch({ type: 'set-active-timer', payload: null });
      fireSharedSessionParticipantAction(active.sharedSessionId, 'finish');
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
        sharedSessionId: cleanOptionalText(entry.sharedSessionId),
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
      socialError: socialError ?? avatarMaintenanceError,
      socialRealtimeUnavailable,
      friendConnections,
      friendOverviews,
      studyGroups,
      sharedStudySessions,
      sharedGoalProgressById,
      sharingPreferences,
      blockedProfiles,
      communityRulesAcceptance,
      refreshSocial,
      updateAccountProfile: async (profile) => {
        if (repository.mode !== 'supabase') return null;
        const currentState = stateRef.current;
        const current = currentState.data.currentUser as Partial<AccountStudyUser> | null;
        const updated = await runSocialOperation(
          () => repository.social.updateMyProfile({
            username: profile.username,
            displayName: profile.displayName,
            avatarUrl: current?.avatarUrl?.trim() || null,
            timeZone: profile.timeZone
              ?? current?.timeZone
              ?? Intl.DateTimeFormat().resolvedOptions().timeZone
              ?? 'UTC',
            expectedRevision: current?.revision ?? 1,
          }),
        );
        const latestState = stateRef.current;
        const sharing: StudySharingPreferences = {
          shareCurrentlyLearning: sharingPreferences?.shareCurrentlyLearning ?? false,
          sharePauseStatus: sharingPreferences?.sharePauseStatus ?? false,
          shareLastActiveAt: sharingPreferences?.shareLastActiveAt ?? false,
          shareTodayActivity: sharingPreferences?.shareTodayActivity ?? false,
          shareWeeklyMinutes: sharingPreferences?.shareWeeklyMinutes ?? false,
          shareAvatar: sharingPreferences?.shareAvatar ?? false,
          discoverableByUsername: sharingPreferences?.discoverableByUsername ?? false,
          shareTimerStats: latestState.privacy.shareAutomaticMinutes,
          shareManualStats: latestState.privacy.shareManualMinutes,
          shareGoalProgress: latestState.privacy.shareGoalProgress,
          shareStreak: latestState.privacy.shareStreak,
          revision: sharingPreferences?.revision ?? 1,
          updatedAt: sharingPreferences?.updatedAt ?? new Date().toISOString(),
        };
        applyAccountProfile(updated, sharing);
        return updated;
      },
      replaceAccountAvatar: async (asset) => {
        if (repository.mode !== 'supabase') return null;
        const replacement = await runSocialOperation(async () => {
          const userId = accountUserId?.trim() || stateRef.current.data.currentUser?.id;
          if (!userId) {
            throw new Error(
              'Das Online-Profil ist noch nicht geladen. Bitte versuche es gleich erneut.',
            );
          }
          const reencodedAsset = await reencodeAvatarForUpload(asset);
          let prepared: Awaited<ReturnType<typeof prepareAvatarUpload>>;
          try {
            prepared = await prepareAvatarUpload(reencodedAsset);
          } finally {
            if (reencodedAsset.uri !== asset.uri) cleanupTemporaryAvatarUri(reencodedAsset.uri);
          }
          const { body, contentType, fileExtension } = prepared;
          const uploaded = await repository.social.uploadAvatar({
            userId,
            objectId: randomUUID(),
            body,
            contentType,
            fileExtension,
          });
          try {
            const confirmed = await repository.social.setMyAvatar(uploaded.objectPath);
            return {
              profile: confirmed.profile,
              previousAvatarUrl: confirmed.previousAvatarUrl,
              objectPath: uploaded.objectPath,
              userId,
            };
          } catch (error) {
            // The RPC may have committed even when its response was lost. A
            // fresh profile read distinguishes that ambiguous network outcome
            // from an actual rejection before the uploaded object is removed.
            let reconciledProfile: AccountStudyUser | null = null;
            try {
              reconciledProfile = await repository.social.getMyProfile();
            } catch {
              // Keep the object. Startup maintenance will remove it later if
              // it is not the profile's current avatar.
            }
            if (avatarUrlReferencesObjectPath(
              reconciledProfile?.avatarUrl,
              userId,
              uploaded.objectPath,
            )) {
              return {
                profile: reconciledProfile as AccountStudyUser,
                previousAvatarUrl: null,
                objectPath: uploaded.objectPath,
                userId,
              };
            }
            if (reconciledProfile) {
              await repository.social.deleteAvatarObject(userId, uploaded.objectPath)
                .catch(() => undefined);
            }
            throw error;
          }
        });
        const latestState = stateRef.current;
        const sharing: StudySharingPreferences = {
          shareCurrentlyLearning: sharingPreferences?.shareCurrentlyLearning ?? false,
          sharePauseStatus: sharingPreferences?.sharePauseStatus ?? false,
          shareLastActiveAt: sharingPreferences?.shareLastActiveAt ?? false,
          shareTodayActivity: sharingPreferences?.shareTodayActivity ?? false,
          shareWeeklyMinutes: sharingPreferences?.shareWeeklyMinutes ?? false,
          shareAvatar: sharingPreferences?.shareAvatar ?? false,
          discoverableByUsername: sharingPreferences?.discoverableByUsername ?? false,
          shareTimerStats: latestState.privacy.shareAutomaticMinutes,
          shareManualStats: latestState.privacy.shareManualMinutes,
          shareGoalProgress: latestState.privacy.shareGoalProgress,
          shareStreak: latestState.privacy.shareStreak,
          revision: sharingPreferences?.revision ?? 1,
          updatedAt: sharingPreferences?.updatedAt ?? new Date().toISOString(),
        };
        applyAccountProfile(replacement.profile, sharing);
        await refreshSocial({ silent: true }).catch(() => undefined);
        try {
          await runAvatarCleanup(
            replacement.userId,
            replacement.objectPath,
            replacement.previousAvatarUrl ?? undefined,
          );
          setAvatarMaintenanceError(null);
        } catch {
          setAvatarMaintenanceError(
            'Das Profilbild ist gespeichert. Alte Bilddateien werden automatisch erneut bereinigt.',
          );
        }
        return replacement.profile;
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
      blockUser: async (userId) => {
        await runSocialOperation(() => repository.social.blockUser(userId));
        await refreshSocial();
      },
      unblockUser: async (userId) => {
        await runSocialOperation(() => repository.social.unblockUser(userId));
        await refreshSocial();
      },
      submitContentReport: (input) => runSocialOperation(
        () => repository.social.submitContentReport(input),
      ),
      acceptCommunityRules: async () => {
        const accepted = await runSocialOperation(
          () => repository.social.acceptCommunityRules('2026-08-02'),
        );
        setCommunityRulesAcceptance(accepted);
        return accepted;
      },
      exportAccountData: () => runSocialOperation(
        () => repository.social.exportMyData(),
      ),
      saveSharingPreferences: async (preferences) => {
        if (repository.mode !== 'supabase' || !sharingPreferences) {
          throw new StudyRepositoryError(
            'unavailable',
            'Die Datenschutzfreigaben sind noch nicht verfügbar.',
          );
        }
        const updated = await runSocialOperation(
          () => repository.social.updateSharingPreferences({
            shareTimerStats: preferences.shareTimerStats,
            shareManualStats: preferences.shareManualStats,
            shareGoalProgress: preferences.shareGoalProgress,
            shareStreak: preferences.shareStreak,
            shareCurrentlyLearning: preferences.shareCurrentlyLearning ?? false,
            sharePauseStatus: preferences.sharePauseStatus ?? false,
            shareLastActiveAt: preferences.shareLastActiveAt ?? false,
            shareTodayActivity: preferences.shareTodayActivity ?? false,
            shareWeeklyMinutes: preferences.shareWeeklyMinutes ?? false,
            shareAvatar: preferences.shareAvatar ?? false,
            discoverableByUsername: preferences.discoverableByUsername ?? false,
            expectedRevision: sharingPreferences.revision,
          }),
        );
        setSharingPreferences(updated);
        const profile = stateRef.current.data.currentUser;
        if (profile) applyAccountProfile(profile, updated);
        return updated;
      },
      getFriendOverview: getFriendOverviewCommand,
      createSharedGoal: async (input) => {
        const challenge = await runSocialOperation(
          () => repository.social.createSharedGoal(input),
        );
        dispatch({ type: 'upsert-challenge', payload: challenge });
        return challenge;
      },
      respondSharedGoalInvitation: async (goalId, accept) => {
        const challenge = await runSocialOperation(
          () => repository.social.respondSharedGoalInvitation(goalId, accept),
        );
        if (challenge) dispatch({ type: 'upsert-challenge', payload: challenge });
        else {
          dispatch({ type: 'remove-challenge', payload: goalId });
          removeSharedGoalProgress(goalId);
        }
        return challenge;
      },
      withdrawFromSharedGoal: async (goalId) => {
        await runSocialOperation(() => repository.social.withdrawFromSharedGoal(goalId));
        dispatch({ type: 'remove-challenge', payload: goalId });
        removeSharedGoalProgress(goalId);
      },
      getSharedGoalDetails: getSharedGoalDetailsCommand,
      getSharedGoalProgress: getSharedGoalProgressCommand,
      subscribeSharedGoalProgress: subscribeSharedGoalProgressCommand,
      createStudyGroup: async (input) => {
        try {
          const group = await runSocialOperation(
            () => repository.social.createStudyGroup(input),
          );
          upsertStudyGroup(group);
          return group;
        } catch {
          return null;
        }
      },
      getStudyGroupDetails: getStudyGroupDetailsCommand,
      respondStudyGroupInvitation: async (groupId, accept) => {
        const group = await runSocialOperation(
          () => repository.social.respondStudyGroupInvitation(groupId, accept),
        );
        if (group) upsertStudyGroup(group);
        else setStudyGroups((current) => current.filter((entry) => entry.id !== groupId));
        return group;
      },
      leaveStudyGroup: async (groupId) => {
        await runSocialOperation(() => repository.social.leaveStudyGroup(groupId));
        setStudyGroups((current) => current.filter((entry) => entry.id !== groupId));
      },
      createSharedStudySession: async (input) => {
        sharedSessionRefreshGenerationRef.current += 1;
        const session = await runSocialOperation(
          () => repository.social.createSharedStudySession(input),
        );
        sharedSessionRefreshGenerationRef.current += 1;
        upsertSharedStudySession(session);
        return session;
      },
      getSharedStudySessionDetails: getSharedStudySessionDetailsCommand,
      respondSharedStudySessionInvitation: async (sessionId, accept) => {
        sharedSessionRefreshGenerationRef.current += 1;
        const session = await runSocialOperation(
          () => repository.social.respondSharedStudySessionInvitation(sessionId, accept),
        );
        sharedSessionRefreshGenerationRef.current += 1;
        if (session) upsertSharedStudySession(session);
        else setSharedStudySessions((current) => current.filter((entry) => entry.id !== sessionId));
        return session;
      },
      updateSharedStudySessionParticipant: async (sessionId, action) => {
        sharedSessionRefreshGenerationRef.current += 1;
        const session = await runSocialOperation(
          () => repository.social.updateSharedStudySessionParticipant(sessionId, action),
        );
        sharedSessionRefreshGenerationRef.current += 1;
        if (session) upsertSharedStudySession(session);
        else setSharedStudySessions((current) => current.filter((entry) => entry.id !== sessionId));
        return session;
      },
      cancelSharedStudySession: async (sessionId) => {
        try {
          sharedSessionRefreshGenerationRef.current += 1;
          const session = await runSocialOperation(
            () => repository.social.cancelSharedStudySession(sessionId),
          );
          sharedSessionRefreshGenerationRef.current += 1;
          if (session) upsertSharedStudySession(session);
          return session;
        } catch {
          return null;
        }
      },
      addSubject,
      updateLocalProfile,
      clearLocalProfile: () => dispatch({ type: 'set-current-user', payload: null }),
      startTimer,
      pauseTimer,
      resumeTimer,
      finishTimer,
      discardTimer,
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
          shareCurrentlyLearning: sharingPreferences.shareCurrentlyLearning ?? false,
          sharePauseStatus: sharingPreferences.sharePauseStatus ?? false,
          shareLastActiveAt: sharingPreferences.shareLastActiveAt ?? false,
          shareTodayActivity: sharingPreferences.shareTodayActivity ?? false,
          shareWeeklyMinutes: sharingPreferences.shareWeeklyMinutes ?? false,
          shareAvatar: sharingPreferences.shareAvatar ?? false,
          discoverableByUsername: sharingPreferences.discoverableByUsername ?? false,
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
            applyAccountProfile(profile, sharing);
          }
        }).catch(() => undefined);
      },
      clearAllData,
    };
  }, [
    accountUserId,
    applyAccountProfile,
    avatarMaintenanceError,
    blockedProfiles,
    communityRulesAcceptance,
    friendConnections,
    friendOverviews,
    studyGroups,
    sharedStudySessions,
    sharedGoalProgressById,
    fireSharedSessionParticipantAction,
    getFriendOverviewCommand,
    getSharedStudySessionDetailsCommand,
    getStudyGroupDetailsCommand,
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
    removeSharedGoalProgress,
    repository,
    retrySync,
    runAvatarCleanup,
    runSocialOperation,
    sharingPreferences,
    socialError,
    socialRealtimeUnavailable,
    socialLoading,
    state,
    storageKey,
    storageScope,
    syncStatus,
    subscribeSharedGoalProgressCommand,
    upsertSharedStudySession,
    upsertStudyGroup,
  ]);

  return <StudyStoreContext value={value}>{children}</StudyStoreContext>;
}

export function useStudyStore(): StudyStoreValue {
  const context = use(StudyStoreContext);
  if (!context) throw new Error('useStudyStore must be used inside StudyStoreProvider');
  return context;
}
