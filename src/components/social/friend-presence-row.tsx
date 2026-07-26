import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';
import type { FriendOverview, FriendPresenceStatus } from '@/types/study';

import { formatSocialRelativeTime } from './format-social-relative-time';

const PRESENCE_LABELS: Readonly<Record<FriendPresenceStatus, string>> = {
  learning: 'Lernt gerade',
  online: 'Online',
  offline: 'Offline',
};

export type FriendPresenceRowProps = {
  overview: Pick<FriendOverview, 'friend' | 'presenceStatus' | 'lastActiveAt'>;
  now?: Date | number;
  removing?: boolean;
  onRemove?: () => void;
};

export function FriendPresenceRow({
  overview,
  now,
  removing = false,
  onRemove,
}: FriendPresenceRowProps) {
  const theme = useAppTheme();
  const status = overview.presenceStatus;
  const relative = formatSocialRelativeTime(overview.lastActiveAt, now);
  const activityLabel = relative ? `Zuletzt aktiv ${relative}` : 'Zuletzt aktiv nicht verfügbar';
  const badgeColors = status === 'learning'
    ? { background: theme.colors.successMuted, foreground: theme.colors.success }
    : status === 'online'
      ? { background: theme.colors.accentTurquoiseMuted, foreground: theme.colors.accentTurquoise }
      : { background: theme.colors.surfaceMuted, foreground: theme.colors.textMuted };

  return (
    <View
      accessibilityLabel={`${overview.friend.displayName}, @${overview.friend.username}, ${PRESENCE_LABELS[status]}, ${activityLabel}`}
      style={[styles.row, { borderBottomColor: theme.colors.divider }]}
      testID={`friend-presence-${overview.friend.id}`}>
      <Avatar
        name={overview.friend.displayName}
        size="md"
        source={overview.friend.avatarUrl ? { uri: overview.friend.avatarUrl } : undefined}
      />
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text
            numberOfLines={1}
            selectable
            style={[theme.typography.bodyMedium, styles.name, { color: theme.colors.text }]}>
            {overview.friend.displayName}
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: badgeColors.background, borderRadius: theme.radii.pill },
            ]}>
            <Text selectable style={[theme.typography.caption, { color: badgeColors.foreground }]}>
              {PRESENCE_LABELS[status]}
            </Text>
          </View>
        </View>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          @{overview.friend.username}
        </Text>
        <Text
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {activityLabel}
        </Text>
      </View>
      {onRemove ? (
        <AppButton
          accessibilityLabel={`Freundschaft mit ${overview.friend.displayName} entfernen`}
          label="Entfernen"
          loading={removing}
          onPress={onRemove}
          size="compact"
          variant="ghost"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { minWidth: 120, flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  name: { minWidth: 80, flexShrink: 1 },
  badge: { minHeight: 24, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 3 },
});
