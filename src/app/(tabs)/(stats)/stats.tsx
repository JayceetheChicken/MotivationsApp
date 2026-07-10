import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { MetricCard } from '@/components/ui/metric-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import {
  calculateStreak,
  currentWeekRange,
  filterSessionsByPeriod,
  getCurrentWeekDayBuckets,
  getPeriodStats,
  getSubjectBreakdown,
  type DateRange,
  type DayBucket,
} from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

type Period = 'week' | 'month' | 'year';

const PERIODS: readonly { key: Period; label: string }[] = [
  { key: 'week', label: 'Woche' },
  { key: 'month', label: 'Monat' },
  { key: 'year', label: 'Jahr' },
];

const PERIOD_DETAIL: Readonly<Record<Period, string>> = {
  week: 'Diese Woche',
  month: 'Dieser Monat',
  year: 'Dieses Jahr',
};

const PERIOD_CONTEXT: Readonly<Record<Period, string>> = {
  week: 'diese Woche',
  month: 'diesen Monat',
  year: 'dieses Jahr',
};

const PREVIOUS_PERIOD_LABEL: Readonly<Record<Period, string>> = {
  week: 'Vorwoche',
  month: 'Vormonat',
  year: 'Vorjahr',
};

const PREVIOUS_PERIOD_COMPARISON: Readonly<Record<Period, string>> = {
  week: 'zur Vorwoche',
  month: 'zum Vormonat',
  year: 'zum Vorjahr',
};

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getPeriodRange(period: Period, referenceDate: Date): DateRange {
  if (period === 'week') return currentWeekRange(referenceDate);

  const year = referenceDate.getFullYear();
  if (period === 'month') {
    const month = referenceDate.getMonth();
    return {
      start: new Date(year, month, 1),
      endExclusive: new Date(year, month + 1, 1),
    };
  }

  return {
    start: new Date(year, 0, 1),
    endExclusive: new Date(year + 1, 0, 1),
  };
}

function sameTimeInPreviousMonth(date: Date): Date {
  const targetMonth = date.getMonth() - 1;
  const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(
    date.getFullYear(),
    targetMonth,
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

function sameTimeInPreviousYear(date: Date): Date {
  const targetYear = date.getFullYear() - 1;
  const lastDay = new Date(targetYear, date.getMonth() + 1, 0).getDate();
  return new Date(
    targetYear,
    date.getMonth(),
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

function getComparableRanges(
  period: Period,
  range: DateRange,
  referenceDate: Date,
): { current: DateRange; previous: DateRange } {
  const currentEnd = new Date(
    Math.min(referenceDate.getTime(), range.endExclusive.getTime()),
  );

  if (period === 'week') {
    return {
      current: { start: range.start, endExclusive: currentEnd },
      previous: {
        start: addCalendarDays(range.start, -7),
        endExclusive: addCalendarDays(currentEnd, -7),
      },
    };
  }

  if (period === 'month') {
    return {
      current: { start: range.start, endExclusive: currentEnd },
      previous: {
        start: new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1),
        endExclusive: sameTimeInPreviousMonth(currentEnd),
      },
    };
  }

  return {
    current: { start: range.start, endExclusive: currentEnd },
    previous: {
      start: new Date(range.start.getFullYear() - 1, 0, 1),
      endExclusive: sameTimeInPreviousYear(currentEnd),
    },
  };
}

function formatPeriodRange(period: Period, range: DateRange): string {
  if (period === 'year') return String(range.start.getFullYear());

  if (period === 'month') {
    return new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
    }).format(range.start);
  }

  const endInclusive = new Date(range.endExclusive.getTime() - 1);
  const dayMonth = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'short',
  });
  const startLabel = dayMonth.format(range.start);
  const endLabel = dayMonth.format(endInclusive);
  const yearLabel =
    range.start.getFullYear() === endInclusive.getFullYear()
      ? String(endInclusive.getFullYear())
      : `${range.start.getFullYear()}/${endInclusive.getFullYear()}`;
  return `${startLabel} – ${endLabel} ${yearLabel}`;
}

function formatChartValue(minutes: number): string {
  if (minutes < 60) return String(Math.round(minutes));
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(minutes / 60)} h`;
}

function formatSignedMinutes(minutes: number): string {
  if (minutes === 0) return '± 0 Min.';
  return `${minutes > 0 ? '+' : '−'} ${formatMinutes(Math.abs(minutes), true)}`;
}

function getComparisonCopy(currentMinutes: number, previousMinutes: number): {
  detail: string;
  percentage: string;
  tone: 'positive' | 'negative' | 'neutral';
} {
  const difference = currentMinutes - previousMinutes;

  if (difference === 0) {
    return {
      detail: 'Genau so viel wie im Vergleichszeitraum.',
      percentage: 'Unverändert',
      tone: 'neutral',
    };
  }

  if (previousMinutes === 0) {
    return {
      detail: 'Im Vergleichszeitraum gab es noch keine Lernzeit.',
      percentage: 'Neu aktiv',
      tone: 'positive',
    };
  }

  const percentage = Math.round((difference / previousMinutes) * 100);
  return {
    detail: `${formatMinutes(Math.abs(difference))} ${difference > 0 ? 'mehr' : 'weniger'} als zuvor.`,
    percentage: `${percentage > 0 ? '+' : '−'} ${Math.abs(percentage)} %`,
    tone: difference > 0 ? 'positive' : 'negative',
  };
}

function WeekChart({ buckets }: { buckets: readonly DayBucket[] }) {
  const theme = useAppTheme();
  const maximumMinutes = Math.max(1, ...buckets.map((bucket) => bucket.totalMinutes));
  const summary = buckets
    .map((bucket) =>
      bucket.isFuture
        ? `${bucket.label}: noch offen`
        : `${bucket.label}: ${formatMinutes(bucket.totalMinutes)}`,
    )
    .join('; ');

  return (
    <AppCard padding="lg" style={styles.sectionCard}>
      <SectionHeader
        description="Automatisch gemessene und manuell ergänzte Zeit"
        eyebrow="Montag bis Sonntag"
        title="Deine Lernwoche"
      />

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.chartPlot}>
        {buckets.map((bucket) => {
          const barHeight =
            bucket.totalMinutes === 0
              ? 3
              : Math.max(8, (bucket.totalMinutes / maximumMinutes) * 112);
          const timerFlex = bucket.totalMinutes > 0 ? bucket.timerMinutes : 1;
          const manualFlex = bucket.totalMinutes > 0 ? bucket.manualMinutes : 0;

          return (
            <View key={bucket.key} style={styles.chartDay}>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                numberOfLines={1}
                style={[
                  theme.typography.caption,
                  styles.chartValue,
                  { color: bucket.isFuture ? theme.colors.textSubtle : theme.colors.textMuted },
                ]}>
                {bucket.isFuture ? '–' : formatChartValue(bucket.totalMinutes)}
              </Text>
              <View style={[styles.barTrack, { backgroundColor: theme.colors.track }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: barHeight,
                      backgroundColor:
                        bucket.totalMinutes === 0 ? theme.colors.track : theme.colors.primary,
                    },
                  ]}>
                  {manualFlex > 0 ? (
                    <View
                      style={{
                        flex: manualFlex,
                        minHeight: 4,
                        backgroundColor: theme.colors.warning,
                      }}
                    />
                  ) : null}
                  {timerFlex > 0 && bucket.totalMinutes > 0 ? (
                    <View
                      style={{
                        flex: timerFlex,
                        minHeight: 4,
                        backgroundColor: theme.colors.primary,
                      }}
                    />
                  ) : null}
                </View>
              </View>
              <Text
                style={[
                  theme.typography.caption,
                  {
                    color: bucket.isToday ? theme.colors.primary : theme.colors.textMuted,
                    fontWeight: bucket.isToday ? '700' : '600',
                  },
                ]}>
                {bucket.label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.chartDivider, { backgroundColor: theme.colors.divider }]} />
      <Text
        accessibilityLabel={`Textzusammenfassung des Wochenbalkendiagramms. ${summary}`}
        selectable
        style={[theme.typography.caption, styles.chartSummary, { color: theme.colors.textMuted }]}>
        Wochenwerte: {summary}
      </Text>
    </AppCard>
  );
}

export default function StatsRoute() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data, hydrated } = useStudyStore();
  const [period, setPeriod] = useState<Period>('week');
  const [referenceDate] = useState(() => new Date());
  const isTablet = width >= theme.layout.phoneBreakpoint;
  const hasFourMetricColumns = width >= theme.layout.tabletBreakpoint;
  const isVeryNarrow = width < 350;

  const range = useMemo(
    () => getPeriodRange(period, referenceDate),
    [period, referenceDate],
  );
  const selectedSessions = useMemo(
    () => filterSessionsByPeriod(data.sessions, range.start, range.endExclusive),
    [data.sessions, range],
  );
  const periodStats = useMemo(() => getPeriodStats(selectedSessions), [selectedSessions]);
  const streak = useMemo(
    () => calculateStreak(data.sessions, referenceDate),
    [data.sessions, referenceDate],
  );
  const weekBuckets = useMemo(
    () => getCurrentWeekDayBuckets(data.sessions, referenceDate),
    [data.sessions, referenceDate],
  );
  const subjects = useMemo(
    () => getSubjectBreakdown(data.sessions, data.subjects, range),
    [data.sessions, data.subjects, range],
  );
  const comparableRanges = useMemo(
    () => getComparableRanges(period, range, referenceDate),
    [period, range, referenceDate],
  );
  const currentComparableStats = getPeriodStats(
    filterSessionsByPeriod(
      data.sessions,
      comparableRanges.current.start,
      comparableRanges.current.endExclusive,
    ),
  );
  const previousComparableStats = getPeriodStats(
    filterSessionsByPeriod(
      data.sessions,
      comparableRanges.previous.start,
      comparableRanges.previous.endExclusive,
    ),
  );

  if (!hydrated) {
    return (
      <Screen centered>
        <AppCard accessible accessibilityLabel="Statistik wird geladen" padding="lg">
          <Text
            accessibilityLiveRegion="polite"
            style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            Statistik wird vorbereitet …
          </Text>
        </AppCard>
      </Screen>
    );
  }

  const rangeLabel = formatPeriodRange(period, range);
  const comparisonDifference =
    currentComparableStats.totalMinutes - previousComparableStats.totalMinutes;
  const comparison = getComparisonCopy(
    currentComparableStats.totalMinutes,
    previousComparableStats.totalMinutes,
  );
  const trendForeground = {
    positive: theme.colors.success,
    negative: theme.colors.danger,
    neutral: theme.colors.textMuted,
  }[comparison.tone];
  const trendBackground = {
    positive: theme.colors.successMuted,
    negative: theme.colors.dangerMuted,
    neutral: theme.colors.surfaceMuted,
  }[comparison.tone];
  const sourceMaximum = Math.max(1, periodStats.totalMinutes);
  const longestStreakDetail = `Längste Serie: ${streak.longestDays} ${
    streak.longestDays === 1 ? 'Tag' : 'Tage'
  }`;

  return (
    <Screen>
      <View style={styles.periodHeader}>
        <View style={styles.periodCopy}>
          <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {PERIOD_DETAIL[period]}
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {rangeLabel}
          </Text>
        </View>

        <View
          accessibilityLabel="Zeitraum der Statistik"
          style={[
            styles.segmentedControl,
            {
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
            },
          ]}>
          {PERIODS.map((option) => {
            const isSelected = period === option.key;
            return (
              <Pressable
                accessibilityHint={`Zeigt die Statistik für ${option.label.toLowerCase()} an`}
                accessibilityLabel={option.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                key={option.key}
                onPress={() => setPeriod(option.key)}
                style={({ pressed }) => [
                  styles.segment,
                  {
                    borderRadius: theme.radii.sm,
                    backgroundColor: isSelected
                      ? theme.colors.surfaceElevated
                      : pressed
                        ? theme.colors.surfacePressed
                        : 'transparent',
                    borderColor: isSelected ? theme.colors.borderStrong : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.label,
                    { color: isSelected ? theme.colors.primary : theme.colors.textMuted },
                  ]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard
          accessibilityLabel={`Gesamtzeit ${PERIOD_CONTEXT[period]}: ${formatMinutes(periodStats.totalMinutes)}`}
          detail={rangeLabel}
          emphasized
          label="Gesamtzeit"
          style={[
            styles.metricCard,
            hasFourMetricColumns
              ? styles.metricCardTablet
              : isVeryNarrow
                ? styles.metricCardNarrow
                : styles.metricCardPhone,
          ]}
          value={formatMinutes(periodStats.totalMinutes, true)}
        />
        <MetricCard
          detail="automatisch gemessen"
          label="Sessions"
          style={[
            styles.metricCard,
            hasFourMetricColumns
              ? styles.metricCardTablet
              : isVeryNarrow
                ? styles.metricCardNarrow
                : styles.metricCardPhone,
          ]}
          value={periodStats.timerSessionCount}
        />
        <MetricCard
          detail="pro Timer-Session"
          label="Durchschnitt"
          style={[
            styles.metricCard,
            hasFourMetricColumns
              ? styles.metricCardTablet
              : isVeryNarrow
                ? styles.metricCardNarrow
                : styles.metricCardPhone,
          ]}
          value={
            periodStats.averageTimerSessionMinutes === null
              ? '–'
              : formatMinutes(periodStats.averageTimerSessionMinutes, true)
          }
        />
        <MetricCard
          detail={longestStreakDetail}
          label="Aktueller Streak"
          style={[
            styles.metricCard,
            hasFourMetricColumns
              ? styles.metricCardTablet
              : isVeryNarrow
                ? styles.metricCardNarrow
                : styles.metricCardPhone,
          ]}
          value={`${streak.currentDays} ${streak.currentDays === 1 ? 'Tag' : 'Tage'}`}
        />
      </View>

      <View style={[styles.contentColumns, isTablet ? styles.contentColumnsTablet : undefined]}>
        <View style={styles.contentColumn}>
          <WeekChart buckets={weekBuckets} />

          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description={`Transparente Aufteilung für ${PERIOD_CONTEXT[period]}`}
              title="So wurde deine Zeit erfasst"
            />

            <View style={styles.sourceList}>
              <View style={styles.sourceItem}>
                <View style={styles.sourceHeader}>
                  <SourceBadge compact source="timer" />
                  <Text
                    selectable
                    style={[
                      theme.typography.bodyMedium,
                      styles.numeric,
                      { color: theme.colors.text },
                    ]}>
                    {formatMinutes(periodStats.timerMinutes, true)}
                  </Text>
                </View>
                <ProgressBar
                  accessibilityLabel="Anteil der automatisch gemessenen Lernzeit"
                  formatValue={(percentage) => `${percentage} Prozent automatisch gemessen`}
                  max={sourceMaximum}
                  size="sm"
                  value={periodStats.timerMinutes}
                />
              </View>

              <View style={styles.sourceItem}>
                <View style={styles.sourceHeader}>
                  <SourceBadge compact source="manual" />
                  <Text
                    selectable
                    style={[
                      theme.typography.bodyMedium,
                      styles.numeric,
                      { color: theme.colors.text },
                    ]}>
                    {formatMinutes(periodStats.manualMinutes, true)}
                  </Text>
                </View>
                <ProgressBar
                  accessibilityLabel="Anteil der manuell eingetragenen Lernzeit"
                  formatValue={(percentage) => `${percentage} Prozent manuell eingetragen`}
                  max={sourceMaximum}
                  size="sm"
                  tone="warning"
                  value={periodStats.manualMinutes}
                />
              </View>
            </View>
          </AppCard>
        </View>

        <View style={styles.contentColumn}>
          <AppCard
            accessible
            accessibilityLabel={`Vergleich ${PREVIOUS_PERIOD_COMPARISON[period]}. ${formatSignedMinutes(comparisonDifference)}. ${comparison.detail}`}
            padding="lg"
            style={styles.sectionCard}>
            <SectionHeader
              description="Jeweils bis zum gleichen Zeitpunkt"
              title={`Vergleich ${PREVIOUS_PERIOD_COMPARISON[period]}`}
            />

            <View style={styles.comparisonHero}>
              <View style={styles.comparisonValueGroup}>
                <Text
                  selectable
                  style={[
                    theme.typography.display,
                    styles.numeric,
                    { color: theme.colors.text },
                  ]}>
                  {formatSignedMinutes(comparisonDifference)}
                </Text>
                <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                  {comparison.detail}
                </Text>
              </View>
              <View
                style={[
                  styles.trendPill,
                  { backgroundColor: trendBackground, borderRadius: theme.radii.pill },
                ]}>
                <Text selectable style={[theme.typography.caption, { color: trendForeground }]}>
                  {comparison.percentage}
                </Text>
              </View>
            </View>

            <View style={[styles.comparisonRows, { borderTopColor: theme.colors.divider }]}>
              <View style={styles.comparisonRow}>
                <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
                  {PERIOD_DETAIL[period]}
                </Text>
                <Text
                  selectable
                  style={[
                    theme.typography.bodyMedium,
                    styles.numeric,
                    { color: theme.colors.text },
                  ]}>
                  {formatMinutes(currentComparableStats.totalMinutes, true)}
                </Text>
              </View>
              <View style={styles.comparisonRow}>
                <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
                  {PREVIOUS_PERIOD_LABEL[period]}
                </Text>
                <Text
                  selectable
                  style={[
                    theme.typography.bodyMedium,
                    styles.numeric,
                    { color: theme.colors.text },
                  ]}>
                  {formatMinutes(previousComparableStats.totalMinutes, true)}
                </Text>
              </View>
            </View>
          </AppCard>

          <AppCard padding="lg" style={styles.sectionCard}>
            <SectionHeader
              description={`Anteil an deiner Gesamtzeit · ${rangeLabel}`}
              title="Lernzeit nach Fach"
            />

            {subjects.length === 0 ? (
              <View
                accessible
                accessibilityLabel="Für diesen Zeitraum gibt es noch keine Lernzeit nach Fach"
                style={[
                  styles.emptyState,
                  {
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}>
                <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                  Noch keine Lernzeit
                </Text>
                <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                  Sobald du eine Session abschließt, erscheint hier deine Verteilung.
                </Text>
              </View>
            ) : (
              <View style={styles.subjectList}>
                {subjects.map((subject, index) => (
                  <View
                    accessibilityLabel={`${subject.subjectName}: ${formatMinutes(subject.totalMinutes)}, ${Math.round(subject.percentage)} Prozent. Davon ${formatMinutes(subject.timerMinutes)} automatisch und ${formatMinutes(subject.manualMinutes)} manuell.`}
                    accessible
                    key={subject.subjectId}
                    style={[
                      styles.subjectItem,
                      index > 0
                        ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 }
                        : undefined,
                    ]}>
                    <View
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={styles.subjectContent}>
                      <View style={styles.subjectHeader}>
                        <View style={styles.subjectNameGroup}>
                          <View
                            style={[
                              styles.subjectDot,
                              { backgroundColor: subject.subjectColor },
                            ]}
                          />
                          <Text
                            numberOfLines={2}
                            selectable
                            style={[
                              theme.typography.bodyMedium,
                              styles.subjectName,
                              { color: theme.colors.text },
                            ]}>
                            {subject.subjectName}
                          </Text>
                        </View>
                        <Text
                          selectable
                          style={[
                            theme.typography.bodyMedium,
                            styles.numeric,
                            { color: theme.colors.text },
                          ]}>
                          {formatMinutes(subject.totalMinutes, true)}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.subjectTrack,
                          {
                            backgroundColor: theme.colors.track,
                            borderRadius: theme.radii.pill,
                          },
                        ]}>
                        <View
                          style={[
                            styles.subjectFill,
                            {
                              width: `${Math.min(100, Math.max(0, subject.percentage))}%`,
                              backgroundColor: subject.subjectColor,
                              borderRadius: theme.radii.pill,
                            },
                          ]}
                        />
                      </View>

                      <View style={styles.subjectMeta}>
                        <Text
                          selectable
                          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                          {Math.round(subject.percentage)} % Anteil
                        </Text>
                        <Text
                          selectable
                          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                          {subject.timerSessionCount}{' '}
                          {subject.timerSessionCount === 1 ? 'Timer-Session' : 'Timer-Sessions'}
                        </Text>
                      </View>
                    </View>
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
  periodHeader: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  periodCopy: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 180,
    gap: 2,
  },
  segmentedControl: {
    minWidth: 278,
    minHeight: 52,
    flexGrow: 1,
    flexBasis: 320,
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segment: {
    minWidth: 72,
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  metricGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    flexGrow: 1,
  },
  metricCardTablet: {
    flexBasis: '22%',
  },
  metricCardPhone: {
    flexBasis: '46%',
  },
  metricCardNarrow: {
    flexBasis: '100%',
  },
  contentColumns: {
    width: '100%',
    gap: 24,
  },
  contentColumnsTablet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  contentColumn: {
    minWidth: 0,
    flex: 1,
    gap: 24,
  },
  sectionCard: {
    width: '100%',
    gap: 24,
  },
  chartPlot: {
    height: 164,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  chartDay: {
    minWidth: 0,
    flex: 1,
    alignItems: 'center',
    gap: 7,
  },
  chartValue: {
    width: '100%',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    width: '72%',
    minWidth: 12,
    maxWidth: 34,
    height: 112,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 8,
  },
  barFill: {
    width: '100%',
    minHeight: 3,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderRadius: 8,
  },
  chartDivider: {
    width: '100%',
    height: 1,
  },
  chartSummary: {
    lineHeight: 19,
  },
  sourceList: {
    gap: 20,
  },
  sourceItem: {
    gap: 10,
  },
  sourceHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  comparisonHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  comparisonValueGroup: {
    minWidth: 0,
    flex: 1,
    gap: 6,
  },
  trendPill: {
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  comparisonRows: {
    borderTopWidth: 1,
    paddingTop: 16,
    gap: 12,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  subjectList: {
    gap: 0,
  },
  subjectItem: {
    paddingVertical: 18,
  },
  subjectContent: {
    gap: 10,
  },
  subjectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  subjectNameGroup: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subjectDot: {
    width: 10,
    height: 10,
    flexShrink: 0,
    borderRadius: 5,
  },
  subjectName: {
    flex: 1,
  },
  subjectTrack: {
    width: '100%',
    height: 8,
    overflow: 'hidden',
  },
  subjectFill: {
    height: '100%',
    minWidth: 3,
  },
  subjectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyState: {
    padding: 20,
    gap: 6,
  },
});
