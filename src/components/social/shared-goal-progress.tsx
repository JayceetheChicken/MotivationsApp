import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatMinutes } from '@/lib/format';
import { useAppTheme } from '@/theme';

import type {
  SharedGoalParticipantProgress,
  SharedGoalProgressValues,
  SharedGoalTargetType,
} from './types';

const PARTICIPANT_STATUS_LABELS: Readonly<Record<SharedGoalParticipantProgress['status'], string>> = {
  invited: 'Eingeladen',
  accepted: 'Nimmt teil',
  declined: 'Abgelehnt',
  withdrawn: 'Ausgetreten',
};

export function formatSharedGoalValue(value: number, targetType: SharedGoalTargetType): string {
  const safeValue = Math.max(0, Math.round(value));
  if (targetType === 'duration') return formatMinutes(safeValue, true);
  return `${safeValue} ${safeValue === 1 ? 'Session' : 'Sessions'}`;
}

function ProgressFacts({
  progress,
  targetType,
}: {
  progress: SharedGoalProgressValues;
  targetType: SharedGoalTargetType;
}) {
  const theme = useAppTheme();
  const facts = [
    { label: 'Fortschritt', value: `${Math.max(0, Math.round(progress.percent))} %` },
    {
      label: progress.reached ? 'Status' : 'Noch fehlend',
      value: progress.reached ? 'Ziel erreicht' : formatSharedGoalValue(progress.remaining, targetType),
    },
    {
      label: 'Über Ziel',
      value: formatSharedGoalValue(progress.exceeded, targetType),
    },
  ];

  return (
    <View style={styles.facts}>
      {facts.map((fact) => (
        <View key={fact.label} style={styles.fact}>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {fact.label}
          </Text>
          <Text
            selectable
            style={[theme.typography.label, styles.numeric, { color: theme.colors.text }]}>
            {fact.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export type SharedGoalParticipantProgressRowProps = {
  participant: SharedGoalParticipantProgress;
  targetType: SharedGoalTargetType;
  showIndividualGoal?: boolean;
  onOpenProfile?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SharedGoalParticipantProgressRow({
  participant,
  targetType,
  showIndividualGoal = false,
  onOpenProfile,
  style,
}: SharedGoalParticipantProgressRowProps) {
  const theme = useAppTheme();
  const contribution = participant.contribution === null
    ? 'Noch nicht verfügbar'
    : formatSharedGoalValue(participant.contribution, targetType);

  return (
    <View
      accessibilityLabel={`${participant.user.displayName}, ${PARTICIPANT_STATUS_LABELS[participant.status]}, Beitrag ${contribution}`}
      style={[styles.participant, { borderBottomColor: theme.colors.divider }, style]}>
      <View style={styles.personRow}>
        <Avatar
          name={participant.user.displayName}
          onPress={onOpenProfile}
          size="md"
          source={participant.user.avatarUrl ? { uri: participant.user.avatarUrl } : undefined}
        />
        <View style={styles.personCopy}>
          <Text
            numberOfLines={1}
            selectable
            style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {participant.user.displayName}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            @{participant.user.username} · {PARTICIPANT_STATUS_LABELS[participant.status]}
          </Text>
        </View>
        <View style={styles.contribution}>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Beitrag
          </Text>
          <Text
            selectable
            style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.accentTurquoise }]}>
            {contribution}
          </Text>
        </View>
      </View>

      {showIndividualGoal && participant.status === 'accepted' && participant.progress ? (
        <>
          <ProgressBar
            accessibilityLabel={`Fortschritt von ${participant.user.displayName}`}
            max={Math.max(1, participant.progress.target)}
            showValue
            tone={participant.progress.reached ? 'success' : 'primary'}
            value={participant.progress.value}
          />
          <ProgressFacts progress={participant.progress} targetType={targetType} />
        </>
      ) : null}
    </View>
  );
}

export type SharedGoalTeamSummaryProps = {
  progress: SharedGoalProgressValues;
  targetType: SharedGoalTargetType;
  style?: StyleProp<ViewStyle>;
};

export function SharedGoalTeamSummary({
  progress,
  targetType,
  style,
}: SharedGoalTeamSummaryProps) {
  const theme = useAppTheme();

  return (
    <AppCard
      accessibilityLabel={`Gemeinsamer Teamfortschritt: ${formatSharedGoalValue(progress.value, targetType)} von ${formatSharedGoalValue(progress.target, targetType)}`}
      style={[styles.teamCard, style]}
      variant="highlight">
      <View style={styles.teamHeader}>
        <View style={styles.teamCopy}>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            Gemeinsamer Teamfortschritt
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Alle akzeptierten Beiträge zählen zusammen.
          </Text>
        </View>
        <Text
          selectable
          style={[theme.typography.heading, styles.numeric, { color: theme.colors.primaryText }]}>
          {Math.max(0, Math.round(progress.percent))} %
        </Text>
      </View>
      <ProgressBar
        formatValue={() => `${formatSharedGoalValue(progress.value, targetType)} von ${formatSharedGoalValue(progress.target, targetType)}`}
        max={Math.max(1, progress.target)}
        showValue
        size="lg"
        tone={progress.reached ? 'success' : 'primary'}
        value={progress.value}
      />
      <ProgressFacts progress={progress} targetType={targetType} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  participant: {
    width: '100%',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  contribution: {
    alignItems: 'flex-end',
    gap: 2,
  },
  facts: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fact: {
    minWidth: 112,
    flex: 1,
    gap: 2,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  teamCard: {
    width: '100%',
    gap: 16,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  teamCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
});
