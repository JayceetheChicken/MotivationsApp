import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { MetricCard, type MetricTrend } from '@/components/ui/metric-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import { formatClock, formatMinutes, formatRelativeDay } from '@/lib/format';
import {
  compareWithPreviousWeek,
  currentWeekRange,
  filterSessionsByPeriod,
  getCurrentStreak,
  getCurrentWeekDayBuckets,
  getDurationBreakdown,
  getTodayStats,
  getWeekStats,
} from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { StudyGoal, StudySession } from '@/types/study';

type GoalProgress = Readonly<{
  current: number;
  target: number;
  valueLabel: string;
  remainingLabel: string;
}>;

function getGreeting(date: Date): string {
  if (date.getHours() < 11) return 'Guten Morgen';
  if (date.getHours() < 18) return 'Hallo';
  return 'Guten Abend';
}

function getWeeklyGoalProgress(
  goal: StudyGoal,
  sessions: readonly StudySession[],
  referenceDate: Date,
): GoalProgress {
  const range = currentWeekRange(referenceDate);
  const matchingSessions = filterSessionsByPeriod(sessions, range.start, range.endExclusive).filter(
    (session) =>
      (goal.sourcePolicy === 'all' || session.source === 'timer') &&
      (!goal.subjectIds?.length || goal.subjectIds.includes(session.subjectId)),
  );

  if (goal.type === 'duration') {
    const current = getDurationBreakdown(matchingSessions).totalMinutes;
    const target = Math.max(1, goal.targetMinutes);
    const remaining = Math.max(0, target - current);
    return {
      current,
      target,
      valueLabel: `${formatMinutes(current, true)} / ${formatMinutes(target, true)}`,
      remainingLabel:
        remaining === 0
          ? 'Wochenziel erreicht – alles Weitere ist Bonus.'
          : `Noch ${formatMinutes(remaining, true)} bis zu deinem Wochenziel.`,
    };
  }

  const current = matchingSessions.filter(
    (session) => session.durationMinutes >= goal.minimumSessionMinutes,
  ).length;
  const target = Math.max(1, goal.targetSessions);
  const remaining = Math.max(0, target - current);
  return {
    current,
    target,
    valueLabel: `${current} / ${target} Sessions`,
    remainingLabel:
      remaining === 0
        ? 'Wochenziel erreicht – alles Weitere ist Bonus.'
        : `Noch ${remaining} ${remaining === 1 ? 'Session' : 'Sessions'} bis zu deinem Wochenziel.`,
  };
}

function getWeekTrend(
  comparison: ReturnType<typeof compareWithPreviousWeek>,
): MetricTrend {
  if (comparison.trend === 'new_activity') {
    return { label: 'Neu diese Woche', tone: 'positive' };
  }
  if (comparison.trend === 'same' || comparison.percentChange === null) {
    return { label: 'Wie letzte Woche', tone: 'neutral' };
  }

  const sign = comparison.percentChange > 0 ? '+' : '−';
  return {
    label: `${sign}${Math.abs(Math.round(comparison.percentChange))} % zur Vorwoche`,
    tone: comparison.percentChange > 0 ? 'positive' : 'neutral',
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data } = useStudyStore();
  const now = new Date();
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const elapsedSeconds = useTimerElapsed(data.activeTimer);

  const todayStats = getTodayStats(data.sessions, now);
  const weekStats = getWeekStats(data.sessions, now);
  const currentStreak = getCurrentStreak(data.sessions, now);
  const weekComparison = compareWithPreviousWeek(data.sessions, now);
  const dayBuckets = getCurrentWeekDayBuckets(data.sessions, now);
  const maxDayMinutes = Math.max(1, ...dayBuckets.map((bucket) => bucket.totalMinutes));
  const activeWeeklyGoal = data.goals.find(
    (goal) => goal.status === 'active' && goal.period === 'week',
  );
  const weeklyGoalProgress = activeWeeklyGoal
    ? getWeeklyGoalProgress(activeWeeklyGoal, data.sessions, now)
    : null;
  const activeSubject = data.activeTimer
    ? data.subjects.find((subject) => subject.id === data.activeTimer?.subjectId)
    : null;
  const subjectsById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const recentSessions = [...data.sessions]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 4);
  const firstName = data.currentUser.displayName.trim().split(/\s+/)[0] ?? '';

  return (
    <Screen>
      <View style={styles.greetingRow}>
        <View style={styles.greetingCopy}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.primary }]}>
            {getGreeting(now)}, {firstName}
          </Text>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.heading, { color: theme.colors.text }]}>
            Was möchtest du heute bewegen?
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Dein Tempo zählt. Ein guter Lernblock reicht als nächster Schritt.
          </Text>
        </View>
        <Avatar
          accessibilityLabel="Profil und Datenschutz öffnen"
          name={data.currentUser.displayName}
          onPress={() => router.push('/profile')}
          size="lg"
        />
      </View>

      <View style={[styles.grid, isTablet ? styles.gridTablet : undefined]}>
        <AppCard
          padding="lg"
          style={[styles.sessionCard, isTablet ? styles.sessionCardTablet : undefined]}
          variant="highlight">
          <View style={styles.sessionHeader}>
            <View style={[styles.liveDot, { backgroundColor: theme.colors.primary }]} />
            <Text style={[theme.typography.caption, { color: theme.colors.onPrimaryMuted }]}>
              {data.activeTimer
                ? data.activeTimer.status === 'running'
                  ? 'SESSION LÄUFT'
                  : 'SESSION PAUSIERT'
                : 'DEINE NÄCHSTE SESSION'}
            </Text>
          </View>
          <View style={styles.sessionCopy}>
            <Text
              selectable
              style={[theme.typography.heading, { color: theme.colors.onPrimaryMuted }]}>
              {data.activeTimer
                ? activeSubject?.name ?? 'Lern-Session'
                : 'Starte einen ruhigen Fokusblock'}
            </Text>
            {data.activeTimer ? (
              <Text
                accessibilityLabel={`${formatMinutes(elapsedSeconds / 60)} erfasst`}
                selectable
                style={[
                  theme.typography.display,
                  styles.timer,
                  { color: theme.colors.onPrimaryMuted },
                ]}>
                {formatClock(elapsedSeconds)}
              </Text>
            ) : (
              <Text
                selectable
                style={[theme.typography.body, { color: theme.colors.onPrimaryMuted }]}>
                Fach auswählen, Timer starten und die echte Lernzeit automatisch erfassen.
              </Text>
            )}
          </View>
          <View style={[styles.sessionActions, isTablet ? styles.sessionActionsTablet : undefined]}>
            <AppButton
              fullWidth={!isTablet}
              label={data.activeTimer ? 'Session fortsetzen' : 'Session starten'}
              onPress={() => router.push('/session')}
            />
            <AppButton
              fullWidth={!isTablet}
              label="Lernzeit nachtragen"
              onPress={() => router.push('/manual-entry')}
              variant="ghost"
            />
          </View>
        </AppCard>

        <AppCard
          padding="lg"
          style={[styles.goalCard, isTablet ? styles.goalCardTablet : undefined]}>
          <SectionHeader
            description="Fortschritt in der laufenden Woche"
            eyebrow="Wochenziel"
            title={activeWeeklyGoal?.title ?? 'Noch kein Wochenziel'}
          />
          {weeklyGoalProgress ? (
            <>
              <ProgressBar
                accessibilityLabel={`Fortschritt für ${activeWeeklyGoal?.title}`}
                formatValue={() => weeklyGoalProgress.valueLabel}
                max={weeklyGoalProgress.target}
                showValue
                size="lg"
                value={weeklyGoalProgress.current}
              />
              <Text
                selectable
                style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                {weeklyGoalProgress.remainingLabel}
              </Text>
            </>
          ) : (
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Lege im Ziele-Tab ein persönliches Wochenziel fest.
            </Text>
          )}
        </AppCard>
      </View>

      <View style={[styles.metrics, isTablet ? styles.metricsTablet : undefined]}>
        <MetricCard
          detail={`${todayStats.timerSessionCount} automatisch gemessene ${todayStats.timerSessionCount === 1 ? 'Session' : 'Sessions'}`}
          label="Heute"
          style={isTablet ? styles.metricTablet : undefined}
          value={formatMinutes(todayStats.totalMinutes, true)}
        />
        <MetricCard
          detail={`${formatMinutes(weekStats.timerMinutes, true)} mit Timer`}
          label="Diese Woche"
          style={isTablet ? styles.metricTablet : undefined}
          trend={getWeekTrend(weekComparison)}
          value={formatMinutes(weekStats.totalMinutes, true)}
        />
        <MetricCard
          detail="Tage in Folge gelernt"
          emphasized={currentStreak >= 3}
          label="Aktueller Streak"
          style={isTablet ? styles.metricTablet : undefined}
          value={`${currentStreak} ${currentStreak === 1 ? 'Tag' : 'Tage'}`}
        />
      </View>

      <View style={[styles.grid, isTablet ? styles.gridTablet : undefined]}>
        <AppCard
          padding="lg"
          style={[styles.chartCard, isTablet ? styles.chartCardTablet : undefined]}>
          <SectionHeader
            description="Deine Lernminuten von Montag bis Sonntag"
            title="Diese Woche"
          />
          <View style={styles.chart}>
            {dayBuckets.map((bucket) => {
              const barHeight = bucket.isFuture
                ? 0
                : bucket.totalMinutes === 0
                  ? 3
                  : Math.max(8, Math.round((bucket.totalMinutes / maxDayMinutes) * 104));
              const barColor = bucket.isToday
                ? theme.colors.primary
                : theme.colors.primaryMuted;

              return (
                <View
                  accessible
                  accessibilityLabel={`${bucket.label}: ${formatMinutes(bucket.totalMinutes)}`}
                  key={bucket.key}
                  style={styles.dayColumn}>
                  <View
                    style={[
                      styles.barTrack,
                      { backgroundColor: theme.colors.surfaceMuted },
                    ]}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight,
                          backgroundColor: barColor,
                          opacity: bucket.isFuture ? 0 : 1,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      theme.typography.caption,
                      { color: bucket.isToday ? theme.colors.primary : theme.colors.textMuted },
                    ]}>
                    {bucket.label}
                  </Text>
                  <Text
                    selectable
                    style={[
                      theme.typography.caption,
                      styles.dayValue,
                      { color: bucket.isFuture ? theme.colors.textSubtle : theme.colors.text },
                    ]}>
                    {bucket.isFuture ? '–' : `${Math.round(bucket.totalMinutes)}m`}
                  </Text>
                </View>
              );
            })}
          </View>
        </AppCard>

        <AppCard
          padding="lg"
          style={[styles.recentCard, isTablet ? styles.recentCardTablet : undefined]}>
          <SectionHeader
            description="Automatisch und manuell klar getrennt"
            title="Letzte Sessions"
          />
          <View style={styles.sessionList}>
            {recentSessions.map((session, index) => {
              const subject = subjectsById.get(session.subjectId);
              return (
                <View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    index > 0
                      ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 }
                      : undefined,
                  ]}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[
                      styles.subjectDot,
                      { backgroundColor: subject?.color ?? theme.colors.primary },
                    ]}
                  />
                  <View style={styles.sessionMeta}>
                    <Text
                      selectable
                      style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                      {subject?.name ?? 'Unbekanntes Fach'}
                    </Text>
                    <Text
                      selectable
                      style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      {formatRelativeDay(session.startedAt, now)}
                    </Text>
                  </View>
                  <View style={styles.sessionResult}>
                    <Text
                      selectable
                      style={[
                        theme.typography.bodyMedium,
                        styles.numeric,
                        { color: theme.colors.text },
                      ]}>
                      {formatMinutes(session.durationMinutes, true)}
                    </Text>
                    <SourceBadge compact source={session.source} />
                  </View>
                </View>
              );
            })}
          </View>
        </AppCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greetingRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  greetingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  grid: {
    width: '100%',
    gap: 20,
  },
  gridTablet: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  sessionCard: {
    width: '100%',
    gap: 20,
  },
  sessionCardTablet: {
    width: undefined,
    flex: 1.35,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sessionCopy: {
    gap: 8,
  },
  timer: {
    fontVariant: ['tabular-nums'],
  },
  sessionActions: {
    gap: 8,
  },
  sessionActionsTablet: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalCard: {
    width: '100%',
    gap: 20,
  },
  goalCardTablet: {
    width: undefined,
    flex: 0.85,
  },
  metrics: {
    width: '100%',
    gap: 16,
  },
  metricsTablet: {
    flexDirection: 'row',
  },
  metricTablet: {
    flex: 1,
  },
  chartCard: {
    width: '100%',
    gap: 24,
  },
  chartCardTablet: {
    width: undefined,
    flex: 1.1,
  },
  chart: {
    minHeight: 154,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  dayColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
  },
  barTrack: {
    width: '100%',
    maxWidth: 38,
    height: 108,
    borderRadius: 12,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 12,
  },
  dayValue: {
    fontVariant: ['tabular-nums'],
  },
  recentCard: {
    width: '100%',
    gap: 12,
  },
  recentCardTablet: {
    width: undefined,
    flex: 0.9,
  },
  sessionList: {
    width: '100%',
  },
  sessionRow: {
    minHeight: 72,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subjectDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sessionMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sessionResult: {
    alignItems: 'flex-end',
    gap: 5,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
