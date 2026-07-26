import { StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { formatMinutes } from '@/lib/format';
import { useAppTheme } from '@/theme';

import { ParticipantAvatarStack } from './participant-avatar-stack';
import type { PlannedSessionViewModel, SharedSessionStatus } from './types';

const STATUS_LABELS: Readonly<Record<SharedSessionStatus, string>> = {
  planned: 'Geplant',
  active: 'Läuft gerade',
  completed: 'Beendet',
  cancelled: 'Abgesagt',
};

export function formatSharedSessionDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Zeit noch offen';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export type PlannedSessionCardProps = {
  session: PlannedSessionViewModel;
  onPress?: () => void;
  onJoin?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function PlannedSessionCard({
  session,
  onPress,
  onJoin,
  style,
}: PlannedSessionCardProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const useWideAction = width >= theme.layout.phoneBreakpoint;
  const statusLabel = STATUS_LABELS[session.status];
  const statusColors = session.status === 'active'
    ? { background: theme.colors.successMuted, foreground: theme.colors.success }
    : session.status === 'planned'
      ? { background: theme.colors.accentMustardMuted, foreground: theme.colors.accentMustard }
      : session.status === 'cancelled'
        ? { background: theme.colors.dangerMuted, foreground: theme.colors.danger }
        : { background: theme.colors.surfaceMuted, foreground: theme.colors.textMuted };
  const dateLabel = formatSharedSessionDate(session.startsAt);
  const durationLabel = formatMinutes(Math.max(0, session.plannedDurationMinutes), true);
  const canJoin = Boolean(onJoin) && (session.status === 'planned' || session.status === 'active');

  return (
    <AppCard
      accessibilityLabel={`${session.title}, ${statusLabel}, ${dateLabel}, geplant für ${durationLabel}, ${session.participants.length} Teilnehmer`}
      onPress={onPress}
      padding="lg"
      style={[styles.card, style]}
      testID={`planned-session-${session.id}`}>
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
            {session.title}
          </Text>
        </View>
        <View style={styles.timeCopy}>
          <Text selectable style={[theme.typography.label, styles.numeric, { color: theme.colors.primaryText }]}>
            {dateLabel}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Geplant: {durationLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.footer, !useWideAction ? styles.footerPhone : undefined]}>
        <View style={styles.participants}>
          <ParticipantAvatarStack participants={session.participants} />
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {session.participants.length} {session.participants.length === 1 ? 'Teilnehmer' : 'Teilnehmer'}
          </Text>
        </View>
        {canJoin ? (
          <AppButton
            fullWidth={!useWideAction}
            label={session.status === 'active' ? 'Jetzt beitreten' : 'Beitreten'}
            onPress={(event) => {
              event.stopPropagation();
              onJoin?.();
            }}
            size="compact"
            style={!useWideAction ? styles.joinButtonPhone : undefined}
          />
        ) : null}
      </View>
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
  timeCopy: {
    alignItems: 'flex-end',
    gap: 3,
  },
  badge: {
    minHeight: 26,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  footer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  footerPhone: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  participants: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  joinButtonPhone: {
    width: '100%',
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
