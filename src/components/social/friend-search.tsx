import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';

import type { SocialActionState, SocialUserSummary } from './types';

export type FriendSearchRelationship =
  | 'none'
  | 'pending_sent'
  | 'pending_received'
  | 'accepted';

export type FriendSearchViewResult = Readonly<{
  user: SocialUserSummary;
  relationship: FriendSearchRelationship;
}>;

const RELATIONSHIP_LABELS: Readonly<Record<FriendSearchRelationship, string>> = {
  none: 'Noch nicht verbunden',
  pending_sent: 'Anfrage gesendet',
  pending_received: 'Anfrage erhalten',
  accepted: 'Bereits befreundet',
};

export type FriendSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  result?: FriendSearchViewResult | null;
  status?: 'idle' | 'loading' | 'error' | 'ready';
  errorMessage?: string;
  actionLabel?: string;
  actionState?: SocialActionState;
  onResultAction?: () => void;
};

export function FriendSearch({
  query,
  onQueryChange,
  onSubmit,
  result,
  status = 'idle',
  errorMessage,
  actionLabel,
  actionState = 'idle',
  onResultAction,
}: FriendSearchProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const useRow = width >= theme.layout.phoneBreakpoint;
  const isLoading = status === 'loading';
  const canSearch = query.trim().replace(/^@/, '').length >= 3 && !isLoading;

  return (
    <View style={styles.container}>
      <View style={[styles.controls, useRow ? styles.controlsWide : undefined]}>
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
            editable={!isLoading}
            enterKeyHint="search"
            maxLength={31}
            onChangeText={(value) => onQueryChange(value.replace(/^@/, '').slice(0, 30))}
            onSubmitEditing={() => {
              if (canSearch) onSubmit();
            }}
            placeholder="benutzername"
            placeholderTextColor={theme.colors.textSubtle}
            returnKeyType="search"
            style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
            value={query.replace(/^@/, '')}
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
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
          {errorMessage ?? 'Die Suche ist gerade nicht möglich.'}
        </Text>
      ) : status === 'ready' && !result ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          Kein Profil mit diesem Benutzernamen gefunden.
        </Text>
      ) : result ? (
        <AppCard
          accessibilityLabel={`${result.user.displayName}, @${result.user.username}, ${RELATIONSHIP_LABELS[result.relationship]}`}
          accessibilityLiveRegion="polite"
          padding="sm"
          style={styles.result}
          variant="outlined">
          <Avatar
            name={result.user.displayName}
            size="md"
            source={result.user.avatarUrl ? { uri: result.user.avatarUrl } : undefined}
          />
          <View style={styles.resultCopy}>
            <Text
              numberOfLines={1}
              selectable
              style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
              {result.user.displayName}
            </Text>
            <Text
              numberOfLines={1}
              selectable
              style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              @{result.user.username} · {RELATIONSHIP_LABELS[result.relationship]}
            </Text>
          </View>
          {actionLabel && onResultAction ? (
            <AppButton
              disabled={actionState === 'disabled'}
              label={actionLabel}
              loading={actionState === 'loading'}
              onPress={onResultAction}
              size="compact"
              variant={result.relationship === 'none' ? 'primary' : 'outline'}
            />
          ) : null}
        </AppCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: 12 },
  controls: { width: '100%', gap: 10 },
  controlsWide: { flexDirection: 'row', alignItems: 'stretch' },
  inputShell: {
    minHeight: 52,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  input: { minWidth: 0, flex: 1, paddingVertical: 10 },
  searchButtonWide: { minWidth: 112 },
  result: {
    width: '100%',
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  resultCopy: { minWidth: 120, flex: 1, gap: 2 },
});
