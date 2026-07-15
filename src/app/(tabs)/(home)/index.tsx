import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActivityHeatmap } from '@/components/activity-heatmap';
import { EmptyState } from '@/components/empty-state';
import { HomeGoalCard } from '@/components/home-goal-card';
import { StudyLineChart } from '@/components/study-line-chart';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { MetricCard, type MetricTrend } from '@/components/ui/metric-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import { calculateActivitySummary } from '@/lib/activity';
import { buildWeekChart } from '@/lib/chart-data';
import { formatClock, formatMinutes, formatRelativeDay } from '@/lib/format';
import { evaluateGoal } from '@/lib/goals';
import { compareWithPreviousWeek, calculateStreak } from '@/lib/stats';
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

function SummaryMetric({ label, value }: { label: string; value: number }) {
  const theme = useAppTheme();
  return (
    <View style={styles.summaryMetric}>
      <Text style={[theme.typography.caption, styles.summaryLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        accessibilityLabel={`${label}: ${formatMinutes(value)}`}
        selectable
        style={[theme.typography.subheading, styles.numeric, { color: theme.colors.text }]}>
        {formatMinutes(value, true)}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data, deleteSession } = useStudyStore();
  const [sessionPendingDelete, setSessionPendingDelete] = useState<string | null>(null);
  const now = useCurrentDate();
  const elapsedSeconds = useTimerElapsed(data.activeTimer);
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const user = data.currentUser;
  const userId = user?.id ?? '';
  const activitySummary = calculateActivitySummary(data.sessions, {
    userId,
    referenceDate: now,
  });
  const streak = calculateStreak(data.sessions, now);
  const comparison = compareWithPreviousWeek(data.sessions, now);
  const activeGoals = data.goals.filter((goal) => goal.status === 'active' && goal.userId === userId);
  const weekChart = buildWeekChart(data.sessions, now);
  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const activeSubject = data.activeTimer
    ? subjectById.get(data.activeTimer.subjectId)
    : undefined;
  const recentSessions = [...data.sessions]
    .filter((session) => session.userId === userId && (!session.status || session.status === 'completed'))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 4);
  const firstName = user?.displayName.trim().split(/\s+/)[0] || 'du';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.primaryText }]}>
            {greetingFor(now)}, {firstName}
          </Text>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.title, { color: theme.colors.text }]}>
            Dein Lernfortschritt
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

      <AppCard
        accessibilityLabel="Lernzeitübersicht"
        padding="lg"
        style={[styles.summaryCard, { borderTopColor: theme.colors.primary }]}
        variant="highlight">
        <View style={styles.summaryHeader}>
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Deine Lernzeit</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Kalendertage in deiner lokalen Zeitzone</Text>
        </View>
        <View style={[styles.summaryMetrics, !isTablet ? styles.summaryMetricsPhone : undefined]}>
          <SummaryMetric label="Heute" value={activitySummary.todayMinutes} />
          <View style={[styles.summaryDivider, !isTablet ? styles.summaryDividerPhone : undefined, { backgroundColor: theme.colors.divider }]} />
          <SummaryMetric label="Letzte 7 Tage" value={activitySummary.lastSevenDaysMinutes} />
          <View style={[styles.summaryDivider, !isTablet ? styles.summaryDividerPhone : undefined, { backgroundColor: theme.colors.divider }]} />
          <SummaryMetric label="Dieser Monat" value={activitySummary.currentMonthMinutes} />
        </View>
      </AppCard>

      <AppCard padding="lg" style={styles.sectionCard}>
        <SectionHeader
          description="Die letzten 12 Monate bis heute · Wähle einen Tag für Details"
          eyebrow="Aktivitätskalender"
          title="Wann du gelernt hast"
        />
        <ActivityHeatmap
          goals={data.goals}
          referenceDate={now}
          sessions={data.sessions}
          subjects={data.subjects}
          userId={userId}
        />
      </AppCard>

      <View style={styles.goalSection}>
        <SectionHeader
          description="Jede Session zählt nur für das Lernziel, mit dem sie gestartet wurde."
          eyebrow="Dein nächster Schritt"
          title="Aktive Lernziele"
        />
        {activeGoals.length === 0 ? (
          <EmptyState
            compact
            message="Ein realistisches Tages-, Wochen-, Monats- oder Zeitraumziel gibt deinem Lernen Richtung."
            symbol="◎"
            title="Noch kein aktives Lernziel"
          />
        ) : (
          <View style={styles.goalGrid}>
            {activeGoals.map((goal) => (
              <HomeGoalCard
                evaluation={evaluateGoal(goal, data.sessions, now)}
                goal={goal}
                key={goal.id}
                onStartSession={(selectedGoal) => router.push({ pathname: '/session', params: { goalId: selectedGoal.id } })}
                style={isTablet ? styles.goalCardTablet : undefined}
                subjects={data.subjects}
              />
            ))}
          </View>
        )}
        <AppButton
          fullWidth
          label="Neues Lernziel erstellen"
          onPress={() => router.push('/create-goal')}
          size="large"
        />
      </View>

      <View style={[styles.columns, isTablet ? styles.row : undefined]}>
        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.primaryColumn : undefined]}>
          <SectionHeader
            description={data.activeTimer ? 'Ziel, Fach, Notiz und geplante Dauer bleiben auch nach einem Neustart erhalten.' : 'Fach wählen und echte Lernzeit erfassen.'}
            eyebrow={data.activeTimer ? (data.activeTimer.status === 'running' ? 'Läuft gerade' : 'Pausiert') : 'Freie Lernzeit'}
            title={data.activeTimer ? activeSubject?.name ?? data.activeTimer.subjectNameSnapshot ?? 'Lern-Session' : 'Session starten'}
          />
          {data.activeTimer ? (
            <Text
              accessibilityLabel={`${formatMinutes(elapsedSeconds / 60)} erfasst`}
              selectable
              style={[theme.typography.display, styles.numeric, { color: theme.colors.primaryText }]}>
              {formatClock(elapsedSeconds)}
            </Text>
          ) : null}
          <View style={[styles.actions, isTablet ? styles.row : undefined]}>
            <AppButton
              fullWidth={!isTablet}
              label={data.activeTimer ? 'Session fortsetzen' : 'Freie Session starten'}
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

        <View style={[styles.motivationMetrics, isTablet ? styles.secondaryColumn : undefined]}>
          <MetricCard
            detail={streak.currentDays === 0 ? 'Beginnt mit deinem ersten Lerntag' : `Längste Serie: ${streak.longestDays} ${streak.longestDays === 1 ? 'Tag' : 'Tage'}`}
            emphasized={streak.currentDays >= 3}
            label="Aktuelle Serie"
            style={streak.currentDays >= 3 ? { backgroundColor: theme.colors.accentMustardMuted, borderColor: theme.colors.accentMustard } : undefined}
            value={`${streak.currentDays} ${streak.currentDays === 1 ? 'Tag' : 'Tage'}`}
          />
          <MetricCard
            detail={`${formatMinutes(comparison.currentMinutes, true)} in dieser Kalenderwoche`}
            label="Zur Vorwoche"
            trend={weekTrend(comparison)}
            value={comparison.percentChange === null ? '–' : `${comparison.percentChange >= 0 ? '+' : '−'}${Math.abs(Math.round(comparison.percentChange))} %`}
          />
        </View>
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
                      styles.sessionItem,
                      index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
                    ]}>
                    <View style={styles.sessionRow}>
                      <View style={[styles.subjectDot, { backgroundColor: subject?.color ?? theme.colors.textSubtle }]} />
                      <View style={styles.sessionCopy}>
                        <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                          {session.subjectNameSnapshot ?? subject?.name ?? 'Lernzeit'}
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
                      <AppButton
                        accessibilityHint="Fragt vor dem endgültigen Löschen noch einmal nach"
                        label="Löschen"
                        onPress={() => setSessionPendingDelete(session.id)}
                        size="compact"
                        variant="ghost"
                      />
                    </View>
                    {sessionPendingDelete === session.id ? (
                      <View accessibilityLiveRegion="polite" style={[styles.deleteConfirmation, { backgroundColor: theme.colors.dangerMuted, borderRadius: theme.radii.md }]}>
                        <Text style={[theme.typography.body, styles.deleteCopy, { color: theme.colors.text }]}>Diesen Eintrag dauerhaft löschen?</Text>
                        <AppButton label="Abbrechen" onPress={() => setSessionPendingDelete(null)} size="compact" variant="ghost" />
                        <AppButton
                          label="Endgültig löschen"
                          onPress={() => {
                            if (deleteSession(session.id)) setSessionPendingDelete(null);
                          }}
                          size="compact"
                          variant="danger"
                        />
                      </View>
                    ) : null}
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
  summaryCard: { width: '100%', gap: 16, borderTopWidth: 4 },
  summaryHeader: { gap: 2 },
  summaryMetrics: { width: '100%', flexDirection: 'row', alignItems: 'stretch' },
  summaryMetricsPhone: { flexDirection: 'column', gap: 10 },
  summaryMetric: { minWidth: 0, flex: 1, justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  summaryLabel: {},
  summaryDivider: { width: 1, minHeight: 58 },
  summaryDividerPhone: { width: '100%', minHeight: 1, height: 1 },
  goalSection: { width: '100%', gap: 18 },
  goalGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  goalCardTablet: { minWidth: 340, flexGrow: 1, flexBasis: '47%' },
  columns: { width: '100%', gap: 20 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  flex: { flex: 1 },
  primaryColumn: { flex: 1.2 },
  secondaryColumn: { flex: 0.8 },
  sectionCard: { width: '100%', gap: 20 },
  motivationMetrics: { width: '100%', gap: 14 },
  actions: { width: '100%', gap: 10 },
  numeric: { fontVariant: ['tabular-nums'] },
  sessionList: { width: '100%' },
  sessionItem: { width: '100%', paddingVertical: 6 },
  sessionRow: { minHeight: 70, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  sessionCopy: { flex: 1, minWidth: 0, gap: 2 },
  sessionValue: { alignItems: 'flex-end', gap: 5 },
  deleteConfirmation: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: 10 },
  deleteCopy: { minWidth: 180, flex: 1 },
});
