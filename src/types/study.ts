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

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon: string;
  archived?: boolean;
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
  contributionMinutes: number;
  timerSessionCount: number;
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
