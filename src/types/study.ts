export type ISODateTime = string;

export type SessionSource = 'timer' | 'manual';

export interface StudyUser {
  id: string;
  username: string;
  displayName: string;
  /** Optional because a local profile can be created without an image. */
  avatarUrl?: string;
  avatarInitials?: string;
  avatarColor?: string;
}

/** Server-backed account profile. Local profiles intentionally omit these fields. */
export interface AccountStudyUser extends StudyUser {
  timeZone: string;
  usernameNeedsReview: boolean;
  revision: number;
}

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon: string;
  archived?: boolean;
  revision?: number;
  syncVersion?: string;
  updatedAt?: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface TimerSegment {
  startedAt: ISODateTime;
  endedAt: ISODateTime;
}

interface StudySessionBase {
  id: string;
  userId: string;
  /**
   * Explicit goal binding. Older persisted sessions may omit this property;
   * `null` represents an intentionally goal-free session.
   */
  goalId?: string | null;
  /** Optional binding to a collaborative session; private study details stay separate. */
  sharedSessionId?: string | null;
  subjectId: string;
  /** Historical labels keep deleted or renamed goals/subjects understandable. */
  goalTitleSnapshot?: string;
  subjectNameSnapshot?: string;
  startedAt: ISODateTime;
  endedAt: ISODateTime;
  durationMinutes: number;
  plannedDurationMinutes?: number;
  note?: string;
  createdAt: ISODateTime;
  /** Optional so existing in-memory fixtures remain backwards-compatible. */
  status?: 'completed';
  revision?: number;
  syncVersion?: string;
  updatedAt?: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface TimerStudySession extends StudySessionBase {
  source: 'timer';
  segments: readonly TimerSegment[];
}

export interface ManualStudySession extends StudySessionBase {
  source: 'manual';
  enteredAt: ISODateTime;
}

export type StudySession = TimerStudySession | ManualStudySession;

export interface ActiveTimerSegment {
  startedAt: ISODateTime;
  /** `null` marks the currently running segment. */
  endedAt: ISODateTime | null;
}

/**
 * JSON-safe state that can be persisted after every timer transition.
 * When `status` is `running`, exactly the last segment is open.
 */
export interface ActiveTimer {
  schemaVersion: 1;
  id: string;
  userId: string;
  /** Missing only on timers persisted before goal-bound sessions existed. */
  goalId?: string | null;
  /** Missing on timers created before collaborative sessions were introduced. */
  sharedSessionId?: string | null;
  subjectId: string;
  goalTitleSnapshot?: string;
  subjectNameSnapshot?: string;
  status: 'running' | 'paused';
  startedAt: ISODateTime;
  segments: readonly ActiveTimerSegment[];
  plannedDurationMinutes?: number;
  note?: string;
  updatedAt: ISODateTime;
}

export type GoalPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';
export type GoalSourcePolicy = 'all' | 'timer_only';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface GoalPauseInterval {
  startedAt: ISODateTime;
  endedAt: ISODateTime;
}

interface StudyGoalBase {
  id: string;
  userId: string;
  /** Missing or whitespace-only titles are replaced by a generated display title. */
  title?: string;
  period: GoalPeriod;
  sourcePolicy: GoalSourcePolicy;
  /** Canonical single subject for all newly created and explicitly repaired goals. */
  subjectId?: string;
  /** Legacy representation retained so old multi-/unassigned goals can migrate safely. */
  subjectIds?: readonly string[];
  status: GoalStatus;
  createdAt: ISODateTime;
  /**
   * The earliest point at which sessions may count. Optional for backwards
   * compatibility with persisted v1 goals; new and migrated goals always set it.
   */
  startsAt?: ISODateTime;
  /** Inclusive end boundary for custom or explicitly bounded goals. */
  endsAt?: ISODateTime;
  pausedAt?: ISODateTime;
  pausedIntervals?: readonly GoalPauseInterval[];
  completedAt?: ISODateTime;
  archivedAt?: ISODateTime;
  revision?: number;
  syncVersion?: string;
  updatedAt?: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface DurationGoal extends StudyGoalBase {
  type: 'duration';
  targetMinutes: number;
}

export interface SessionsGoal extends StudyGoalBase {
  type: 'sessions';
  targetSessions: number;
  minimumSessionMinutes: number;
}

export type StudyGoal = DurationGoal | SessionsGoal;

export type GradeAssessmentType = 'exam' | 'other';

export interface StudyGrade {
  id: string;
  userId: string;
  subjectId: string;
  /** Keeps the row understandable if a subject is renamed or archived later. */
  subjectNameSnapshot?: string;
  assessmentType: GradeAssessmentType;
  /** Optional custom label; the assessment type is used as a display fallback. */
  title?: string;
  /** Optional local calendar date in YYYY-MM-DD form. */
  assessmentDate?: string;
  /** Whole-number points used in the Bavarian upper-school 0–15 system. */
  points: number;
  /** Learning time that was not captured by one of the linked sessions. */
  additionalStudyMinutes: number;
  /** Explicit links; only sessions of the same user and subject may be stored. */
  sessionIds: readonly string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revision?: number;
  syncVersion?: string;
  deletedAt?: ISODateTime | null;
}

export interface FriendStudySnapshot {
  weekMinutes: number;
  automaticMinutes: number;
  manualMinutes: number;
  timerSessionCount: number;
  weeklyGoalMinutes: number;
  streakDays: number;
  changeFromPreviousWeekPercent: number | null;
}

export interface Friend {
  id: string;
  user: StudyUser;
  status: 'accepted' | 'pending_sent' | 'pending_received';
  canSeeMyStats: boolean;
  canSeeTheirStats: boolean;
  stats?: FriendStudySnapshot;
}

/**
 * Remote privacy grants. `friendComparisonsEnabled` deliberately is not part
 * of this object because it is only a local display preference.
 */
export interface StudySharingPreferences {
  shareTimerStats: boolean;
  shareManualStats: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
  shareCurrentlyLearning?: boolean;
  sharePauseStatus?: boolean;
  shareLastActiveAt?: boolean;
  shareTodayActivity?: boolean;
  shareWeeklyMinutes?: boolean;
  shareAvatar?: boolean;
  discoverableByUsername?: boolean;
  revision: number;
  updatedAt: ISODateTime;
}

export type FriendPresenceStatus = 'learning' | 'paused' | 'online' | 'offline';

/** Privacy-safe friend projection. It deliberately contains no study-detail fields. */
export interface FriendOverview {
  friend: StudyUser;
  presenceStatus: FriendPresenceStatus;
  lastActiveAt: ISODateTime | null;
  /** Expiry of the currently projected learning/online state. */
  presenceExpiresAt: ISODateTime | null;
  /** Latest online expiry across all devices, used after a learning device expires. */
  onlineExpiresAt: ISODateTime | null;
  todayMinutes?: number | null;
  weekMinutes?: number | null;
  streakDays?: number | null;
  sharedGoalIds: readonly string[];
  sharedSessionIds: readonly string[];
  groupIds: readonly string[];
}

export interface BlockedProfile {
  user: StudyUser;
  blockedAt: ISODateTime;
}

export type ReportEntityType =
  | 'profile'
  | 'profile_name'
  | 'profile_image'
  | 'group'
  | 'group_name'
  | 'group_image'
  | 'shared_goal'
  | 'shared_session';

export type ReportReason =
  | 'harassment'
  | 'hate'
  | 'sexual_content'
  | 'violence'
  | 'spam'
  | 'impersonation'
  | 'privacy'
  | 'other';

export interface ContentReportReceipt {
  id: string;
  status: 'open';
  createdAt: ISODateTime;
}

export interface CommunityRulesAcceptance {
  accepted: boolean;
  version: string;
  acceptedAt: ISODateTime | null;
}

export type AccountDataExport = Readonly<Record<string, unknown>>;

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

export interface FriendshipConnection {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  direction: 'incoming' | 'outgoing';
  otherUser: StudyUser;
  createdAt: ISODateTime;
  respondedAt: ISODateTime | null;
}

export interface FriendSearchResult {
  user: StudyUser;
  connection: Pick<FriendshipConnection, 'id' | 'status' | 'direction'> | null;
}

export type ChallengeMode = 'per_participant' | 'shared';

export type ChallengeTarget =
  | {
      type: 'duration';
      mode: ChallengeMode;
      targetMinutes: number;
    }
  | {
      type: 'sessions';
      mode: ChallengeMode;
      targetSessions: number;
      minimumSessionMinutes: number;
    };

export interface ChallengeParticipant {
  userId: string;
  /** Server-authorized participant profile included by shared-goal read models. */
  user?: StudyUser;
  status: 'invited' | 'accepted' | 'declined' | 'withdrawn';
}

export interface ChallengeParticipantProgress {
  userId: string;
  user: StudyUser;
  status: ChallengeParticipant['status'];
  contribution: number;
  contributionMinutes: number;
  sessionCount: number;
  /** Present only for `per_participant` goals. Percent is deliberately not capped. */
  target: number | null;
  progressPercent: number | null;
  remaining: number | null;
  achieved: boolean | null;
  exceededBy: number | null;
}

export interface SharedGoalTeamProgress {
  contribution: number;
  target: number;
  progressPercent: number;
  remaining: number;
  achieved: boolean;
  exceededBy: number;
}

export interface SharedGoalProgress {
  goalId: string;
  goalType: ChallengeTarget['type'];
  mode: ChallengeMode;
  sourcePolicy: GoalSourcePolicy;
  startsAt: ISODateTime;
  endsAt?: ISODateTime;
  revision: number;
  participants: readonly ChallengeParticipantProgress[];
  /** Non-null exactly when `mode` is `shared`. */
  team: SharedGoalTeamProgress | null;
  /** Aggregate for the whole goal; equals `team` for shared-mode goals. */
  overall: SharedGoalTeamProgress;
  calculatedAt: ISODateTime;
}

export interface StudyChallenge {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  cadence: 'daily' | 'weekly';
  groupId?: string | null;
  target: ChallengeTarget;
  sourcePolicy: GoalSourcePolicy;
  startsAt: ISODateTime;
  endsAt?: ISODateTime;
  status: 'upcoming' | 'active' | 'completed';
  participants: readonly ChallengeParticipant[];
  revision?: number;
  syncVersion?: string;
  updatedAt?: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface StudyGroupMember {
  userId: string;
  user: StudyUser;
  role: 'owner' | 'member';
  status: 'invited' | 'accepted' | 'declined' | 'left';
}

export interface StudyGroup {
  id: string;
  creatorId: string;
  name: string;
  icon: string;
  imageUrl?: string;
  members: readonly StudyGroupMember[];
  sharedGoalIds: readonly string[];
  sharedSessionIds: readonly string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SharedStudySessionParticipant {
  userId: string;
  user: StudyUser;
  status: 'invited' | 'joined' | 'active' | 'paused' | 'finished' | 'declined' | 'left';
  elapsedMinutes: number;
  activeSince?: ISODateTime;
  joinedAt?: ISODateTime;
  finishedAt?: ISODateTime;
}

export interface SharedStudySession {
  id: string;
  creatorId: string;
  groupId: string | null;
  title: string;
  startsAt: ISODateTime;
  plannedDurationMinutes: number;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  startedAt: ISODateTime | null;
  endedAt: ISODateTime | null;
  participants: readonly SharedStudySessionParticipant[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Server timestamp used to order independently fetched participant projections. */
  calculatedAt: ISODateTime | null;
  /** Local receipt baseline used only to animate an active duration. */
  receivedAt?: ISODateTime;
}

export interface StudyData {
  /** `null` until onboarding, local profile creation or sign-in is complete. */
  currentUser: StudyUser | null;
  subjects: readonly Subject[];
  sessions: readonly StudySession[];
  grades: readonly StudyGrade[];
  goals: readonly StudyGoal[];
  friends: readonly Friend[];
  challenges: readonly StudyChallenge[];
  activeTimer: ActiveTimer | null;
}

/** @deprecated Kept so the isolated development fixture remains type-safe. */
export type DemoData = StudyData;
