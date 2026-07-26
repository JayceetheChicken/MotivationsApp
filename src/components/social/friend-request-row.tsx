import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';
import type { FriendshipConnection } from '@/types/study';

export type FriendRequestRowProps = {
  connection: FriendshipConnection;
  pending?: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function FriendRequestRow({
  connection,
  pending = false,
  onAccept,
  onDecline,
}: FriendRequestRowProps) {
  const theme = useAppTheme();
  const incoming = connection.direction === 'incoming';
  const statusLabel = incoming ? 'Möchte dein Freund sein' : 'Anfrage gesendet';

  return (
    <View
      accessibilityLabel={`${connection.otherUser.displayName}, @${connection.otherUser.username}, ${statusLabel}`}
      style={[styles.row, { borderBottomColor: theme.colors.divider }]}
      testID={`friend-request-${connection.id}`}>
      <Avatar
        name={connection.otherUser.displayName}
        size="md"
        source={connection.otherUser.avatarUrl ? { uri: connection.otherUser.avatarUrl } : undefined}
      />
      <View style={styles.copy}>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
          {connection.otherUser.displayName}
        </Text>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          @{connection.otherUser.username} · {statusLabel}
        </Text>
      </View>
      {incoming ? (
        <View style={styles.actions}>
          <AppButton
            accessibilityLabel={`Anfrage von ${connection.otherUser.displayName} annehmen`}
            label="Annehmen"
            loading={pending}
            onPress={onAccept}
            size="compact"
          />
          <AppButton
            accessibilityLabel={`Anfrage von ${connection.otherUser.displayName} ablehnen`}
            disabled={pending}
            label="Ablehnen"
            onPress={onDecline}
            size="compact"
            variant="ghost"
          />
        </View>
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
  copy: { minWidth: 140, flex: 1, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
});
