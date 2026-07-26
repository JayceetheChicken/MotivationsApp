import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { useAppTheme } from '@/theme';

import { FriendStatusCard } from './friend-status-card';
import type { FriendStatusViewModel } from './types';

export type FriendListProps = {
  friends: readonly FriendStatusViewModel[];
  onOpenFriend?: (friend: FriendStatusViewModel) => void;
  now?: Date | number;
  style?: StyleProp<ViewStyle>;
};

export function FriendList({ friends, onOpenFriend, now, style }: FriendListProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const twoColumns = width >= theme.layout.tabletBreakpoint;
  const sortedFriends = [...friends].sort((left, right) =>
    left.user.displayName.localeCompare(right.user.displayName, 'de-DE'));

  if (sortedFriends.length === 0) {
    return (
      <EmptyState
        compact
        message="Füge Freunde über ihren eindeutigen Benutzernamen hinzu."
        symbol="+"
        title="Noch keine Freunde"
      />
    );
  }

  return (
    <View accessibilityLabel="Freundesliste" style={[styles.list, style]} testID="friend-list">
      {sortedFriends.map((friend) => (
        <View key={friend.user.id} style={twoColumns ? styles.cellTablet : styles.cellPhone}>
          <FriendStatusCard
            compact
            friend={friend}
            now={now}
            onPress={onOpenFriend ? () => onOpenFriend(friend) : undefined}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  cellPhone: {
    width: '100%',
  },
  cellTablet: {
    minWidth: 320,
    flexBasis: '47%',
    flexGrow: 1,
  },
});
