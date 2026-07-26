import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme';

import type { FriendLearningStatus } from './types';

export const FRIEND_LEARNING_STATUS_LABELS: Readonly<Record<FriendLearningStatus, string>> = {
  learning_now: 'Lernt gerade',
  learned_today: 'Heute bereits gelernt',
  not_learned_today: 'Heute noch nicht gelernt',
};

export type LearningStatusBadgeProps = {
  status: FriendLearningStatus;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function LearningStatusBadge({
  status,
  compact = false,
  style,
}: LearningStatusBadgeProps) {
  const theme = useAppTheme();
  const colors = {
    learning_now: {
      background: theme.colors.successMuted,
      foreground: theme.colors.success,
    },
    learned_today: {
      background: theme.colors.accentMustardMuted,
      foreground: theme.colors.accentMustard,
    },
    not_learned_today: {
      background: theme.colors.surfaceMuted,
      foreground: theme.colors.accentBrown,
    },
  }[status];
  const label = FRIEND_LEARNING_STATUS_LABELS[status];

  return (
    <View
      accessibilityLabel={`Lernstatus: ${label}`}
      accessibilityRole="text"
      style={[
        styles.badge,
        {
          minHeight: compact ? 24 : 28,
          paddingHorizontal: compact ? theme.spacing.xs : theme.spacing.sm,
          backgroundColor: colors.background,
          borderRadius: theme.radii.pill,
        },
        style,
      ]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.dot, { backgroundColor: colors.foreground }]}
      />
      <Text
        numberOfLines={1}
        selectable
        style={[theme.typography.caption, { color: colors.foreground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
