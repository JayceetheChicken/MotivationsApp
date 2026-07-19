import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';

import type {
  SocialActionState,
  UsernameSearchRelationship,
  UsernameSearchResult,
} from './types';

const RELATIONSHIP_LABELS: Readonly<Record<UsernameSearchRelationship, string>> = {
  none: 'Noch nicht verbunden',
  pending_sent: 'Anfrage gesendet',
  pending_received: 'Anfrage erhalten',
  accepted: 'Bereits befreundet',
};

export type UsernameSearchResultCardProps = {
  result: UsernameSearchResult;
  actionLabel?: string;
  actionState?: SocialActionState;
  onAction?: () => void;
  onOpenProfile?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function UsernameSearchResultCard({
  result,
  actionLabel,
  actionState = 'idle',
  onAction,
  onOpenProfile,
  style,
}: UsernameSearchResultCardProps) {
  const theme = useAppTheme();
  const { user, relationship } = result;

  return (
    <AppCard
      accessibilityLabel={`${user.displayName}, @${user.username}, ${RELATIONSHIP_LABELS[relationship]}`}
      onPress={onOpenProfile}
      padding="sm"
      style={[styles.resultCard, style]}
      variant="outlined">
      <Avatar
        name={user.displayName}
        size="md"
        source={user.avatarUrl ? { uri: user.avatarUrl } : undefined}
      />
      <View style={styles.resultCopy}>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
          {user.displayName}
        </Text>
        <Text
          numberOfLines={1}
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          @{user.username} · {RELATIONSHIP_LABELS[relationship]}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <AppButton
          disabled={actionState === 'disabled'}
          label={actionLabel}
          loading={actionState === 'loading'}
          onPress={(event) => {
            event.stopPropagation();
            onAction();
          }}
          size="compact"
          variant={relationship === 'none' ? 'primary' : 'outline'}
        />
      ) : null}
    </AppCard>
  );
}

export type UsernameSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  result?: UsernameSearchResult | null;
  status?: 'idle' | 'loading' | 'error' | 'ready';
  errorMessage?: string;
  emptyMessage?: string;
  actionLabel?: string;
  actionState?: SocialActionState;
  onResultAction?: () => void;
  onOpenProfile?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function UsernameSearch({
  query,
  onQueryChange,
  onSubmit,
  result,
  status = 'idle',
  errorMessage = 'Die Suche ist gerade nicht möglich. Versuche es erneut.',
  emptyMessage = 'Unter diesem Benutzernamen wurde kein Profil gefunden.',
  actionLabel,
  actionState,
  onResultAction,
  onOpenProfile,
  disabled = false,
  style,
}: UsernameSearchProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const useRow = width >= theme.layout.phoneBreakpoint;
  const isLoading = status === 'loading';
  const canSearch = query.trim().length >= 3 && !disabled && !isLoading;

  return (
    <View style={[styles.search, style]}>
      <View style={[styles.searchControls, useRow ? styles.searchControlsWide : undefined]}>
        <View
          style={[
            styles.inputShell,
            {
              backgroundColor: theme.colors.surface,
              borderColor: status === 'error' ? theme.colors.danger : theme.colors.borderStrong,
              borderRadius: theme.radii.lg,
            },
          ]}>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[theme.typography.bodyMedium, { color: theme.colors.textMuted }]}>
            @
          </Text>
          <TextInput
            accessibilityLabel="Eindeutigen Benutzernamen suchen"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled && !isLoading}
            enterKeyHint="search"
            maxLength={30}
            onChangeText={onQueryChange}
            onSubmitEditing={() => {
              if (canSearch) onSubmit();
            }}
            placeholder="benutzername"
            placeholderTextColor={theme.colors.textSubtle}
            returnKeyType="search"
            style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
            value={query}
          />
          {isLoading ? <ActivityIndicator color={theme.colors.primary} size="small" /> : null}
        </View>
        <AppButton
          disabled={!canSearch}
          label="Suchen"
          loading={isLoading}
          onPress={onSubmit}
          style={useRow ? styles.searchButtonWide : undefined}
        />
      </View>

      {status === 'error' ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
          {errorMessage}
        </Text>
      ) : status === 'ready' && !result ? (
        <AppCard padding="sm" variant="subtle">
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {emptyMessage}
          </Text>
        </AppCard>
      ) : result ? (
        <UsernameSearchResultCard
          actionLabel={actionLabel}
          actionState={actionState}
          onAction={onResultAction}
          onOpenProfile={onOpenProfile}
          result={result}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    width: '100%',
    gap: 14,
  },
  searchControls: {
    width: '100%',
    gap: 10,
  },
  searchControlsWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  inputShell: {
    minHeight: 52,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  input: {
    minWidth: 0,
    flex: 1,
    paddingVertical: 10,
  },
  searchButtonWide: {
    minWidth: 128,
  },
  resultCard: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
});
