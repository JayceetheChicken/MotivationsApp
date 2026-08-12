import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type {
  AccountStudyUser,
  FriendOverview,
  FriendSearchResult,
  FriendshipConnection,
  GoalStatus,
  SharedGoalProgress,
  SharedStudySession,
  StudyChallenge,
  StudyGroup,
  StudySharingPreferences,
} from '@/types/study';

export type StudyRepositoryMode = 'local' | 'supabase';

export type SyncPhase = 'idle' | 'offline' | 'syncing' | 'conflict' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  pendingMutationCount: number;
  lastSyncedAt: string | null;
  lastError: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
  }> | null;
}

export interface SyncResult {
  snapshot: StudyStateSnapshot | null;
  appliedMutationCount: number;
  pendingMutationCount: number;
  conflicts: readonly SyncConflict[];
  syncVersion: string | null;
}

export interface SyncConflict {
  operationId: string;
  entityType: CoreEntityType;
  entityId: string | null;
  message: string;
  serverValue?: unknown;
  localValue?: unknown;
}

export type CoreEntityType = 'profile' | 'privacy' | 'subject' | 'goal' | 'session' | 'grade';

export type CoreMutationName =
  | 'upsert_subject'
  | 'soft_delete_subject'
  | 'upsert_personal_goal'
  | 'soft_delete_personal_goal'
  | 'transition_personal_goal'
  | 'save_completed_session'
  | 'soft_delete_session'
  | 'upsert_grade'
  | 'soft_delete_grade';

export interface CoreMutation {
  operationId: string;
  name: CoreMutationName;
  entityType: Exclude<CoreEntityType, 'profile' | 'privacy'>;
  entityId: string;
  payload: Readonly<Record<string, unknown>>;
  expectedRevision?: number;
  dependsOn?: readonly string[];
}

export interface UpdateAccountProfileInput {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  timeZone: string;
  expectedRevision: number;
}

export interface UpdateSharingPreferencesInput {
  shareTimerStats: boolean;
  shareManualStats: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
  expectedRevision: number;
}

export interface UploadAvatarInput {
  userId: string;
  objectId: string;
  body: ArrayBuffer;
  contentType: string;
  fileExtension: string;
}

export interface UploadedAvatar {
  objectPath: string;
}

export interface ConfirmedAvatar {
  profile: AccountStudyUser;
  previousAvatarUrl: string | null;
}

export interface CreateSharedGoalInput {
  operationId: string;
  inviteeIds: readonly string[];
  goal: Readonly<{
    id: string;
    title: string;
    description: string;
    cadence?: 'daily' | 'weekly';
    groupId?: string | null;
    period: 'day' | 'week' | 'month' | 'year' | 'custom';
    type: 'duration' | 'sessions';
    mode: 'per_participant' | 'shared';
    targetMinutes?: number;
    targetSessions?: number;
    minimumSessionMinutes?: number;
    sourcePolicy: 'all' | 'timer_only';
    startsAt?: string;
    endsAt?: string;
  }>;
}

export interface CreateStudyGroupInput {
  operationId: string;
  memberIds: readonly string[];
  group: Readonly<{
    id: string;
    name: string;
    icon: string;
    imageUrl?: string | null;
  }>;
}

export interface CreateSharedStudySessionInput {
  operationId: string;
  inviteeIds: readonly string[];
  session: Readonly<{
    id: string;
    title: string;
    groupId?: string | null;
    startsAt: string;
    plannedDurationMinutes: number;
    startNow: boolean;
  }>;
}

export type SharedStudySessionParticipantAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'finish'
  | 'leave';

export type LearningPresenceState = 'offline' | 'idle' | 'learning' | 'paused';

export type SocialInvalidationKind =
  | 'presence'
  | 'profile'
  | 'friendship'
  | 'shared_session'
  | 'shared_session_progress'
  | 'shared_goal'
  | 'shared_goal_progress'
  | 'study_group'
  | 'social';

export type SocialUpdatesListener = Readonly<{
  onInvalidated: (kind: SocialInvalidationKind) => void;
  onError?: (error: Error) => void;
  onSubscribed?: () => void;
}>;

export interface SocialRepository {
  getMyProfile(signal?: AbortSignal): Promise<AccountStudyUser>;
  updateMyProfile(input: UpdateAccountProfileInput, signal?: AbortSignal): Promise<AccountStudyUser>;
  uploadAvatar(input: UploadAvatarInput, signal?: AbortSignal): Promise<UploadedAvatar>;
  setMyAvatar(objectPath: string, signal?: AbortSignal): Promise<ConfirmedAvatar>;
  deleteAvatarObject(
    userId: string,
    objectPath: string,
    signal?: AbortSignal,
  ): Promise<void>;
  cleanupAvatarObjects(
    userId: string,
    keepObjectPath: string,
    previousAvatarUrl?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  getSharingPreferences(signal?: AbortSignal): Promise<StudySharingPreferences>;
  updateSharingPreferences(
    input: UpdateSharingPreferencesInput,
    signal?: AbortSignal,
  ): Promise<StudySharingPreferences>;
  findProfileByExactUsername(username: string, signal?: AbortSignal): Promise<FriendSearchResult | null>;
  listFriendConnections(signal?: AbortSignal): Promise<readonly FriendshipConnection[]>;
  sendFriendRequest(username: string, signal?: AbortSignal): Promise<FriendshipConnection>;
  acceptFriendRequest(friendshipId: string, signal?: AbortSignal): Promise<FriendshipConnection>;
  declineFriendRequest(friendshipId: string, signal?: AbortSignal): Promise<FriendshipConnection>;
  removeFriendship(friendshipId: string, signal?: AbortSignal): Promise<void>;
  getFriendOverview(friendId: string, signal?: AbortSignal): Promise<FriendOverview>;
  listFriendOverviews(signal?: AbortSignal): Promise<readonly FriendOverview[]>;
  createSharedGoal(input: CreateSharedGoalInput, signal?: AbortSignal): Promise<StudyChallenge>;
  respondSharedGoalInvitation(
    goalId: string,
    accept: boolean,
    signal?: AbortSignal,
  ): Promise<StudyChallenge | null>;
  withdrawFromSharedGoal(goalId: string, signal?: AbortSignal): Promise<void>;
  getSharedGoalDetails(goalId: string, signal?: AbortSignal): Promise<StudyChallenge>;
  getSharedGoalProgress(goalId: string, signal?: AbortSignal): Promise<SharedGoalProgress>;
  listSharedGoalProgress(signal?: AbortSignal): Promise<readonly SharedGoalProgress[]>;
  listSharedGoals(signal?: AbortSignal): Promise<readonly StudyChallenge[]>;
  listStudyGroups(signal?: AbortSignal): Promise<readonly StudyGroup[]>;
  getStudyGroupDetails(groupId: string, signal?: AbortSignal): Promise<StudyGroup>;
  createStudyGroup(input: CreateStudyGroupInput, signal?: AbortSignal): Promise<StudyGroup>;
  respondStudyGroupInvitation(
    groupId: string,
    accept: boolean,
    signal?: AbortSignal,
  ): Promise<StudyGroup | null>;
  leaveStudyGroup(groupId: string, signal?: AbortSignal): Promise<void>;
  listSharedStudySessions(signal?: AbortSignal): Promise<readonly SharedStudySession[]>;
  getSharedStudySessionDetails(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SharedStudySession>;
  createSharedStudySession(
    input: CreateSharedStudySessionInput,
    signal?: AbortSignal,
  ): Promise<SharedStudySession>;
  respondSharedStudySessionInvitation(
    sessionId: string,
    accept: boolean,
    signal?: AbortSignal,
  ): Promise<SharedStudySession | null>;
  updateSharedStudySessionParticipant(
    sessionId: string,
    action: SharedStudySessionParticipantAction,
    signal?: AbortSignal,
  ): Promise<SharedStudySession | null>;
  cancelSharedStudySession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SharedStudySession | null>;
  updateLearningPresence(
    deviceId: string,
    state: LearningPresenceState,
    activeSince: string | null,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface ImportCounts {
  subjects: number;
  goals: number;
  sessions: number;
  grades: number;
  gradeSessionLinks: number;
}

export type ImportEntityType = 'subjects' | 'goals' | 'sessions' | 'grades';

export interface ImportChunk {
  index: number;
  entityType: ImportEntityType;
  hash: string;
  payload: readonly unknown[];
}

export interface LocalImportManifest {
  version: 1;
  deviceFingerprint: string;
  payloadHash: string;
  counts: ImportCounts;
  chunks: readonly ImportChunk[];
  warnings: readonly string[];
  hasActiveTimer: boolean;
  excluded: Readonly<{ friends: number; challenges: number; privacy: boolean }>;
}

export type LocalImportState = 'staging' | 'completed' | 'completed_with_conflicts';

export interface LocalImportHandle {
  importId: string;
  state: LocalImportState;
  acceptedChunkIndices: readonly number[];
}

export interface LocalImportConflict {
  entityType: ImportEntityType;
  localId: string;
  reason: 'different_content' | 'invalid_reference' | 'invalid_data' | 'deleted_on_server';
  message: string;
  serverId?: string;
}

export interface LocalImportReport extends LocalImportHandle {
  imported: ImportCounts;
  duplicates: ImportCounts;
  conflicts: readonly LocalImportConflict[];
}

export interface ImportRepository {
  begin(manifest: LocalImportManifest, signal?: AbortSignal): Promise<LocalImportHandle>;
  stageChunk(importId: string, chunk: ImportChunk, signal?: AbortSignal): Promise<LocalImportHandle>;
  finalize(importId: string, signal?: AbortSignal): Promise<LocalImportReport>;
  getStatus(importId: string, signal?: AbortSignal): Promise<LocalImportReport | LocalImportHandle>;
}

export type SharedGoalProgressListener = Readonly<{
  onProgress: (progress: SharedGoalProgress) => void;
  onError?: (error: Error) => void;
}>;

export interface StudyRepository {
  readonly mode: StudyRepositoryMode;
  readonly accountId: string | null;
  readonly social: SocialRepository;
  readonly imports: ImportRepository;

  loadSnapshot(signal?: AbortSignal): Promise<StudyStateSnapshot | null>;
  saveSnapshot(snapshot: StudyStateSnapshot, signal?: AbortSignal): Promise<void>;
  refresh(signal?: AbortSignal): Promise<StudyStateSnapshot | null>;
  enqueueMutation(mutation: CoreMutation, signal?: AbortSignal): Promise<void>;
  sync(signal?: AbortSignal): Promise<SyncResult>;
  getSyncStatus(): SyncStatus;
  subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void;
  subscribeSharedGoalProgress(
    goalId: string,
    listener: SharedGoalProgressListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>>;
  subscribeSocialUpdates(
    listener: SocialUpdatesListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
}

/** Mutation payload used by the personal-goal lifecycle RPC. */
export interface GoalTransitionPayload {
  goalId: string;
  status: GoalStatus;
  at: string;
  expectedRevision: number;
}
