export type ISODateTime = string;

export type SessionSource = 'timer' | 'manual';

export interface StudyUser {
  id: string;
  username: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
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
  subjectId: string;
  startedAt: ISODateTime;
  endedAt: ISODateTime;
  durationMinutes: number;
  note?: string;
  createdAt: ISODateTime;
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
  subjectId: string;
  status: 'running' | 'paused';
  startedAt: ISODateTime;
  segments: readonly ActiveTimerSegment[];
  note?: string;
  updatedAt: ISODateTime;
}

export type GoalPeriod = 'week' | 'month';
export type GoalSourcePolicy = 'all' | 'timer_only';

interface StudyGoalBase {
  id: string;
  userId: string;
  title: string;
  period: GoalPeriod;
  sourcePolicy: GoalSourcePolicy;
  subjectIds?: readonly string[];
  status: 'active' | 'paused' | 'archived';
  createdAt: ISODateTime;
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

export interface DemoData {
  currentUser: StudyUser;
  subjects: readonly Subject[];
  sessions: readonly StudySession[];
  goals: readonly StudyGoal[];
  friends: readonly Friend[];
  challenges: readonly StudyChallenge[];
  activeTimer: ActiveTimer | null;
}
