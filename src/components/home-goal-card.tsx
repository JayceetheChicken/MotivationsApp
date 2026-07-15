import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatMinutes } from '@/lib/format';
import { getGoalSubjectId, getGoalTitle, type GoalEvaluation } from '@/lib/goals';
import { useAppTheme } from '@/theme';
import type { StudyGoal, Subject } from '@/types/study';

export type HomeGoalCardProps = {
  goal: StudyGoal;
  evaluation: GoalEvaluation;
  subjects: readonly Subject[];
  onStartSession: (goal: StudyGoal) => void;
  style?: StyleProp<ViewStyle>;
};

function formatSessionCount(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return `${rounded} ${rounded === 1 ? 'Session' : 'Sessions'}`;
}

function formatGoalValue(goal: StudyGoal, value: number): string {
  return goal.type === 'duration'
    ? formatMinutes(value, true)
    : formatSessionCount(value);
}

function formatPeriod(goal: StudyGoal): string {
  switch (goal.period as string) {
    case 'day':
    case 'daily':
      return 'Tagesziel';
    case 'week':
      return 'Wochenziel';
    case 'month':
      return 'Monatsziel';
    case 'year':
      return 'Jahresziel';
    case 'custom': {
      const startsAt = new Date(goal.startsAt ?? goal.createdAt);
      const endsAtValue = goal.endsAt;
      const endsAt = endsAtValue ? new Date(endsAtValue) : null;

      if (Number.isFinite(startsAt.getTime()) && endsAt && Number.isFinite(endsAt.getTime())) {
        const formatter = new Intl.DateTimeFormat('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
      }

      return 'Benutzerdefiniertes Ziel';
    }
    default:
      return 'Lernziel';
  }
}

type GoalMetricProps = {
  label: string;
  value: string;
};

function GoalMetric({ label, value }: GoalMetricProps) {
  const theme = useAppTheme();

  return (
    <View style={styles.metric}>
      <Text
        selectable
        style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text
        selectable
        style={[
          theme.typography.bodyMedium,
          styles.numeric,
          { color: theme.colors.text },
        ]}>
        {value}
      </Text>
    </View>
  );
}

export function HomeGoalCard({
  goal,
  evaluation,
  subjects,
  onStartSession,
  style,
}: HomeGoalCardProps) {
  const theme = useAppTheme();
  const goalSubjectId = getGoalSubjectId(goal);
  const linkedSubject = goalSubjectId
    ? subjects.find((subject) => subject.id === goalSubjectId)
    : undefined;
  const canStartSession = Boolean(linkedSubject && !linkedSubject.archived);
  const subjectName = linkedSubject?.name
    ?? ((goal.subjectIds?.length ?? 0) > 1 ? 'Fachzuordnung prüfen' : 'Fach noch nicht zugeordnet');
  const percentage = Math.round(evaluation.progressPercent);

  return (
    <AppCard padding="lg" style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <Text
            selectable
            style={[theme.typography.caption, { color: theme.colors.primaryText }]}>
            AKTIVES LERNZIEL
          </Text>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {getGoalTitle(goal, subjects)}
          </Text>
          <Text
            selectable
            style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {subjectName}
          </Text>
        </View>
        <View
          style={[
            styles.periodBadge,
            {
              backgroundColor: evaluation.achieved
                ? theme.colors.accentOliveMuted
                : theme.colors.accentPeachMuted,
              borderColor: evaluation.achieved
                ? theme.colors.accentOlive
                : theme.colors.accentPeach,
            },
          ]}>
          <Text
            selectable
            style={[
              theme.typography.caption,
              {
                color: evaluation.achieved
                  ? theme.colors.accentOlive
                  : theme.colors.primaryText,
              },
            ]}>
            {formatPeriod(goal)}
          </Text>
        </View>
      </View>

      {evaluation.achieved ? (
        <View
          style={[
            styles.achievedBanner,
            { backgroundColor: theme.colors.accentOliveMuted },
          ]}>
          <Text
            selectable
            style={[theme.typography.label, { color: theme.colors.accentOlive }]}>
            Ziel erreicht!
          </Text>
          <Text
            selectable
            style={[
              theme.typography.bodyMedium,
              styles.numeric,
              { color: theme.colors.text },
            ]}>
            {formatGoalValue(goal, evaluation.current)} von{' '}
            {formatGoalValue(goal, evaluation.target)}
          </Text>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <GoalMetric label="Ziel" value={formatGoalValue(goal, evaluation.target)} />
        <GoalMetric label="Erreicht" value={formatGoalValue(goal, evaluation.current)} />
        <GoalMetric label="Verbleibend" value={formatGoalValue(goal, evaluation.remaining)} />
      </View>

      <ProgressBar
        accessibilityLabel={`Fortschritt für ${getGoalTitle(goal, subjects)}`}
        formatValue={() => `${percentage} %`}
        max={Math.max(1, evaluation.target)}
        showValue
        size="lg"
        tone={evaluation.achieved ? 'success' : 'primary'}
        value={evaluation.current}
      />

      {!canStartSession ? (
        <Text
          selectable
          style={[theme.typography.caption, { color: theme.colors.warning }]}>
          Weise diesem älteren Ziel zuerst genau ein aktives Fach zu.
        </Text>
      ) : null}

      <AppButton
        accessibilityHint={canStartSession
          ? `Startet den Timer für ${getGoalTitle(goal, subjects)}`
          : 'Das Ziel benötigt zuerst eine eindeutige Fachzuordnung.'}
        disabled={!canStartSession}
        fullWidth
        label="Session starten"
        onPress={() => onStartSession(goal)}
        size="large"
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 14,
  },
  headingCopy: {
    flex: 1,
    minWidth: 200,
    gap: 4,
  },
  periodBadge: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 999,
  },
  achievedBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    gap: 2,
  },
  metrics: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metric: {
    flexGrow: 1,
    flexBasis: 110,
    gap: 2,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
