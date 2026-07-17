import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getGradePerformanceBand } from '@/lib/grades';
import { useAppTheme } from '@/theme';

interface GradeBadgeProps {
  points: number;
  accessibilityLabel?: string;
  onPress?: () => void;
  size?: 'default' | 'large';
  style?: StyleProp<ViewStyle>;
}

function formatPoints(points: number): string {
  return `${points.toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(points) ? 0 : 1,
    maximumFractionDigits: 1,
  })} P.`;
}

export function GradeBadge({
  points,
  accessibilityLabel,
  onPress,
  size = 'default',
  style,
}: GradeBadgeProps) {
  const theme = useAppTheme();
  const band = getGradePerformanceBand(points);
  const colors = {
    low: { background: theme.colors.dangerMuted, border: theme.colors.danger, text: theme.colors.danger },
    medium: { background: theme.colors.warningMuted, border: theme.colors.warning, text: theme.colors.warning },
    high: { background: theme.colors.successMuted, border: theme.colors.success, text: theme.colors.success },
  }[band];
  const content = (
    <Text
      selectable={!onPress}
      style={[
        size === 'large' ? theme.typography.heading : theme.typography.label,
        styles.numeric,
        { color: colors.text },
      ]}>
      {formatPoints(points)}
    </Text>
  );
  const badgeStyle: StyleProp<ViewStyle> = [
    styles.badge,
    size === 'large' ? styles.large : undefined,
    {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderRadius: theme.radii.md,
    },
    style,
  ];

  if (!onPress) {
    return <View style={badgeStyle}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? `${formatPoints(points)} öffnen`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [badgeStyle, pressed ? styles.pressed : undefined]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 56,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  large: {
    minWidth: 112,
    minHeight: 72,
    paddingHorizontal: 20,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
});
