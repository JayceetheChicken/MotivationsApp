import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { useAppTheme } from '@/theme';

export type SocialQuickActionKey = 'add_friend' | 'create_group' | 'start_session';

export type SocialQuickActionsProps = {
  onAddFriend: () => void;
  onCreateGroup: () => void;
  onStartSession: () => void;
  disabled?: boolean;
  loadingAction?: SocialQuickActionKey | null;
  style?: StyleProp<ViewStyle>;
};

export function SocialQuickActions({
  onAddFriend,
  onCreateGroup,
  onStartSession,
  disabled = false,
  loadingAction = null,
  style,
}: SocialQuickActionsProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const useRow = width >= theme.layout.phoneBreakpoint;

  return (
    <View
      accessibilityLabel="Schnellaktionen für gemeinsames Lernen"
      style={[styles.actions, useRow ? styles.actionsWide : undefined, style]}
      testID="social-quick-actions">
      <AppButton
        accessibilityHint="Öffnet die Suche nach einem eindeutigen Benutzernamen"
        disabled={disabled}
        fullWidth={!useRow}
        label="Freund hinzufügen"
        loading={loadingAction === 'add_friend'}
        onPress={onAddFriend}
        style={useRow ? styles.actionWide : undefined}
        variant="outline"
      />
      <AppButton
        accessibilityHint="Öffnet die Erstellung einer privaten Lerngruppe"
        disabled={disabled}
        fullWidth={!useRow}
        label="Gruppe erstellen"
        loading={loadingAction === 'create_group'}
        onPress={onCreateGroup}
        style={useRow ? styles.actionWide : undefined}
        variant="secondary"
      />
      <AppButton
        accessibilityHint="Startet oder plant eine gemeinsame Lernsession"
        disabled={disabled}
        fullWidth={!useRow}
        label="Gemeinsam lernen"
        loading={loadingAction === 'start_session'}
        onPress={onStartSession}
        style={useRow ? styles.actionWide : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    width: '100%',
    gap: 10,
  },
  actionsWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  actionWide: {
    minWidth: 180,
    flex: 1,
  },
});
