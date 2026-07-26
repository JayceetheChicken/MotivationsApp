import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { useAppTheme } from '@/theme';

import { FriendStatusCard } from './friend-status-card';
import type { FriendLearningStatus, FriendStatusViewModel } from './types';

const STATUS_PRIORITY: Readonly<Record<FriendLearningStatus, number>> = {
  learning_now: 0,
  learned_today: 1,
  not_learned_today: 2,
};

function activityTimestamp(friend: FriendStatusViewModel): number {
  const value = friend.status === 'learning_now' ? friend.activeSince : friend.lastStudyAt;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export type ActiveFriendsListProps = {
  friends: readonly FriendStatusViewModel[];
  onOpenFriend?: (friend: FriendStatusViewModel) => void;
  maxItems?: number;
  now?: Date | number;
  style?: StyleProp<ViewStyle>;
};

export function ActiveFriendsList({
  friends,
  onOpenFriend,
  maxItems,
  now,
  style,
}: ActiveFriendsListProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const twoColumns = width >= theme.layout.tabletBreakpoint;
  const sortedFriends = [...friends]
    .sort((left, right) => {
      const statusDifference = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
      if (statusDifference !== 0) return statusDifference;
      const activityDifference = activityTimestamp(right) - activityTimestamp(left);
      if (activityDifference !== 0) return activityDifference;
      return left.user.displayName.localeCompare(right.user.displayName, 'de-DE');
    })
    .slice(0, maxItems);

  if (sortedFriends.length === 0) {
    return (
      <EmptyState
        compact
        message="Sobald Freunde lernen oder heute aktiv waren, erscheinen sie hier."
        symbol="○"
        title="Gerade ist es ruhig"
      />
    );
  }

  return (
    <View accessibilityLabel="Aktive Freunde" style={[styles.list, style]} testID="active-friends-list">
      {sortedFriends.map((friend) => (
        <View key={friend.user.id} style={twoColumns ? styles.cellTablet : styles.cellPhone}>
          <FriendStatusCard
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
    gap: 16,
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
