import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { StudyLineChart } from '@/components/study-line-chart';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { MetricCard, type MetricTrend } from '@/components/ui/metric-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import { buildWeekChart } from '@/lib/chart-data';
import { formatClock, formatMinutes, formatRelativeDay } from '@/lib/format';
import { evaluateGoal, getGoalTitle } from '@/lib/goals';
import {
  compareWithPreviousWeek,
  calculateStreak,
  getTodayStats,
  getWeekStats,
} from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

function greetingFor(date: Date): string {
  if (date.getHours() < 11) return 'Guten Morgen';
  if (date.getHours() < 18) return 'Hallo';
  return 'Guten Abend';
}

function weekTrend(
  comparison: ReturnType<typeof compareWithPreviousWeek>,
): MetricTrend | undefined {
  if (comparison.currentMinutes === 0 && comparison.previousMinutes === 0) return undefined;
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
  const now = useCurrentDate();
  const elapsedSeconds = useTimerElapsed(data.activeTimer);
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const user = data.currentUser;
  const today = getTodayStats(data.sessions, now);
  const week = getWeekStats(data.sessions, now);
  const streak = calculateStreak(data.sessions, now);
  const comparison = compareWithPreviousWeek(data.sessions, now);
  const activeGoal = data.goals.find((goal) => goal.status === 'active');
  const goalProgress = activeGoal ? evaluateGoal(activeGoal, data.sessions, now) : null;
  const weekChart = buildWeekChart(data.sessions, now);
  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const activeSubject = data.activeTimer
    ? subjectById.get(data.activeTimer.subjectId)
    : undefined;
  const recentSessions = [...data.sessions]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 4);
  const firstName = user?.displayName.trim().split(/\s+/)[0] || 'du';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.primary }]}>
            {greetingFor(now)}, {firstName}
          </Text>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.title, { color: theme.colors.text }]}>
            Dein Lernfortschritt
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Kleine, regelmäßige Schritte machen deinen Fortschritt sichtbar.
          </Text>
        </View>
        {user ? (
          <Avatar
            accessibilityLabel="Profil und Datenschutz öffnen"
            name={user.displayName}
            onPress={() => router.push('/profile')}
            size="lg"
          />
        ) : null}
      </View>

      <AppCard padding="lg" style={styles.weekHero} variant="highlight">
        <View style={styles.weekHeroHeader}>
          <View style={styles.weekHeroCopy}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.onPrimaryMuted }]}>
              DIESE WOCHE
            </Text>
            <Text
              accessibilityLabel={`${formatMinutes(week.totalMinutes)} Lernzeit in dieser Woche`}
              selectable
              style={[theme.typography.display, styles.numeric, { color: theme.colors.onPrimaryMuted }]}>
              {formatMinutes(week.totalMinutes, true)}
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.onPrimaryMuted }]}>
              {week.timerMinutes > 0 || week.manualMinutes > 0
                ? `${formatMinutes(week.timerMinutes, true)} mit Timer · ${formatMinutes(week.manualMinutes, true)} manuell`
                : 'Deine erste Session setzt hier den Anfang.'}
            </Text>
          </View>
          <View style={[styles.weekBadge, { backgroundColor: theme.colors.surface }]}>
            <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
              {week.timerSessionCount} {week.timerSessionCount === 1 ? 'Session' : 'Sessions'}
            </Text>
          </View>
        </View>
      </AppCard>

      <View style={[styles.metrics, isTablet ? styles.row : undefined]}>
        <MetricCard
          detail={`${today.timerSessionCount + today.manualEntryCount} ${today.timerSessionCount + today.manualEntryCount === 1 ? 'Eintrag' : 'Einträge'} heute`}
          label="Heute"
          style={isTablet ? styles.flex : undefined}
          value={formatMinutes(today.totalMinutes, true)}
        />
        <MetricCard
          detail={`${formatMinutes(week.timerMinutes, true)} automatisch gemessen`}
          label="Diese Woche"
          style={isTablet ? styles.flex : undefined}
          trend={weekTrend(comparison)}
          value={formatMinutes(week.totalMinutes, true)}
        />
        <MetricCard
          detail={streak.currentDays === 0 ? 'Beginnt mit deinem ersten Lerntag' : `Längste Serie: ${streak.longestDays} ${streak.longestDays === 1 ? 'Tag' : 'Tage'}`}
          emphasized={streak.currentDays >= 3}
          label="Aktuelle Serie"
          style={isTablet ? styles.flex : undefined}
          value={`${streak.currentDays} ${streak.currentDays === 1 ? 'Tag' : 'Tage'}`}
        />
      </View>

      <View style={[styles.columns, isTablet ? styles.row : undefined]}>
        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.primaryColumn : undefined]}>
          <SectionHeader
            description={data.activeTimer ? 'Deine Zeit wird zuverlässig weitergezählt.' : 'Fach wählen und echte Lernzeit erfassen.'}
            eyebrow={data.activeTimer ? (data.activeTimer.status === 'running' ? 'Läuft gerade' : 'Pausiert') : 'Nächster Schritt'}
            title={data.activeTimer ? activeSubject?.name ?? 'Lern-Session' : 'Session starten'}
          />
          {data.activeTimer ? (
            <Text
              accessibilityLabel={`${formatMinutes(elapsedSeconds / 60)} erfasst`}
              selectable
              style={[theme.typography.display, styles.numeric, { color: theme.colors.primary }]}>
              {formatClock(elapsedSeconds)}
            </Text>
          ) : null}
          <View style={[styles.actions, isTablet ? styles.row : undefined]}>
            <AppButton
              fullWidth={!isTablet}
              label={data.activeTimer ? 'Session fortsetzen' : 'Session starten'}
              onPress={() => router.push('/session')}
              size="large"
              style={isTablet ? styles.flex : undefined}
            />
            <AppButton
              fullWidth={!isTablet}
              label="Zeit nachtragen"
              onPress={() => router.push('/manual-entry')}
              size="large"
              style={isTablet ? styles.flex : undefined}
              variant="outline"
            />
          </View>
        </AppCard>

        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.secondaryColumn : undefined]}>
          <SectionHeader
            description="Fortschritt im aktuellen Zeitraum"
            eyebrow="Aktives Ziel"
            title={activeGoal ? getGoalTitle(activeGoal, data.subjects) : 'Noch kein Lernziel'}
          />
          {activeGoal && goalProgress ? (
            <>
              <ProgressBar
                accessibilityLabel={`Fortschritt für ${getGoalTitle(activeGoal, data.subjects)}`}
                formatValue={() => `${Math.round(goalProgress.progressPercent)} %`}
                max={Math.max(1, goalProgress.target)}
                showValue
                size="lg"
                tone={goalProgress.achieved ? 'success' : 'primary'}
                value={goalProgress.current}
              />
              <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                {activeGoal.type === 'duration'
                  ? `${formatMinutes(goalProgress.current, true)} von ${formatMinutes(goalProgress.target, true)}`
                  : `${goalProgress.current} von ${goalProgress.target} Sessions`}
              </Text>
            </>
          ) : (
            <EmptyState
              actionLabel="Erstes Ziel setzen"
              compact
              message="Ein realistisches Wochen-, Monats- oder Jahresziel gibt deinem Lernen Richtung."
              onActionPress={() => router.push('/create-goal')}
              symbol="◎"
              title="Starte mit deinem Ziel"
            />
          )}
        </AppCard>
      </View>

      <View style={[styles.columns, isTablet ? styles.row : undefined]}>
        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.primaryColumn : undefined]}>
          <SectionHeader
            description="Lernminuten von Montag bis Sonntag"
            title="Wochenverlauf"
          />
          <StudyLineChart
            dataPoints={weekChart.map((point) => point.valueMinutes)}
            detailLabels={weekChart.map((point) => point.dateLabel)}
            labels={weekChart.map((point) => point.label)}
          />
        </AppCard>

        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.secondaryColumn : undefined]}>
          <SectionHeader
            description="Automatisch und manuell klar unterschieden"
            title="Letzte Aktivitäten"
          />
          {recentSessions.length === 0 ? (
            <EmptyState
              compact
              message="Abgeschlossene Sessions und nachgetragene Lernzeit erscheinen hier."
              symbol="◷"
              title="Noch keine Aktivitäten"
            />
          ) : (
            <View style={styles.sessionList}>
              {recentSessions.map((session, index) => {
                const subject = subjectById.get(session.subjectId);
                return (
                  <View
                    key={session.id}
                    style={[
                      styles.sessionRow,
                      index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
                    ]}>
                    <View style={[styles.subjectDot, { backgroundColor: subject?.color ?? theme.colors.textSubtle }]} />
                    <View style={styles.sessionCopy}>
                      <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                        {subject?.name ?? 'Lernzeit'}
                      </Text>
                      <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                        {formatRelativeDay(session.startedAt, now)}
                      </Text>
                    </View>
                    <View style={styles.sessionValue}>
                      <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>
                        {formatMinutes(session.durationMinutes, true)}
                      </Text>
                      <SourceBadge compact source={session.source} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </AppCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  weekHero: { width: '100%', gap: 16 },
  weekHeroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
  },
  weekHeroCopy: { flex: 1, minWidth: 220, gap: 6 },
  weekBadge: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999 },
  metrics: { width: '100%', gap: 14 },
  columns: { width: '100%', gap: 20 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  flex: { flex: 1 },
  primaryColumn: { flex: 1.2 },
  secondaryColumn: { flex: 0.8 },
  sectionCard: { width: '100%', gap: 20 },
  actions: { width: '100%', gap: 10 },
  numeric: { fontVariant: ['tabular-nums'] },
  sessionList: { width: '100%' },
  sessionRow: { minHeight: 70, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  sessionCopy: { flex: 1, minWidth: 0, gap: 2 },
  sessionValue: { alignItems: 'flex-end', gap: 5 },
});
