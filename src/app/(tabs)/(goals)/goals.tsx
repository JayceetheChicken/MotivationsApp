import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import {
  currentWeekRange,
  filterSessionsByPeriod,
  getDurationBreakdown,
  type DateRange,
} from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { StudyGoal, StudySession, Subject } from '@/types/study';

type GoalProgress = {
  current: number;
  target: number;
  achieved: boolean;
  valueLabel: string;
  remainingLabel: string;
};

function getGoalRange(goal: StudyGoal, referenceDate: Date): DateRange {
  if (goal.period === 'week') {
    return currentWeekRange(referenceDate);
  }

  return {
    start: new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1),
    endExclusive: new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1),
  };
}

function sessionsForGoal(
  goal: StudyGoal,
  sessions: readonly StudySession[],
  referenceDate: Date,
): StudySession[] {
  const range = getGoalRange(goal, referenceDate);
  const subjectIds = goal.subjectIds ? new Set(goal.subjectIds) : null;

  return filterSessionsByPeriod(sessions, range.start, range.endExclusive).filter(
    (session) =>
      (!subjectIds || subjectIds.has(session.subjectId)) &&
      (goal.sourcePolicy === 'all' || session.source === 'timer'),
  );
}

function calculateGoalProgress(
  goal: StudyGoal,
  sessions: readonly StudySession[],
  referenceDate: Date,
): GoalProgress {
  const relevantSessions = sessionsForGoal(goal, sessions, referenceDate);

  if (goal.type === 'duration') {
    const current = getDurationBreakdown(relevantSessions).totalMinutes;
    const remaining = Math.max(0, goal.targetMinutes - current);

    return {
      current,
      target: goal.targetMinutes,
      achieved: current >= goal.targetMinutes,
      valueLabel: `${formatMinutes(current, true)} von ${formatMinutes(goal.targetMinutes, true)}`,
      remainingLabel:
        remaining === 0 ? 'Ziel erreicht' : `Noch ${formatMinutes(remaining, true)}`,
    };
  }

  const current = relevantSessions.filter(
    (session) =>
      session.source === 'timer' && session.durationMinutes >= goal.minimumSessionMinutes,
  ).length;
  const remaining = Math.max(0, goal.targetSessions - current);

  return {
    current,
    target: goal.targetSessions,
    achieved: current >= goal.targetSessions,
    valueLabel: `${current} von ${goal.targetSessions} Sessions`,
    remainingLabel:
      remaining === 0
        ? 'Ziel erreicht'
        : `Noch ${remaining} ${remaining === 1 ? 'Session' : 'Sessions'}`,
  };
}

function GoalCard({
  goal,
  sessions,
  subjects,
  referenceDate,
  twoColumns,
}: {
  goal: StudyGoal;
  sessions: readonly StudySession[];
  subjects: readonly Subject[];
  referenceDate: Date;
  twoColumns: boolean;
}) {
  const theme = useAppTheme();
  const progress = calculateGoalProgress(goal, sessions, referenceDate);
  const scopedSubjects = goal.subjectIds
    ?.map((subjectId) => subjects.find((subject) => subject.id === subjectId)?.name)
    .filter((name): name is string => Boolean(name));
  const subjectLabel = scopedSubjects?.length ? scopedSubjects.join(', ') : 'Alle Fächer';
  const periodLabel = goal.period === 'week' ? 'Diese Woche' : 'Dieser Monat';

  return (
    <AppCard
      style={[styles.goalCard, twoColumns ? styles.goalCardTablet : styles.goalCardPhone]}
      variant={progress.achieved ? 'highlight' : 'default'}>
      <View style={styles.goalHeader}>
        <View style={styles.goalHeadingCopy}>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {goal.title}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {periodLabel} · {subjectLabel}
          </Text>
        </View>
        <View
          accessibilityLabel={goal.type === 'duration' ? 'Zeitziel' : 'Sessionziel'}
          style={[
            styles.typeBadge,
            {
              backgroundColor: progress.achieved
                ? theme.colors.successMuted
                : theme.colors.surfaceMuted,
            },
          ]}>
          <Text
            style={[
              theme.typography.caption,
              { color: progress.achieved ? theme.colors.success : theme.colors.textMuted },
            ]}>
            {goal.type === 'duration' ? 'ZEIT' : 'SESSIONS'}
          </Text>
        </View>
      </View>

      {goal.sourcePolicy === 'timer_only' ? (
        <SourceBadge compact label="Nur mit Timer" source="timer" />
      ) : (
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          Timer und manuelle Einträge zählen
        </Text>
      )}

      <View style={styles.progressCopy}>
        <Text
          selectable
          style={[
            theme.typography.heading,
            styles.numeric,
            { color: progress.achieved ? theme.colors.success : theme.colors.text },
          ]}>
          {progress.valueLabel}
        </Text>
        {goal.type === 'sessions' ? (
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Mindestens {formatMinutes(goal.minimumSessionMinutes, true)} je Session
          </Text>
        ) : null}
      </View>

      <ProgressBar
        accessibilityLabel={`Fortschritt für ${goal.title}`}
        formatValue={(percentage) => `${percentage} %`}
        max={progress.target}
        showValue
        size="lg"
        tone={progress.achieved ? 'success' : 'primary'}
        value={progress.current}
      />

      <Text
        selectable
        style={[
          theme.typography.label,
          { color: progress.achieved ? theme.colors.success : theme.colors.textMuted },
        ]}>
        {progress.remainingLabel}
      </Text>
    </AppCard>
  );
}

export default function GoalsRoute() {
  const theme = useAppTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data } = useStudyStore();
  const activeGoals = data.goals.filter((goal) => goal.status === 'active');
  const twoColumns = width >= theme.layout.phoneBreakpoint;
  const referenceDate = new Date();

  return (
    <Screen maxWidth={1100}>
      <SectionHeader
        description="Dein Fortschritt wird automatisch aus deinen gespeicherten Lernzeiten berechnet."
        eyebrow="Dein Plan"
        title="Aktive Ziele"
      />

      {activeGoals.length > 0 ? (
        <View style={styles.goalGrid}>
          {activeGoals.map((goal) => (
            <GoalCard
              goal={goal}
              key={goal.id}
              referenceDate={referenceDate}
              sessions={data.sessions}
              subjects={data.subjects}
              twoColumns={twoColumns}
            />
          ))}
        </View>
      ) : (
        <AppCard style={styles.emptyCard} variant="subtle">
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            Noch kein aktives Lernziel
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Starte mit einem realistischen Wochenziel. Du kannst es später jederzeit anpassen.
          </Text>
        </AppCard>
      )}

      <AppButton
        fullWidth
        label="Neues Lernziel erstellen"
        onPress={() => router.push('/create-goal')}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  goalGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  goalCard: {
    minWidth: 0,
    minHeight: 280,
    justifyContent: 'space-between',
    gap: 18,
  },
  goalCardPhone: {
    width: '100%',
  },
  goalCardTablet: {
    flexGrow: 1,
    flexBasis: '47%',
    maxWidth: '48%',
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  goalHeadingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  typeBadge: {
    minHeight: 28,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  progressCopy: {
    gap: 4,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  emptyCard: {
    width: '100%',
    minHeight: 180,
    justifyContent: 'center',
    gap: 8,
  },
});
