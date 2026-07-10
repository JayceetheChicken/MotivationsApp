import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme';

export type ProgressBarTone = 'primary' | 'success' | 'warning';
export type ProgressBarSize = 'sm' | 'md' | 'lg';

export type ProgressBarProps = {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  formatValue?: (percentage: number, value: number, max: number) => string;
  tone?: ProgressBarTone;
  size?: ProgressBarSize;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  formatValue,
  tone = 'primary',
  size = 'md',
  accessibilityLabel,
  style,
}: ProgressBarProps) {
  const theme = useAppTheme();
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const percentage = Math.round((safeValue / safeMax) * 100);
  const valueLabel = formatValue?.(percentage, safeValue, safeMax) ?? `${percentage} %`;
  const height = { sm: 6, md: 8, lg: 12 }[size];
  const fillColor = {
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
  }[tone];

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label ?? 'Fortschritt'}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: safeMax, now: safeValue, text: valueLabel }}
      style={[styles.container, style]}>
      {(label || showValue) && (
        <View style={styles.header}>
          {label ? (
            <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
              {label}
            </Text>
          ) : (
            <View />
          )}
          {showValue ? (
            <Text
              selectable
              style={[
                theme.typography.label,
                styles.numeric,
                { color: theme.colors.text },
              ]}>
              {valueLabel}
            </Text>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.track,
          {
            height,
            borderRadius: height / 2,
            backgroundColor: theme.colors.track,
          },
        ]}>
        <View
          style={[
            styles.fill,
            {
              width: `${percentage}%`,
              borderRadius: height / 2,
              backgroundColor: fillColor,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 8,
  },
  header: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
