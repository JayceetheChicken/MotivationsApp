import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { formatMinutes } from '@/lib/format';
import { useAppTheme } from '@/theme';

import {
  FRIEND_LEARNING_STATUS_LABELS,
  LearningStatusBadge,
} from './learning-status-badge';
import type { FriendStatusViewModel } from './types';

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function nowTimestamp(now: Date | number | undefined): number {
  const timestamp = now instanceof Date ? now.getTime() : now ?? Date.now();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function formatSocialRelativeTime(
  value: string | null | undefined,
  now?: Date | number,
): string | null {
  const timestamp = validTimestamp(value);
  if (timestamp === null) return null;

  const elapsedMinutes = Math.max(0, Math.floor((nowTimestamp(now) - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'gerade eben';
  if (elapsedMinutes < 60) return `vor ${elapsedMinutes} Min.`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `vor ${elapsedHours} Std.`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return 'gestern';
  if (elapsedDays < 7) return `vor ${elapsedDays} Tagen`;

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(timestamp));
}

function formatActiveDuration(
  value: string | null | undefined,
  now?: Date | number,
): string | null {
  const timestamp = validTimestamp(value);
  if (timestamp === null) return null;

  const elapsedMinutes = Math.max(0, Math.floor((nowTimestamp(now) - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'seit Kurzem';
  if (elapsedMinutes < 60) return `seit ${elapsedMinutes} Min.`;

  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes === 0 ? `seit ${hours} Std.` : `seit ${hours} Std. ${minutes} Min.`;
}

function activityLabel(friend: FriendStatusViewModel, now?: Date | number): string {
  if (friend.status === 'learning_now') {
    const duration = formatActiveDuration(friend.activeSince, now);
    return duration ? `Lernt ${duration}` : 'Lernt gerade';
  }

  const relativeTime = formatSocialRelativeTime(friend.lastStudyAt, now);
  return relativeTime
    ? `Zuletzt gelernt ${relativeTime}`
    : 'Letzte Lernaktivität nicht verfügbar';
}

export type FriendStatusCardProps = {
  friend: FriendStatusViewModel;
  onPress?: () => void;
  compact?: boolean;
  showMetrics?: boolean;
  now?: Date | number;
  style?: StyleProp<ViewStyle>;
};

export function FriendStatusCard({
  friend,
  onPress,
  compact = false,
  showMetrics = true,
  now,
  style,
}: FriendStatusCardProps) {
  const theme = useAppTheme();
  const statusLabel = FRIEND_LEARNING_STATUS_LABELS[friend.status];
  const latestActivity = activityLabel(friend, now);
  const weekLabel = friend.weekMinutes === null
    ? 'Nicht verfügbar'
    : formatMinutes(Math.max(0, friend.weekMinutes), true);
  const streakLabel = friend.streakDays === null
    ? 'Nicht verfügbar'
    : `${Math.max(0, Math.round(friend.streakDays))} ${friend.streakDays === 1 ? 'Tag' : 'Tage'}`;

  return (
    <AppCard
      accessibilityLabel={[
        friend.user.displayName,
        `@${friend.user.username}`,
        statusLabel,
        latestActivity,
        showMetrics ? `Diese Woche ${weekLabel}` : null,
        showMetrics ? `Streak ${streakLabel}` : null,
      ].filter(Boolean).join(', ')}
      onPress={onPress}
      padding={compact ? 'sm' : 'md'}
      style={[styles.card, compact ? styles.cardCompact : undefined, style]}
      testID={`friend-status-${friend.user.id}`}>
      <View style={styles.identityRow}>
        <Avatar
          name={friend.user.displayName}
          size={compact ? 'md' : 'lg'}
          source={friend.user.avatarUrl ? { uri: friend.user.avatarUrl } : undefined}
        />
        <View style={styles.identityCopy}>
          <Text
            numberOfLines={1}
            selectable
            style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {friend.user.displayName}
          </Text>
          <Text
            numberOfLines={1}
            selectable
            style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            @{friend.user.username}
          </Text>
        </View>
        <LearningStatusBadge compact status={friend.status} />
      </View>

      <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
        {latestActivity}
      </Text>

      {showMetrics ? (
        <View style={[styles.metrics, { borderTopColor: theme.colors.divider }]}>
          <View style={styles.metric}>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Diese Woche
            </Text>
            <Text
              selectable
              style={[theme.typography.label, styles.numeric, { color: theme.colors.text }]}>
              {weekLabel}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Streak
            </Text>
            <Text
              selectable
              style={[theme.typography.label, styles.numeric, { color: theme.colors.accentOlive }]}>
              {streakLabel}
            </Text>
          </View>
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 14,
  },
  cardCompact: {
    gap: 10,
  },
  identityRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  identityCopy: {
    minWidth: 112,
    flex: 1,
    gap: 1,
  },
  metrics: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metric: {
    minWidth: 112,
    flex: 1,
    gap: 2,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
