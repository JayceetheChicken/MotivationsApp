export type SocialUserSummary = Readonly<{
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}>;

export type SocialActionState = 'idle' | 'loading' | 'disabled';

export type SharedGoalMode = 'per_participant' | 'shared';
export type SharedGoalTargetType = 'duration' | 'sessions';
export type SharedGoalDurationUnit = 'minutes' | 'hours';
export type SharedGoalSourcePolicy = 'all' | 'timer_only';
export type SharedGoalPeriod = 'day' | 'week' | 'month';
export type SharedGoalCadence = 'daily' | 'weekly';
export type SharedGoalStatus = 'upcoming' | 'active' | 'completed';

export type SharedGoalProgressValues = Readonly<{
  value: number;
  target: number;
  percent: number;
  remaining: number;
  reached: boolean;
  exceeded: number;
}>;

export type SharedGoalSummaryViewModel = Readonly<{
  id: string;
  title: string;
  description?: string;
  status: SharedGoalStatus;
  targetType: SharedGoalTargetType;
  periodLabel: string;
  remainingLabel?: string;
  participants: readonly SocialUserSummary[];
  ownProgress?: SharedGoalProgressValues | null;
  /** Authorized contribution to a shared team target, even without an individual target. */
  ownContribution?: number | null;
  teamProgress?: SharedGoalProgressValues | null;
}>;

export type SharedSessionStatus = 'planned' | 'active' | 'completed' | 'cancelled';

/** Only shared session metadata belongs here; each participant's subject stays private. */
export type PlannedSessionViewModel = Readonly<{
  id: string;
  title: string;
  startsAt: string;
  plannedDurationMinutes: number;
  status: SharedSessionStatus;
  participants: readonly SocialUserSummary[];
}>;

export type StudyGroupViewModel = Readonly<{
  id: string;
  name: string;
  icon: string;
  imageUrl?: string;
  memberCount: number;
  activeGoalCount: number;
  nextSessionAt?: string | null;
}>;

export type SharedGoalParticipantProgress = Readonly<{
  user: SocialUserSummary;
  status: 'invited' | 'accepted' | 'declined' | 'withdrawn';
  /** Null until the server-authorized progress projection has been loaded. */
  contribution: number | null;
  progress?: SharedGoalProgressValues;
}>;

export type SharedGoalFormValue = Readonly<{
  title: string;
  description: string;
  mode: SharedGoalMode;
  targetType: SharedGoalTargetType;
  durationUnit: SharedGoalDurationUnit;
  cadence: SharedGoalCadence;
  startsOn: string;
  endsOn: string;
  sourcePolicy: SharedGoalSourcePolicy;
  targetValue: string;
  minimumSessionMinutes: string;
  participantIds: readonly string[];
}>;
