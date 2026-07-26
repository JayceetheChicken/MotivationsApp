export type SocialUserSummary = Readonly<{
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}>;

export type FriendLearningStatus =
  | 'learning_now'
  | 'learned_today'
  | 'not_learned_today';

/**
 * Deliberately narrow projection for social surfaces. Private subjects, tasks,
 * notes and session details have no place in this view model.
 */
export type FriendStatusViewModel = Readonly<{
  user: SocialUserSummary;
  status: FriendLearningStatus;
  activeSince?: string | null;
  lastStudyAt?: string | null;
  weekMinutes: number | null;
  streakDays: number | null;
}>;

export type SocialActionState = 'idle' | 'loading' | 'disabled';

export type UsernameSearchRelationship =
  | 'none'
  | 'pending_sent'
  | 'pending_received'
  | 'accepted';

export type UsernameSearchResult = Readonly<{
  user: SocialUserSummary;
  relationship: UsernameSearchRelationship;
}>;

export type SocialConnectionStatus = 'accepted' | 'pending_sent' | 'pending_received';

export type SocialConnection = Readonly<{
  id: string;
  user: SocialUserSummary;
  status: SocialConnectionStatus;
}>;

export type PrivacySourceKey =
  | 'shareTimerStats'
  | 'shareManualStats'
  | 'shareGoalProgress'
  | 'shareStreak';

export type PrivacySourceValues = Readonly<Record<PrivacySourceKey, boolean>>;

export type FriendStatsPeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month';

export type FriendStatsMetric = Readonly<{
  minutes: number;
  sessionCount: number;
}>;

export type FriendStatsPeriod = Readonly<{
  key: FriendStatsPeriodKey;
  timer: FriendStatsMetric | null;
  manual: FriendStatsMetric | null;
  total: FriendStatsMetric | null;
}>;

export type FriendStatsLoadState = 'loading' | 'ready' | 'error';

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
