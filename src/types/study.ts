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

export type FriendStatsPeriod =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month';

/**
 * Remote privacy grants. `friendComparisonsEnabled` deliberately is not part
 * of this object because it is only a local display preference.
 */
export interface StudySharingPreferences {
  shareTimerStats: boolean;
  shareManualStats: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
  revision: number;
  updatedAt: ISODateTime;
}

export interface FriendPeriodStatistics {
  period: FriendStatsPeriod;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  timerMinutes: number | null;
  timerSessionCount: number | null;
  manualMinutes: number | null;
  manualSessionCount: number | null;
  totalMinutes: number | null;
  totalSessionCount: number | null;
}

export interface FriendGoalVisibility {
  reached: boolean;
  achievedGoalCount: number;
  evaluatedGoalCount: number;
}

export interface FriendProfileStatistics {
  friend: AccountStudyUser;
  periods: Readonly<Record<FriendStatsPeriod, FriendPeriodStatistics>>;
  streakDays: number | null;
  goals: FriendGoalVisibility | null;
  /** True values describe grants, while nullable metrics distinguish hidden from zero. */
  visibility: Readonly<{
    timer: boolean;
    manual: boolean;
    goals: boolean;
    streak: boolean;
  }>;
}

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
  endsAt: ISODateTime;
  revision: number;
  participants: readonly ChallengeParticipantProgress[];
  /** Non-null exactly when `mode` is `shared`. */
  team: SharedGoalTeamProgress | null;
  calculatedAt: ISODateTime;
}

export interface StudyChallenge {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  target: ChallengeTarget;
  sourcePolicy: GoalSourcePolicy;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  status: 'upcoming' | 'active' | 'completed';
  participants: readonly ChallengeParticipant[];
  revision?: number;
  syncVersion?: string;
  updatedAt?: ISODateTime;
  deletedAt?: ISODateTime | null;
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
