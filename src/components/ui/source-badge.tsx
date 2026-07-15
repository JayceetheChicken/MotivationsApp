import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme';

export type LearningSource = 'timer' | 'manual';

export type SourceBadgeProps = {
  source: LearningSource;
  label?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SourceBadge({ source, label, compact = false, style }: SourceBadgeProps) {
  const theme = useAppTheme();
  const isTimer = source === 'timer';
  const displayLabel = label ?? (isTimer ? 'Mit Timer gemessen' : 'Manuell eingetragen');
  const foreground = isTimer ? theme.colors.onPrimaryMuted : theme.colors.warning;
  const background = isTimer ? theme.colors.accentPeachMuted : theme.colors.accentMustardMuted;

  return (
    <View
      accessible
      accessibilityLabel={`Quelle: ${displayLabel}`}
      style={[
        styles.badge,
        {
          minHeight: compact ? 24 : 28,
          paddingHorizontal: compact ? theme.spacing.xs : theme.spacing.sm,
          backgroundColor: background,
          borderRadius: theme.radii.pill,
        },
        style,
      ]}>
      <View style={[styles.dot, { backgroundColor: foreground }]} />
      <Text
        numberOfLines={1}
        selectable
        style={[theme.typography.caption, { color: foreground }]}>
        {displayLabel}
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
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
