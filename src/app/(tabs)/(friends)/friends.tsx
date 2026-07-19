import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import {
  AccountRequiredCta,
  SharedGoalCard,
  SocialConnectionsList,
  UsernameSearch,
  type SharedGoalParticipantProgress,
  type SocialConnection,
  type SocialUserSummary,
  type UsernameSearchResult as SearchResultView,
} from '@/components/social';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  FriendSearchResult,
  FriendshipConnection,
  StudyChallenge,
  StudyUser,
} from '@/types/study';

function toSocialUser(user: StudyUser): SocialUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

function toSocialConnection(connection: FriendshipConnection): SocialConnection | null {
  if (connection.status === 'declined') return null;

  return {
    id: connection.id,
    user: toSocialUser(connection.otherUser),
    status: connection.status === 'accepted'
      ? 'accepted'
      : connection.direction === 'incoming'
        ? 'pending_received'
        : 'pending_sent',
  };
}

function toSearchResult(result: FriendSearchResult): SearchResultView {
  const relationship = !result.connection || result.connection.status === 'declined'
    ? 'none'
    : result.connection.status === 'accepted'
      ? 'accepted'
      : result.connection.direction === 'incoming'
        ? 'pending_received'
        : 'pending_sent';

  return { user: toSocialUser(result.user), relationship };
}

function targetValue(challenge: StudyChallenge): number {
  return challenge.target.type === 'duration'
    ? challenge.target.targetMinutes
    : challenge.target.targetSessions;
}

function formatGoalPeriod(challenge: StudyChallenge): string {
  const startsAt = new Date(challenge.startsAt);
  const endsAt = new Date(challenge.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    return 'Fester Zeitraum';
  }

  const formatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
  return `${formatter.format(startsAt)}–${formatter.format(endsAt)}`;
}

function participantUser(
  userId: string,
  currentUser: StudyUser | null,
  connections: readonly FriendshipConnection[],
): SocialUserSummary {
  if (currentUser?.id === userId) return toSocialUser(currentUser);
  const connection = connections.find((item) => item.otherUser.id === userId);
  if (connection) return toSocialUser(connection.otherUser);
  return { id: userId, username: 'mitglied', displayName: 'Teilnehmer' };
}

function challengeParticipants(
  challenge: StudyChallenge,
  currentUser: StudyUser | null,
  connections: readonly FriendshipConnection[],
): readonly SharedGoalParticipantProgress[] {
  return challenge.participants.map((participant) => ({
    user: participantUser(participant.userId, currentUser, connections),
    status: participant.status,
    // Contributions are never read from the mutable challenge projection.
    // The detail route replaces this placeholder with the progress RPC result.
    contribution: null,
  }));
}

export default function FriendsScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const { width } = useWindowDimensions();
  const {
    data,
    privacy,
    setFriendComparisonsEnabled,
    socialLoading,
    socialError,
    friendConnections,
    refreshSocial,
    findFriendByUsername,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriendship,
    respondSharedGoalInvitation,
  } = useStudyStore();
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<FriendSearchResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const [pendingGoalId, setPendingGoalId] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const isTablet = width >= theme.layout.tabletBreakpoint;

  const refresh = useCallback(async () => {
    if (auth.activeMode !== 'supabase') return;
    try {
      await refreshSocial();
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : 'Die Social-Daten konnten nicht aktualisiert werden.');
    }
  }, [auth.activeMode, refreshSocial]);

  useEffect(() => {
    const refreshTask = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(refreshTask);
  }, [refresh]);

  const connections = useMemo(
    () => friendConnections.flatMap((connection) => {
      const mapped = toSocialConnection(connection);
      return mapped ? [mapped] : [];
    }),
    [friendConnections],
  );
  const acceptedConnections = useMemo(
    () => friendConnections.filter((connection) => connection.status === 'accepted'),
    [friendConnections],
  );

  const openFriend = useCallback((userId: string) => {
    router.push({
      pathname: '/(tabs)/(friends)/friend/[user-id]',
      params: { 'user-id': userId },
    });
  }, []);

  const runSearch = useCallback(async () => {
    const normalized = query.trim().replace(/^@/, '').toLowerCase();
    if (normalized.length < 3) return;
    const generation = ++searchGeneration.current;

    setSearchStatus('loading');
    setSearchError(null);
    try {
      const result = await findFriendByUsername(normalized);
      if (generation !== searchGeneration.current) return;
      setSearchResult(result);
      setSearchStatus('ready');
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      setSearchResult(null);
      setSearchError(error instanceof Error ? error.message : 'Die Suche ist gerade nicht möglich.');
      setSearchStatus('error');
    }
  }, [findFriendByUsername, query]);

  const handleSearchAction = useCallback(async () => {
    if (!searchResult) return;
    const connection = searchResult.connection;
    setPendingConnectionId(connection?.id ?? searchResult.user.id);
    setSearchError(null);
    try {
      if (connection?.status === 'pending' && connection.direction === 'incoming') {
        await acceptFriendRequest(connection.id);
      } else if (connection?.status === 'accepted') {
        openFriend(searchResult.user.id);
        return;
      } else if (!connection || connection.status === 'declined') {
        await sendFriendRequest(searchResult.user.username);
      }
      const updatedResult = await findFriendByUsername(searchResult.user.username);
      setSearchResult(updatedResult);
      await refreshSocial();
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Die Aktion konnte nicht abgeschlossen werden.');
      setSearchStatus('error');
    } finally {
      setPendingConnectionId(null);
    }
  }, [
    acceptFriendRequest,
    findFriendByUsername,
    openFriend,
    refreshSocial,
    searchResult,
    sendFriendRequest,
  ]);

  const runConnectionAction = useCallback(async (
    connection: SocialConnection,
    action: 'accept' | 'decline' | 'remove',
  ) => {
    setPendingConnectionId(connection.id);
    setActionError(null);
    try {
      if (action === 'accept') await acceptFriendRequest(connection.id);
      if (action === 'decline') await declineFriendRequest(connection.id);
      if (action === 'remove') await removeFriendship(connection.id);
      await refreshSocial();
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : 'Die Freundschaftsaktion konnte nicht abgeschlossen werden.');
    } finally {
      setPendingConnectionId(null);
    }
  }, [acceptFriendRequest, declineFriendRequest, refreshSocial, removeFriendship]);

  const respondToGoal = useCallback(async (goalId: string, accept: boolean) => {
    setPendingGoalId(goalId);
    setActionError(null);
    try {
      await respondSharedGoalInvitation(goalId, accept);
      await refreshSocial();
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : 'Die Einladung konnte nicht beantwortet werden.');
    } finally {
      setPendingGoalId(null);
    }
  }, [refreshSocial, respondSharedGoalInvitation]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Deine Lerndaten bleiben im Gastmodus vollständig auf diesem Gerät."
          eyebrow="Freiwillig verbinden"
          title="Freunde & gemeinsame Ziele"
        />
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  const mappedSearchResult = searchResult ? toSearchResult(searchResult) : null;
  const searchActionLabel = mappedSearchResult?.relationship === 'none'
    ? 'Anfragen'
    : mappedSearchResult?.relationship === 'pending_received'
      ? 'Annehmen'
      : mappedSearchResult?.relationship === 'accepted'
        ? 'Profil ansehen'
        : undefined;

  return (
    <Screen
      refreshControl={(
        <RefreshControl
          onRefresh={() => void refresh()}
          refreshing={socialLoading}
          tintColor={theme.colors.primary}
        />
      )}>
      <SectionHeader
        description="Finde Personen eindeutig per Benutzername und teile nur die Statistiken, die du ausdrücklich freigibst."
        eyebrow="Privat verbunden"
        title="Freunde"
      />

      {(actionError || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {actionError ?? socialError}
          </Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.searchCard}>
        <SectionHeader
          description="Die Suche ist absichtlich exakt. Es gibt kein öffentliches Personenverzeichnis."
          title="Per @Benutzername suchen"
        />
        <UsernameSearch
          actionLabel={searchActionLabel}
          actionState={pendingConnectionId ? 'loading' : 'idle'}
          errorMessage={searchError ?? undefined}
          onOpenProfile={mappedSearchResult?.relationship === 'accepted' && searchResult
            ? () => openFriend(searchResult.user.id)
            : undefined}
          onQueryChange={(value) => {
            searchGeneration.current += 1;
            setQuery(value);
            setSearchResult(null);
            setSearchError(null);
            setSearchStatus('idle');
          }}
          onResultAction={searchActionLabel ? () => void handleSearchAction() : undefined}
          onSubmit={() => void runSearch()}
          query={query}
          result={mappedSearchResult}
          status={searchStatus}
        />
      </AppCard>

      <AppCard padding="lg" variant="subtle">
        <View style={styles.privacyRow}>
          <View style={styles.privacyCopy}>
            <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>
              Freundesvergleiche auf diesem Gerät
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Dieser lokale Schalter blendet Statistiken aus. Deine serverseitigen Freigaben bleiben unverändert.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Freundesvergleiche auf diesem Gerät anzeigen"
            ios_backgroundColor={theme.colors.track}
            onValueChange={setFriendComparisonsEnabled}
            thumbColor={privacy.friendComparisonsEnabled ? theme.colors.primary : theme.colors.textSubtle}
            trackColor={{ false: theme.colors.track, true: theme.colors.primaryMuted }}
            value={privacy.friendComparisonsEnabled}
          />
        </View>
      </AppCard>

      <View style={[styles.columns, isTablet ? styles.columnsTablet : undefined]}>
        <View style={styles.column}>
          <SectionHeader
            description="Anfragen und bestätigte Freundschaften sind nur für die Beteiligten sichtbar."
            title="Verbindungen"
          />
          {socialLoading && connections.length === 0 ? (
            <AppCard style={styles.loadingCard} variant="subtle">
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Verbindungen werden geladen …</Text>
            </AppCard>
          ) : (
            <SocialConnectionsList
              connections={connections}
              onAccept={(connection) => void runConnectionAction(connection, 'accept')}
              onDecline={(connection) => void runConnectionAction(connection, 'decline')}
              onOpenProfile={(connection) => {
                if (connection.status === 'accepted') openFriend(connection.user.id);
              }}
              onRemove={(connection) => void runConnectionAction(connection, 'remove')}
              pendingActionId={pendingConnectionId}
            />
          )}
        </View>

        <View style={styles.column}>
          <SectionHeader
            actionLabel={acceptedConnections.length > 0 ? 'Neues Ziel' : undefined}
            description="Beiträge werden aus tatsächlich zugeordneten Sessions berechnet."
            onActionPress={acceptedConnections.length > 0
              ? () => router.push('/(tabs)/(friends)/shared-goal/create')
              : undefined}
            title="Gemeinsame Lernziele"
          />
          {data.challenges.length === 0 ? (
            <EmptyState
              compact
              message={acceptedConnections.length === 0
                ? 'Verbinde dich zuerst mit mindestens einem Freund.'
                : 'Erstellt ein Ziel pro Person oder ein gemeinsames Teamziel.'}
              symbol="◎"
              title="Noch kein gemeinsames Ziel"
            />
          ) : (
            <View style={styles.challengeList}>
              {data.challenges.map((challenge) => {
                const participants = challengeParticipants(challenge, data.currentUser, friendConnections);
                const target = targetValue(challenge);
                const currentParticipant = challenge.participants.find(
                  (participant) => participant.userId === data.currentUser?.id,
                );
                return (
                  <SharedGoalCard
                    description={challenge.description}
                    invitationActionState={pendingGoalId === challenge.id ? 'loading' : 'idle'}
                    key={challenge.id}
                    mode={challenge.target.mode}
                    onAcceptInvitation={currentParticipant?.status === 'invited'
                      ? () => void respondToGoal(challenge.id, true)
                      : undefined}
                    onDeclineInvitation={currentParticipant?.status === 'invited'
                      ? () => void respondToGoal(challenge.id, false)
                      : undefined}
                    onOpenParticipant={(participant) => {
                      if (acceptedConnections.some(
                        (connection) => connection.otherUser.id === participant.user.id,
                      )) {
                        openFriend(participant.user.id);
                      }
                    }}
                    onPress={() => router.push({
                      pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
                      params: { 'goal-id': challenge.id },
                    })}
                    participants={participants}
                    periodLabel={formatGoalPeriod(challenge)}
                    status={challenge.status}
                    target={target}
                    targetType={challenge.target.type}
                    title={challenge.title}
                  />
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchCard: { width: '100%', gap: 18 },
  privacyRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  privacyCopy: { flex: 1, minWidth: 0, gap: 4 },
  columns: { width: '100%', gap: 24 },
  columnsTablet: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { minWidth: 0, flex: 1, gap: 16 },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 12 },
  challengeList: { width: '100%', gap: 16 },
});
