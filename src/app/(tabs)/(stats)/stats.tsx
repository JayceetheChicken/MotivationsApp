import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { SegmentedControl } from '@/components/segmented-control';
import { StudyLineChart } from '@/components/study-line-chart';
import { AppCard } from '@/components/ui/app-card';
import { MetricCard } from '@/components/ui/metric-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useCurrentDate } from '@/hooks/use-current-date';
import { buildChartSeries, type ChartPeriod } from '@/lib/chart-data';
import { formatMinutes } from '@/lib/format';
import { evaluateGoal } from '@/lib/goals';
import {
  calculateStreak,
  filterSessionsByPeriod,
  getPeriodStats,
  getSubjectBreakdown,
  startOfWeek,
  type DateRange,
} from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
  { value: 'year', label: 'Jahr' },
] as const;

const PERIOD_TITLES: Record<ChartPeriod, string> = {
  week: 'Diese Woche',
  month: 'Dieser Monat',
  year: 'Dieses Jahr',
};

function periodRange(period: ChartPeriod, date: Date): DateRange {
  if (period === 'week') {
    const start = startOfWeek(date);
    const endExclusive = new Date(start);
    endExclusive.setDate(endExclusive.getDate() + 7);
    return { start, endExclusive };
  }
  if (period === 'month') {
    return {
      start: new Date(date.getFullYear(), date.getMonth(), 1),
      endExclusive: new Date(date.getFullYear(), date.getMonth() + 1, 1),
    };
  }
  return {
    start: new Date(date.getFullYear(), 0, 1),
    endExclusive: new Date(date.getFullYear() + 1, 0, 1),
  };
}

function previousRange(period: ChartPeriod, current: DateRange): DateRange {
  if (period === 'week') {
    const start = new Date(current.start);
    start.setDate(start.getDate() - 7);
    const endExclusive = new Date(current.endExclusive);
    endExclusive.setDate(endExclusive.getDate() - 7);
    return { start, endExclusive };
  }
  if (period === 'month') {
    return {
      start: new Date(current.start.getFullYear(), current.start.getMonth() - 1, 1),
      endExclusive: new Date(current.start.getFullYear(), current.start.getMonth(), 1),
    };
  }
  return {
    start: new Date(current.start.getFullYear() - 1, 0, 1),
    endExclusive: new Date(current.start.getFullYear(), 0, 1),
  };
}

function comparisonCopy(current: number, previous: number): { value: string; detail: string; positive: boolean } {
  const difference = current - previous;
  if (current === 0 && previous === 0) {
    return { value: 'Noch kein Vergleich', detail: 'Im vorherigen Zeitraum gab es ebenfalls keine Lernzeit.', positive: false };
  }
  if (previous === 0) {
    return { value: `+${formatMinutes(current, true)}`, detail: 'Erste Aktivität im Vergleich zum vorherigen Zeitraum.', positive: true };
  }
  const percent = Math.round((difference / previous) * 100);
  return {
    value: `${percent > 0 ? '+' : ''}${percent} %`,
    detail: difference === 0
      ? 'Genau so viel wie im vorherigen Zeitraum.'
      : `${formatMinutes(Math.abs(difference), true)} ${difference > 0 ? 'mehr' : 'weniger'} als zuvor.`,
    positive: difference > 0,
  };
}

export default function StatsScreen() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data } = useStudyStore();
  const now = useCurrentDate();
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const range = useMemo(() => periodRange(period, now), [now, period]);
  const priorRange = useMemo(() => previousRange(period, range), [period, range]);
  const currentSessions = filterSessionsByPeriod(data.sessions, range.start, range.endExclusive);
  const priorSessions = filterSessionsByPeriod(data.sessions, priorRange.start, priorRange.endExclusive);
  const stats = getPeriodStats(currentSessions);
  const priorStats = getPeriodStats(priorSessions);
  const comparison = comparisonCopy(stats.totalMinutes, priorStats.totalMinutes);
  const chart = buildChartSeries(data.sessions, period, now);
  const subjects = getSubjectBreakdown(data.sessions, data.subjects, range);
  const streak = calculateStreak(data.sessions, now);
  const achievedGoals = data.goals.filter(
    (goal) => goal.status === 'completed' || (goal.status === 'active' && evaluateGoal(goal, data.sessions, now).achieved),
  ).length;
  const hasAnyData = data.sessions.length > 0;

  return (
    <Screen>
      <View style={styles.titleRow}>
        <SectionHeader
          description="Deine Zeit, Sessions und Entwicklung – ohne künstliche Beispielwerte."
          eyebrow="Persönlicher Fortschritt"
          title="Statistik"
        />
        <SegmentedControl
          accessibilityLabel="Zeitraum der Statistik"
          onChange={setPeriod}
          options={PERIOD_OPTIONS}
          style={styles.periodControl}
          value={period}
        />
      </View>

      {!hasAnyData ? (
        <EmptyState
          message="Starte eine Session oder trage Lernzeit nach. Danach werden Verlauf, Durchschnitt und Fächerverteilung aus deinen echten Daten berechnet."
          symbol="⌁"
          title="Deine Statistik entsteht mit der ersten Lernzeit"
        />
      ) : null}

      <View style={styles.metricGrid}>
        <MetricCard
          detail={PERIOD_TITLES[period]}
          label="Lernzeit"
          style={isTablet ? styles.metricTablet : styles.metricPhone}
          value={formatMinutes(stats.totalMinutes, true)}
        />
        <MetricCard
          detail={`${stats.timerSessionCount} Timer · ${stats.manualEntryCount} manuell`}
          label="Einträge"
          style={isTablet ? styles.metricTablet : styles.metricPhone}
          value={stats.timerSessionCount + stats.manualEntryCount}
        />
        <MetricCard
          detail="Automatisch gemessene Sessions"
          label="Ø Sessiondauer"
          style={isTablet ? styles.metricTablet : styles.metricPhone}
          value={stats.averageTimerSessionMinutes === null ? '–' : formatMinutes(stats.averageTimerSessionMinutes, true)}
        />
        <MetricCard
          detail={`${achievedGoals} erreichte ${achievedGoals === 1 ? 'Ziel' : 'Ziele'} · längste Serie ${streak.longestDays}`}
          label="Aktuelle Serie"
          style={isTablet ? styles.metricTablet : styles.metricPhone}
          value={`${streak.currentDays} ${streak.currentDays === 1 ? 'Tag' : 'Tage'}`}
        />
      </View>

      <View style={[styles.columns, isTablet ? styles.columnsTablet : undefined]}>
        <View style={styles.column}>
          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description={`Lernminuten · ${PERIOD_TITLES[period]}`}
              title="Lernverlauf"
            />
            <StudyLineChart
              dataPoints={chart.map((point) => point.valueMinutes)}
              detailLabels={chart.map((point) => point.dateLabel)}
              labels={chart.map((point) => point.label)}
            />
          </AppCard>

          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description="Automatisch gemessene und nachgetragene Zeit bleiben nachvollziehbar."
              title="Herkunft der Lernzeit"
            />
            <View style={styles.sourceList}>
              <View style={styles.sourceItem}>
                <View style={styles.sourceHeader}>
                  <SourceBadge source="timer" />
                  <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.accentTurquoise }]}>
                    {formatMinutes(stats.timerMinutes, true)}
                  </Text>
                </View>
                <ProgressBar max={Math.max(1, stats.totalMinutes)} value={stats.timerMinutes} />
              </View>
              <View style={styles.sourceItem}>
                <View style={styles.sourceHeader}>
                  <SourceBadge source="manual" />
                  <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.accentMustard }]}>
                    {formatMinutes(stats.manualMinutes, true)}
                  </Text>
                </View>
                <ProgressBar max={Math.max(1, stats.totalMinutes)} tone="warning" value={stats.manualMinutes} />
              </View>
            </View>
          </AppCard>
        </View>

        <View style={styles.column}>
          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description="Vergleich mit dem direkt vorherigen Zeitraum"
              title="Deine Entwicklung"
            />
            <Text
              selectable
              style={[
                theme.typography.heading,
                styles.numeric,
                { color: comparison.positive ? theme.colors.accentTurquoise : theme.colors.text },
              ]}>
              {comparison.value}
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              {comparison.detail}
            </Text>
            <View style={[styles.comparisonRows, { borderTopColor: theme.colors.divider }]}>
              <View style={styles.comparisonRow}>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>{PERIOD_TITLES[period]}</Text>
                <Text style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(stats.totalMinutes, true)}</Text>
              </View>
              <View style={styles.comparisonRow}>
                <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Vorher</Text>
                <Text style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(priorStats.totalMinutes, true)}</Text>
              </View>
            </View>
          </AppCard>

          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description={`Anteil an ${formatMinutes(stats.totalMinutes, true)}`}
              title="Lernzeit nach Fach"
            />
            {subjects.length === 0 ? (
              <EmptyState
                compact
                message="In diesem Zeitraum wurde noch keine Lernzeit erfasst."
                symbol="◫"
                title="Keine Fächerverteilung"
              />
            ) : (
              <View style={styles.subjectList}>
                {subjects.map((subject, index) => (
                  <View
                    key={subject.subjectId}
                    style={[
                      styles.subjectRow,
                      index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
                    ]}>
                    <View style={styles.subjectHeader}>
                      <View style={[styles.subjectDot, { backgroundColor: subject.subjectColor }]} />
                      <Text selectable style={[theme.typography.bodyMedium, styles.subjectName, { color: theme.colors.text }]}>
                        {subject.subjectName}
                      </Text>
                      <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>
                        {formatMinutes(subject.totalMinutes, true)}
                      </Text>
                    </View>
                    <ProgressBar max={100} value={subject.percentage} />
                    <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      {Math.round(subject.percentage)} % · {subject.timerSessionCount} Timer-{subject.timerSessionCount === 1 ? 'Session' : 'Sessions'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </AppCard>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18 },
  periodControl: { maxWidth: 380 },
  metricGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metricTablet: { flexBasis: '22%', flexGrow: 1 },
  metricPhone: { flexBasis: '46%', flexGrow: 1 },
  columns: { width: '100%', gap: 20 },
  columnsTablet: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0, gap: 20 },
  sectionCard: { width: '100%', gap: 20 },
  sourceList: { gap: 20 },
  sourceItem: { gap: 10 },
  sourceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  comparisonRows: { borderTopWidth: 1, paddingTop: 16, gap: 12 },
  comparisonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  subjectList: { width: '100%' },
  subjectRow: { paddingVertical: 14, gap: 10 },
  subjectHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  subjectName: { flex: 1, minWidth: 0 },
  numeric: { fontVariant: ['tabular-nums'] },
});
