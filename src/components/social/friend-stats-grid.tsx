import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import { useAppTheme } from '@/theme';

import type {
  FriendStatsLoadState,
  FriendStatsMetric,
  FriendStatsPeriod,
  FriendStatsPeriodKey,
} from './types';

export const FRIEND_STATS_PERIOD_LABELS: Readonly<Record<FriendStatsPeriodKey, string>> = {
  today: 'Heute',
  yesterday: 'Gestern',
  this_week: 'Diese Woche',
  last_week: 'Letzte Woche',
  this_month: 'Dieser Monat',
  last_month: 'Letzter Monat',
};

const PERIOD_ORDER: readonly FriendStatsPeriodKey[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
];

function MetricLine({
  label,
  metric,
  source,
}: {
  label: string;
  metric: FriendStatsMetric | null;
  source?: 'timer' | 'manual';
}) {
  const theme = useAppTheme();
  const sessionLabel = metric?.sessionCount === 1 ? '1 Session' : `${metric?.sessionCount ?? 0} Sessions`;

  return (
    <View
      accessibilityLabel={
        metric
          ? `${label}: ${formatMinutes(metric.minutes)}, ${sessionLabel}`
          : `${label}: nicht freigegeben`
      }
      style={styles.metricLine}>
      <View style={styles.metricLabel}>
        {source ? <SourceBadge compact label={label} source={source} /> : (
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
            {label}
          </Text>
        )}
      </View>
      {metric ? (
        <View style={styles.metricValue}>
          <Text
            selectable
            style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>
            {formatMinutes(metric.minutes, true)}
          </Text>
          <Text
            selectable
            style={[theme.typography.caption, styles.numeric, { color: theme.colors.textMuted }]}>
            {sessionLabel}
          </Text>
        </View>
      ) : (
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>
          Nicht freigegeben
        </Text>
      )}
    </View>
  );
}

function PeriodCard({ period, tablet }: { period: FriendStatsPeriod; tablet: boolean }) {
  const theme = useAppTheme();

  return (
    <AppCard
      accessibilityLabel={FRIEND_STATS_PERIOD_LABELS[period.key]}
      style={[styles.periodCard, tablet ? styles.periodCardTablet : styles.periodCardPhone]}
      variant="outlined">
      <Text
        accessibilityRole="header"
        selectable
        style={[theme.typography.subheading, { color: theme.colors.text }]}>
        {FRIEND_STATS_PERIOD_LABELS[period.key]}
      </Text>
      <MetricLine label="Timer" metric={period.timer} source="timer" />
      <MetricLine label="Manuell" metric={period.manual} source="manual" />
      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
      <MetricLine label="Gesamt" metric={period.total} />
    </AppCard>
  );
}

export type FriendStatsGridProps = {
  periods: readonly FriendStatsPeriod[];
  state?: FriendStatsLoadState;
  errorMessage?: string;
  onRetry?: () => void;
  streakDays?: number | null;
  goalReached?: boolean | null;
  style?: StyleProp<ViewStyle>;
};

export function FriendStatsGrid({
  periods,
  state = 'ready',
  errorMessage = 'Die freigegebenen Statistiken konnten nicht geladen werden.',
  onRetry,
  streakDays,
  goalReached,
  style,
}: FriendStatsGridProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= theme.layout.tabletBreakpoint;

  if (state === 'loading') {
    return (
      <AppCard
        accessibilityLabel="Freundesstatistiken werden geladen"
        style={[styles.stateCard, style]}
        variant="subtle">
        <ActivityIndicator color={theme.colors.primary} />
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          Freigegebene Statistiken werden geladen …
        </Text>
      </AppCard>
    );
  }

  if (state === 'error') {
    return (
      <AppCard style={[styles.stateCard, style]} variant="outlined">
        <Text
          accessibilityRole="alert"
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
          {errorMessage}
        </Text>
        {onRetry ? <AppButton label="Erneut versuchen" onPress={onRetry} variant="outline" /> : null}
      </AppCard>
    );
  }

  const byKey = new Map(periods.map((period) => [period.key, period]));
  const visiblePeriods = PERIOD_ORDER.flatMap((key) => {
    const period = byKey.get(key);
    return period ? [period] : [];
  });

  return (
    <View style={[styles.container, style]}>
      {(streakDays !== undefined || goalReached !== undefined) ? (
        <View style={styles.summaryRow}>
          <AppCard padding="sm" style={styles.summaryCard} variant="subtle">
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Lernserie
            </Text>
            <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
              {streakDays === null || streakDays === undefined
                ? 'Nicht freigegeben'
                : `${streakDays} ${streakDays === 1 ? 'Tag' : 'Tage'}`}
            </Text>
          </AppCard>
          <AppCard padding="sm" style={styles.summaryCard} variant="subtle">
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Persönliches Ziel
            </Text>
            <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
              {goalReached === null || goalReached === undefined
                ? 'Nicht freigegeben'
                : goalReached
                  ? 'Erreicht'
                  : 'Noch offen'}
            </Text>
          </AppCard>
        </View>
      ) : null}
      <View
        accessibilityLabel="Statistikzeiträume"
        style={styles.grid}
        testID="friend-stats-grid">
        {visiblePeriods.map((period) => (
          <PeriodCard key={period.key} period={period} tablet={tablet} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 16,
  },
  stateCard: {
    width: '100%',
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  summaryRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    minWidth: 180,
    flex: 1,
    gap: 3,
  },
  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 16,
  },
  periodCard: {
    minWidth: 0,
    gap: 14,
  },
  periodCardPhone: {
    flexBasis: '100%',
  },
  periodCardTablet: {
    flexBasis: '31%',
    flexGrow: 1,
  },
  metricLine: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metricLabel: {
    minWidth: 84,
    flexShrink: 0,
  },
  metricValue: {
    minWidth: 0,
    alignItems: 'flex-end',
    gap: 1,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
  },
});
