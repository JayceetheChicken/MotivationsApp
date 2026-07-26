import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';

import type { SocialUserSummary } from './types';

export type ParticipantAvatarStackProps = {
  participants: readonly SocialUserSummary[];
  maxVisible?: number;
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ParticipantAvatarStack({
  participants,
  maxVisible = 4,
  size = 34,
  accessibilityLabel,
  style,
}: ParticipantAvatarStackProps) {
  const theme = useAppTheme();
  const safeSize = Math.max(24, size);
  const visibleCount = Math.max(1, Math.floor(maxVisible));
  const visibleParticipants = participants.slice(0, visibleCount);
  const remaining = Math.max(0, participants.length - visibleParticipants.length);
  const names = participants.map((participant) => participant.displayName).join(', ');

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? (
        participants.length === 0
          ? 'Keine Teilnehmer'
          : `${participants.length} ${participants.length === 1 ? 'Teilnehmer' : 'Teilnehmer'}: ${names}`
      )}
      style={[styles.stack, style]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.avatars}>
        {visibleParticipants.map((participant, index) => (
          <View
            key={participant.id}
            style={[
              styles.avatarShell,
              index > 0 ? { marginLeft: -Math.round(safeSize * 0.28) } : undefined,
              { zIndex: visibleParticipants.length - index },
            ]}>
            <Avatar
              name={participant.displayName}
              size={safeSize}
              source={participant.avatarUrl ? { uri: participant.avatarUrl } : undefined}
              style={{ borderColor: theme.colors.surface, borderWidth: 2 }}
            />
          </View>
        ))}
        {remaining > 0 ? (
          <View
            style={[
              styles.more,
              {
                width: safeSize,
                height: safeSize,
                marginLeft: -Math.round(safeSize * 0.28),
                borderColor: theme.colors.surface,
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: safeSize / 2,
              },
            ]}>
            <Text
              selectable
              style={[theme.typography.caption, styles.numeric, { color: theme.colors.textMuted }]}>
              {`+${remaining}`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignSelf: 'flex-start',
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarShell: {
    borderRadius: 999,
  },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
