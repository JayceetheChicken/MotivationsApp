import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';

import type { SocialConnection } from './types';

export type SocialConnectionsListProps = {
  connections: readonly SocialConnection[];
  onAccept?: (connection: SocialConnection) => void;
  onDecline?: (connection: SocialConnection) => void;
  onRemove?: (connection: SocialConnection) => void;
  onOpenProfile?: (connection: SocialConnection) => void;
  pendingActionId?: string | null;
  emptyTitle?: string;
  emptyMessage?: string;
};

type ConnectionSection = Readonly<{
  key: 'pending_received' | 'pending_sent' | 'accepted';
  title: string;
  emptyLabel?: string;
  items: readonly SocialConnection[];
}>;

function ConnectionRow({
  connection,
  isPending,
  compactActions,
  onAccept,
  onDecline,
  onRemove,
  onOpenProfile,
}: {
  connection: SocialConnection;
  isPending: boolean;
  compactActions: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onRemove?: () => void;
  onOpenProfile?: () => void;
}) {
  const theme = useAppTheme();
  const statusLabel = {
    accepted: 'Befreundet',
    pending_sent: 'Anfrage gesendet',
    pending_received: 'Möchte mit dir befreundet sein',
  }[connection.status];

  return (
    <View
      accessibilityLabel={`${connection.user.displayName}, @${connection.user.username}, ${statusLabel}`}
      style={[
        styles.row,
        compactActions ? styles.rowCompact : undefined,
        { borderBottomColor: theme.colors.divider },
      ]}
      testID={`social-connection-${connection.id}`}>
      <Avatar
        name={connection.user.displayName}
        onPress={onOpenProfile}
        size="md"
        source={connection.user.avatarUrl ? { uri: connection.user.avatarUrl } : undefined}
      />
      <View style={styles.copy}>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
          {connection.user.displayName}
        </Text>
        <Text
          numberOfLines={2}
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          @{connection.user.username} · {statusLabel}
        </Text>
      </View>
      <View style={[styles.actions, compactActions ? styles.actionsCompact : undefined]}>
        {connection.status === 'pending_received' ? (
          <>
            <AppButton
              label="Annehmen"
              loading={isPending}
              onPress={onAccept}
              size="compact"
            />
            <AppButton
              disabled={isPending}
              label="Ablehnen"
              onPress={onDecline}
              size="compact"
              variant="ghost"
            />
          </>
        ) : connection.status === 'accepted' ? (
          <AppButton
            label="Entfernen"
            loading={isPending}
            onPress={onRemove}
            size="compact"
            variant="outline"
          />
        ) : null}
      </View>
    </View>
  );
}

export function SocialConnectionsList({
  connections,
  onAccept,
  onDecline,
  onRemove,
  onOpenProfile,
  pendingActionId,
  emptyTitle = 'Noch keine Verbindungen',
  emptyMessage = 'Gesendete Anfragen, empfangene Anfragen und bestätigte Freunde erscheinen hier.',
}: SocialConnectionsListProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const compactActions = width < theme.layout.phoneBreakpoint;

  if (connections.length === 0) {
    return <EmptyState compact message={emptyMessage} symbol="＋" title={emptyTitle} />;
  }

  const sections: readonly ConnectionSection[] = [
    {
      key: 'pending_received',
      title: 'Eingegangene Anfragen',
      items: connections.filter((connection) => connection.status === 'pending_received'),
    },
    {
      key: 'pending_sent',
      title: 'Gesendete Anfragen',
      items: connections.filter((connection) => connection.status === 'pending_sent'),
    },
    {
      key: 'accepted',
      title: 'Freunde',
      items: connections.filter((connection) => connection.status === 'accepted'),
    },
  ];

  return (
    <View style={styles.list}>
      {sections.map((section) =>
        section.items.length > 0 ? (
          <AppCard key={section.key} padding="none" style={styles.section}>
            <Text
              accessibilityRole="header"
              selectable
              style={[
                theme.typography.label,
                styles.sectionTitle,
                { color: theme.colors.primaryText },
              ]}>
              {section.title}
            </Text>
            {section.items.map((connection) => (
              <ConnectionRow
                compactActions={compactActions}
                connection={connection}
                isPending={pendingActionId === connection.id}
                key={connection.id}
                onAccept={onAccept ? () => onAccept(connection) : undefined}
                onDecline={onDecline ? () => onDecline(connection) : undefined}
                onOpenProfile={onOpenProfile ? () => onOpenProfile(connection) : undefined}
                onRemove={onRemove ? () => onRemove(connection) : undefined}
              />
            ))}
          </AppCard>
        ) : null,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    width: '100%',
    gap: 16,
  },
  section: {
    width: '100%',
    overflow: 'hidden',
  },
  sectionTitle: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    width: '100%',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowCompact: {
    flexWrap: 'wrap',
  },
  copy: {
    minWidth: 140,
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionsCompact: {
    width: '100%',
    paddingLeft: 56,
  },
});
