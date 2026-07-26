import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useAppTheme } from '@/theme';

import {
  SharedGoalParticipantProgressRow,
  SharedGoalTeamSummary,
  formatSharedGoalValue,
} from './shared-goal-progress';
import type {
  SharedGoalMode,
  SharedGoalParticipantProgress,
  SharedGoalProgressValues,
  SharedGoalStatus,
  SharedGoalTargetType,
  SocialActionState,
} from './types';

const MODE_LABELS: Readonly<Record<SharedGoalMode, string>> = {
  shared: 'Gemeinsames Teamziel',
  per_participant: 'Ziel pro Person',
};

const STATUS_LABELS: Readonly<Record<SharedGoalStatus, string>> = {
  upcoming: 'Startet bald',
  active: 'Aktiv',
  completed: 'Beendet',
};

export type SharedGoalCardProps = {
  title: string;
  description?: string;
  mode: SharedGoalMode;
  status: SharedGoalStatus;
  targetType: SharedGoalTargetType;
  target: number;
  periodLabel: string;
  participants: readonly SharedGoalParticipantProgress[];
  teamProgress?: SharedGoalProgressValues;
  onPress?: () => void;
  onOpenParticipant?: (participant: SharedGoalParticipantProgress) => void;
  onAcceptInvitation?: () => void;
  onDeclineInvitation?: () => void;
  invitationActionState?: SocialActionState;
  style?: StyleProp<ViewStyle>;
};

export function SharedGoalCard({
  title,
  description,
  mode,
  status,
  targetType,
  target,
  periodLabel,
  participants,
  teamProgress,
  onPress,
  onOpenParticipant,
  onAcceptInvitation,
  onDeclineInvitation,
  invitationActionState = 'idle',
  style,
}: SharedGoalCardProps) {
  const theme = useAppTheme();
  const acceptedParticipants = participants.filter((participant) => participant.status === 'accepted');
  const invitedParticipants = participants.filter((participant) => participant.status === 'invited');
  const targetLabel = formatSharedGoalValue(target, targetType);

  return (
    <AppCard
      accessibilityLabel={`${title}, ${MODE_LABELS[mode]}, Ziel ${targetLabel}, ${STATUS_LABELS[status]}`}
      onPress={onPress}
      padding="lg"
      style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.titleCopy}>
          <View style={styles.badges}>
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.colors.accentOliveMuted, borderRadius: theme.radii.pill },
              ]}>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.accentOlive }]}>
                {STATUS_LABELS[status]}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radii.pill },
              ]}>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                {MODE_LABELS[mode]}
              </Text>
            </View>
          </View>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {title}
          </Text>
          {description ? (
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              {description}
            </Text>
          ) : null}
        </View>
        <View style={styles.targetCopy}>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Ziel
          </Text>
          <Text
            selectable
            style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.primaryText }]}>
            {targetLabel}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>
            {periodLabel}
          </Text>
        </View>
      </View>

      {teamProgress ? (
        <SharedGoalTeamSummary progress={teamProgress} targetType={targetType} />
      ) : mode === 'per_participant' && acceptedParticipants.length > 0 ? (
        <ProgressBar
          accessibilityLabel="Durchschnittlicher Fortschritt der Teilnehmer"
          max={100}
          showValue
          value={
            acceptedParticipants.reduce(
              (sum, participant) => sum + (participant.progress?.percent ?? 0),
              0,
            ) / acceptedParticipants.length
          }
        />
      ) : null}

      <View style={styles.participants}>
        <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
          {acceptedParticipants.length} {acceptedParticipants.length === 1 ? 'Teilnehmer' : 'Teilnehmer'}
          {invitedParticipants.length > 0 ? ` · ${invitedParticipants.length} offen` : ''}
        </Text>
        {participants.map((participant) => (
          <SharedGoalParticipantProgressRow
            key={participant.user.id}
            onOpenProfile={onOpenParticipant ? () => onOpenParticipant(participant) : undefined}
            participant={participant}
            showIndividualGoal={mode === 'per_participant'}
            targetType={targetType}
          />
        ))}
      </View>

      {onAcceptInvitation || onDeclineInvitation ? (
        <View style={styles.invitationActions}>
          {onAcceptInvitation ? (
            <AppButton
              fullWidth
              label="Einladung annehmen"
              loading={invitationActionState === 'loading'}
              onPress={onAcceptInvitation}
            />
          ) : null}
          {onDeclineInvitation ? (
            <AppButton
              disabled={invitationActionState !== 'idle'}
              fullWidth
              label="Ablehnen"
              onPress={onDeclineInvitation}
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 20,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
  },
  titleCopy: {
    minWidth: 0,
    flex: 1,
    gap: 7,
  },
  targetCopy: {
    alignItems: 'flex-end',
    gap: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  badge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  participants: {
    width: '100%',
    gap: 2,
  },
  invitationActions: {
    width: '100%',
    gap: 8,
  },
});
