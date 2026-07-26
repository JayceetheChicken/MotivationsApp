import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useAppTheme } from '@/theme';

import { ParticipantAvatarStack } from './participant-avatar-stack';
import { formatSharedGoalValue } from './shared-goal-progress';
import type {
  SharedGoalProgressValues,
  SharedGoalStatus,
  SharedGoalSummaryViewModel,
  SharedGoalTargetType,
} from './types';

const STATUS_LABELS: Readonly<Record<SharedGoalStatus, string>> = {
  upcoming: 'Startet bald',
  active: 'Aktiv',
  completed: 'Beendet',
};

function GoalProgress({
  label,
  progress,
  targetType,
}: {
  label: string;
  progress: SharedGoalProgressValues;
  targetType: SharedGoalTargetType;
}) {
  const theme = useAppTheme();
  const progressLabel = `${formatSharedGoalValue(progress.value, targetType)} von ${formatSharedGoalValue(progress.target, targetType)}`;

  return (
    <View style={styles.progress}>
      <View style={styles.progressHeader}>
        <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
          {label}
        </Text>
        <Text
          selectable
          style={[theme.typography.caption, styles.numeric, { color: theme.colors.textMuted }]}>
          {progressLabel}
        </Text>
      </View>
      <ProgressBar
        accessibilityLabel={`${label}: ${progressLabel}`}
        formatValue={() => `${Math.max(0, Math.round(progress.percent))} %`}
        max={100}
        showValue
        tone={progress.reached ? 'success' : 'primary'}
        value={Math.max(0, progress.percent)}
      />
    </View>
  );
}

export type SharedGoalSummaryCardProps = {
  goal: SharedGoalSummaryViewModel;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SharedGoalSummaryCard({
  goal,
  onPress,
  style,
}: SharedGoalSummaryCardProps) {
  const theme = useAppTheme();
  const statusLabel = STATUS_LABELS[goal.status];
  const statusColors = goal.status === 'active'
    ? { background: theme.colors.successMuted, foreground: theme.colors.success }
    : goal.status === 'upcoming'
      ? { background: theme.colors.warningMuted, foreground: theme.colors.warning }
      : { background: theme.colors.surfaceMuted, foreground: theme.colors.textMuted };

  return (
    <AppCard
      accessibilityLabel={`${goal.title}, ${statusLabel}, ${goal.periodLabel}${goal.remainingLabel ? `, ${goal.remainingLabel}` : ''}`}
      onPress={onPress}
      padding="lg"
      style={[styles.card, style]}
      testID={`shared-goal-summary-${goal.id}`}>
      <View style={styles.header}>
        <View style={styles.titleCopy}>
          <View
            style={[
              styles.badge,
              { backgroundColor: statusColors.background, borderRadius: theme.radii.pill },
            ]}>
            <Text selectable style={[theme.typography.caption, { color: statusColors.foreground }]}>
              {statusLabel}
            </Text>
          </View>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {goal.title}
          </Text>
          {goal.description ? (
            <Text
              numberOfLines={2}
              selectable
              style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              {goal.description}
            </Text>
          ) : null}
        </View>
        <View style={styles.periodCopy}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.primaryText }]}>
            {goal.periodLabel}
          </Text>
          {goal.remainingLabel ? (
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              {goal.remainingLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.participantsRow}>
        <ParticipantAvatarStack participants={goal.participants} />
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {goal.participants.length} {goal.participants.length === 1 ? 'Person' : 'Personen'}
        </Text>
      </View>

      {goal.ownProgress ? (
        <GoalProgress label="Dein Fortschritt" progress={goal.ownProgress} targetType={goal.targetType} />
      ) : null}
      {goal.teamProgress ? (
        <GoalProgress label="Gemeinsam" progress={goal.teamProgress} targetType={goal.targetType} />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 18,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  titleCopy: {
    minWidth: 200,
    flex: 1,
    gap: 7,
  },
  periodCopy: {
    alignItems: 'flex-end',
    gap: 2,
  },
  badge: {
    minHeight: 26,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  participantsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  progress: {
    width: '100%',
    gap: 8,
  },
  progressHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
