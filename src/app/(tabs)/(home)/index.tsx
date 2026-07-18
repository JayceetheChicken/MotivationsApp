import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActivityHeatmap } from '@/components/activity-heatmap';
import { EmptyState } from '@/components/empty-state';
import { HomeGoalCard } from '@/components/home-goal-card';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import {
  calculateActivityOverview,
  type ActivityPeriodComparison,
} from '@/lib/activity';
import { formatClock, formatMinutes } from '@/lib/format';
import { evaluateGoal } from '@/lib/goals';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

function greetingFor(date: Date): string {
  if (date.getHours() < 11) return 'Guten Morgen';
  if (date.getHours() < 18) return 'Hallo';
  return 'Guten Abend';
}

function formatComparison(comparison: ActivityPeriodComparison): string {
  if (comparison.trend === 'new') return 'Neu';
  const percentChange = comparison.percentChange ?? 0;
  if (percentChange > 0) return `+${percentChange} %`;
  if (percentChange < 0) return `−${Math.abs(percentChange)} %`;
  return '0 %';
}

function SummaryMetric({
  comparison,
  comparisonLabel,
  label,
  value,
}: {
  comparison: ActivityPeriodComparison;
  comparisonLabel: string;
  label: string;
  value: number;
}) {
  const theme = useAppTheme();
  const comparisonValue = formatComparison(comparison);
  const comparisonColor = comparison.trend === 'negative'
    ? theme.colors.danger
    : comparison.trend === 'positive' || comparison.trend === 'new'
      ? theme.colors.success
      : theme.colors.textMuted;

  return (
    <View style={styles.summaryMetric}>
      <View style={styles.summaryMetricCopy}>
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        <Text
          accessibilityLabel={`${label}: ${formatMinutes(value)}`}
          selectable
          style={[theme.typography.subheading, styles.numeric, { color: theme.colors.text }]}>
          {formatMinutes(value, true)}
        </Text>
      </View>
      <View style={styles.summaryComparison}>
        <Text
          selectable
          style={[theme.typography.caption, styles.summaryComparisonLabel, { color: theme.colors.textMuted }]}>
          {comparisonLabel}
        </Text>
        <Text
          accessibilityLabel={`${comparisonValue} im Vergleich zu ${comparisonLabel}; zuvor ${formatMinutes(comparison.previousMinutes)}`}
          selectable
          style={[theme.typography.label, styles.numeric, { color: comparisonColor }]}>
          {comparisonValue}
        </Text>
      </View>
    </View>
  );
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
  const userId = user?.id ?? 'local-user';
  const activityOverview = calculateActivityOverview(data.sessions, {
    userId,
    referenceDate: now,
  });
  const { comparisons: activityComparisons, summary: activitySummary } = activityOverview;
  const activeGoals = data.goals.filter((goal) => goal.status === 'active' && goal.userId === userId);
  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const activeSubject = data.activeTimer
    ? subjectById.get(data.activeTimer.subjectId)
    : undefined;
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
        <Avatar
          accessibilityLabel="Konto und Einstellungen öffnen"
          name={user?.displayName ?? 'Gast'}
          onPress={() => router.push('/profile')}
          size="lg"
        />
      </View>

      <AppCard
        accessibilityLabel="Lernzeitübersicht"
        padding="lg"
        style={[styles.summaryCard, { borderTopColor: theme.colors.primary }]}
        variant="highlight">
        <Text
          accessibilityRole="header"
          selectable
          style={[theme.typography.subheading, { color: theme.colors.text }]}>Deine Lernzeit</Text>
        <View style={[styles.summaryMetrics, !isTablet ? styles.summaryMetricsPhone : undefined]}>
          <SummaryMetric
            comparison={activityComparisons.today}
            comparisonLabel="gestern"
            label="Heute"
            value={activitySummary.todayMinutes}
          />
          <View style={[styles.summaryDivider, !isTablet ? styles.summaryDividerPhone : undefined, { backgroundColor: theme.colors.divider }]} />
          <SummaryMetric
            comparison={activityComparisons.lastSevenDays}
            comparisonLabel="vorherige 7 Tage"
            label="Letzte 7 Tage"
            value={activitySummary.lastSevenDaysMinutes}
          />
          <View style={[styles.summaryDivider, !isTablet ? styles.summaryDividerPhone : undefined, { backgroundColor: theme.colors.divider }]} />
          <SummaryMetric
            comparison={activityComparisons.currentMonth}
            comparisonLabel="letzter Monat"
            label="Dieser Monat"
            value={activitySummary.currentMonthMinutes}
          />
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

      <AppCard padding="lg" style={styles.sectionCard}>
        <SectionHeader
          description={data.activeTimer ? 'Ziel, Fach und geplante Dauer bleiben auch nach einem Neustart erhalten.' : 'Fach wählen und echte Lernzeit erfassen.'}
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
  summaryMetrics: { width: '100%', flexDirection: 'row', alignItems: 'stretch' },
  summaryMetricsPhone: { flexDirection: 'column', gap: 10 },
  summaryMetric: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 8 },
  summaryMetricCopy: { minWidth: 0, flex: 1, justifyContent: 'center', gap: 4 },
  summaryComparison: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  summaryComparisonLabel: { maxWidth: 116, textAlign: 'right' },
  summaryDivider: { width: 1, minHeight: 58 },
  summaryDividerPhone: { width: '100%', minHeight: 1, height: 1 },
  goalSection: { width: '100%', gap: 18 },
  goalGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  goalCardTablet: { minWidth: 340, flexGrow: 1, flexBasis: '47%' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  flex: { flex: 1 },
  sectionCard: { width: '100%', gap: 20 },
  actions: { width: '100%', gap: 10 },
  numeric: { fontVariant: ['tabular-nums'] },
});
