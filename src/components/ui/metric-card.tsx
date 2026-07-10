import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard, type AppCardProps } from '@/components/ui/app-card';
import { useAppTheme } from '@/theme';

export type MetricTrendTone = 'positive' | 'negative' | 'neutral';

export type MetricTrend = Readonly<{
  label: string;
  tone?: MetricTrendTone;
}>;

export type MetricCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  trend?: MetricTrend;
  icon?: ReactNode;
  emphasized?: boolean;
  onPress?: AppCardProps['onPress'];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function MetricCard({
  label,
  value,
  detail,
  trend,
  icon,
  emphasized = false,
  onPress,
  accessibilityLabel,
  style,
}: MetricCardProps) {
  const theme = useAppTheme();
  const trendTone = trend?.tone ?? 'neutral';
  const trendForeground = {
    positive: theme.colors.success,
    negative: theme.colors.danger,
    neutral: theme.colors.textMuted,
  }[trendTone];
  const trendBackground = {
    positive: theme.colors.successMuted,
    negative: theme.colors.dangerMuted,
    neutral: theme.colors.surfaceMuted,
  }[trendTone];
  const summary = [label, String(value), detail, trend?.label].filter(Boolean).join(', ');

  return (
    <AppCard
      accessible
      accessibilityLabel={accessibilityLabel ?? summary}
      onPress={onPress}
      style={[styles.card, style]}
      variant={emphasized ? 'highlight' : 'default'}>
      <View style={styles.topRow}>
        <Text selectable style={[theme.typography.label, styles.label, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        {icon ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.icon,
              {
                borderRadius: theme.radii.sm,
                backgroundColor: emphasized
                  ? theme.colors.surface
                  : theme.colors.primaryMuted,
              },
            ]}>
            {icon}
          </View>
        ) : null}
      </View>
      <Text
        selectable
        style={[
          theme.typography.metric,
          styles.value,
          { color: emphasized ? theme.colors.onPrimaryMuted : theme.colors.text },
        ]}>
        {value}
      </Text>
      {(detail || trend) && (
        <View style={styles.footer}>
          {detail ? (
            <Text
              selectable
              style={[theme.typography.caption, styles.detail, { color: theme.colors.textMuted }]}>
              {detail}
            </Text>
          ) : null}
          {trend ? (
            <View
              style={[
                styles.trend,
                { backgroundColor: trendBackground, borderRadius: theme.radii.pill },
              ]}>
              <Text style={[theme.typography.caption, { color: trendForeground }]}>
                {trend.label}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    gap: 8,
  },
  topRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    flex: 1,
  },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  footer: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  detail: {
    flexShrink: 1,
  },
  trend: {
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
  },
});
