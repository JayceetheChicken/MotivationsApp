export type SocialUserSummary = Readonly<{
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
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
export type SharedGoalStatus = 'upcoming' | 'active' | 'completed';

export type SharedGoalProgressValues = Readonly<{
  value: number;
  target: number;
  percent: number;
  remaining: number;
  reached: boolean;
  exceeded: number;
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
  period: SharedGoalPeriod;
  sourcePolicy: SharedGoalSourcePolicy;
  targetValue: string;
  minimumSessionMinutes: string;
  participantIds: readonly string[];
}>;
