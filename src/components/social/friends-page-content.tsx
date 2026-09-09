import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  ChallengeParticipantProgress,
  FriendOverview,
  FriendSearchResult,
  FriendshipConnection,
  SharedGoalProgress,
  StudyChallenge,
  StudyUser,
} from '@/types/study';

import { AccountRequiredCta } from './account-required-cta';
import { FriendPresenceRow, resolveFriendPresenceStatus } from './friend-presence-row';
import { FriendRequestRow } from './friend-request-row';
import {
  FriendSearch,
  type FriendSearchRelationship,
  type FriendSearchViewResult,
} from './friend-search';
import { PlannedSessionCard } from './planned-session-card';
import { SharedGoalSummaryCard } from './shared-goal-summary-card';
import type {
  PlannedSessionViewModel,
  SharedGoalProgressValues,
  SharedGoalSummaryViewModel,
  SocialUserSummary,
} from './types';

function socialUser(user: StudyUser): SocialUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

function searchRelationship(result: FriendSearchResult): FriendSearchRelationship {
  if (!result.connection || result.connection.status === 'declined') return 'none';
  if (result.connection.status === 'accepted') return 'accepted';
  return result.connection.direction === 'incoming' ? 'pending_received' : 'pending_sent';
}

function searchView(result: FriendSearchResult): FriendSearchViewResult {
  return { user: socialUser(result.user), relationship: searchRelationship(result) };
}

function individualProgress(
  participant: ChallengeParticipantProgress | undefined,
): SharedGoalProgressValues | null {
  if (
    !participant ||
    participant.target === null ||
    participant.progressPercent === null ||
    participant.remaining === null ||
    participant.achieved === null ||
    participant.exceededBy === null
  ) {
    return null;
  }
  return {
    value: participant.contribution,
    target: participant.target,
    percent: participant.progressPercent,
    remaining: participant.remaining,
    reached: participant.achieved,
    exceeded: participant.exceededBy,
  };
}

function aggregateProgress(progress: SharedGoalProgress): SharedGoalProgressValues {
  return {
    value: progress.overall.contribution,
    target: progress.overall.target,
    percent: progress.overall.progressPercent,
    remaining: progress.overall.remaining,
    reached: progress.overall.achieved,
    exceeded: progress.overall.exceededBy,
  };
}

function goalPeriodLabel(goal: StudyChallenge): string {
  return goal.cadence === 'daily' ? 'Täglich' : 'Wöchentlich';
}

function remainingLabel(endsAt: string | undefined, now: number): string | undefined {
  if (!endsAt) return undefined;
  const remainingMs = Date.parse(endsAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return undefined;
  const hours = Math.ceil(remainingMs / 3_600_000);
  return hours < 48 ? `Noch ${hours} Std.` : `Noch ${Math.ceil(hours / 24)} Tage`;
}

type FriendPresenceProjection = Pick<
  FriendOverview,
  'friend' | 'presenceStatus' | 'lastActiveAt' | 'presenceExpiresAt' | 'onlineExpiresAt'
>;

function safeOfflineOverview(connection: FriendshipConnection): FriendPresenceProjection {
  return {
    friend: connection.otherUser,
    presenceStatus: 'offline',
    lastActiveAt: null,
    presenceExpiresAt: null,
    onlineExpiresAt: null,
  };
}

function activityTimestamp(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function presenceRank(overview: FriendPresenceProjection): number {
  return overview.presenceStatus === 'learning'
    ? 0
    : overview.presenceStatus === 'paused'
      ? 1
      : overview.presenceStatus === 'online'
        ? 2
        : 3;
}

function isRawRealtimeBackendError(message: string | null): boolean {
  return Boolean(message && (
    /MissingPartition|expected messages partition/i.test(message)
    || /Unauthorized.*Channel topic|permissions to read from this Channel/i.test(message)
  ));
}

export function FriendsPageContent() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const now = useCurrentDate(15_000);
  const {
    data,
    socialLoading,
    socialError,
    socialRealtimeUnavailable,
    friendConnections,
    friendOverviews,
    sharedStudySessions,
    sharedGoalProgressById,
    refreshSocial,
    findFriendByUsername,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriendship,
  } = useStudyStore();
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<FriendSearchResult | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const realtimeBackendError = isRawRealtimeBackendError(socialError);
  const visibleSocialError = realtimeBackendError ? null : socialError;

  useFocusEffect(useCallback(() => {
    if (auth.activeMode !== 'supabase') return;
    const initialRefresh = setTimeout(() => void refreshSocial(), 0);
    const interval = setInterval(() => void refreshSocial({ silent: true }), 60_000);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(interval);
    };
  }, [auth.activeMode, refreshSocial]));

  const acceptedConnections = useMemo(
    () => friendConnections.filter((connection) => connection.status === 'accepted'),
    [friendConnections],
  );
  const requests = useMemo(
    () => friendConnections.filter((connection) => connection.status === 'pending'),
    [friendConnections],
  );
  const friends = useMemo(() => {
    const overviewById = new Map(
      friendOverviews.map((overview) => [overview.friend.id, overview]),
    );
    return acceptedConnections
      .map((connection) => ({
        connection,
        overview: overviewById.get(connection.otherUser.id) ?? safeOfflineOverview(connection),
      }))
      .sort((left, right) => {
        const leftStatus = resolveFriendPresenceStatus(left.overview, now);
        const rightStatus = resolveFriendPresenceStatus(right.overview, now);
        const rankDifference = presenceRank({ ...left.overview, presenceStatus: leftStatus })
          - presenceRank({ ...right.overview, presenceStatus: rightStatus });
        if (rankDifference !== 0) return rankDifference;
        const activityDifference = activityTimestamp(right.overview.lastActiveAt)
          - activityTimestamp(left.overview.lastActiveAt);
        if (activityDifference !== 0) return activityDifference;
        return left.overview.friend.displayName.localeCompare(
          right.overview.friend.displayName,
          'de-DE',
        );
      });
  }, [acceptedConnections, friendOverviews, now]);

  const sessionViews = useMemo<readonly PlannedSessionViewModel[]>(() => (
    sharedStudySessions
      .filter((session) => session.status === 'planned' || session.status === 'active')
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
        return Date.parse(left.startsAt) - Date.parse(right.startsAt);
      })
      .map((session) => ({
        id: session.id,
        title: session.title,
        startsAt: session.startsAt,
        plannedDurationMinutes: session.plannedDurationMinutes,
        status: session.status,
        participants: session.participants
          .filter((participant) => ['joined', 'active', 'paused', 'finished'].includes(
            participant.status,
          ))
          .map((participant) => socialUser(participant.user)),
      }))
  ), [sharedStudySessions]);

  const goalViews = useMemo<readonly SharedGoalSummaryViewModel[]>(() => (
    data.challenges.flatMap((goal) => {
      if (goal.status !== 'active' && goal.status !== 'upcoming') return [];
      const progress = sharedGoalProgressById[goal.id];
      const ownParticipant = progress?.participants.find(
        (participant) => participant.userId === data.currentUser?.id,
      );
      return [{
        id: goal.id,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        targetType: goal.target.type,
        periodLabel: goalPeriodLabel(goal),
        remainingLabel: remainingLabel(goal.endsAt, now.getTime()),
        participants: progress
          ? progress.participants
              .filter((participant) => participant.status === 'accepted')
              .map((participant) => socialUser(participant.user))
          : goal.participants.flatMap((participant) => (
              participant.status === 'accepted' && participant.user
                ? [socialUser(participant.user)]
                : []
            )),
        ownProgress: individualProgress(ownParticipant),
        ownContribution: ownParticipant?.contribution,
        teamProgress: progress ? aggregateProgress(progress) : null,
      } satisfies SharedGoalSummaryViewModel];
    })
  ), [data.challenges, data.currentUser?.id, now, sharedGoalProgressById]);

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
    const generation = searchGeneration.current;
    const relationship = searchRelationship(searchResult);
    const pendingId = searchResult.connection?.id ?? searchResult.user.id;
    setPendingConnectionId(pendingId);
    setSearchError(null);
    try {
      if (relationship === 'none') {
        await sendFriendRequest(searchResult.user.username);
      } else if (relationship === 'pending_received' && searchResult.connection) {
        await acceptFriendRequest(searchResult.connection.id);
      }
      const updated = await findFriendByUsername(searchResult.user.username);
      if (generation !== searchGeneration.current) return;
      setSearchResult(updated);
      setSearchStatus('ready');
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      setSearchError(error instanceof Error ? error.message : 'Die Anfrage konnte nicht verarbeitet werden.');
      setSearchStatus('error');
    } finally {
      setPendingConnectionId((current) => current === pendingId ? null : current);
    }
  }, [acceptFriendRequest, findFriendByUsername, searchResult, sendFriendRequest]);

  const respondToRequest = useCallback(async (
    connection: FriendshipConnection,
    accept: boolean,
  ) => {
    setPendingConnectionId(connection.id);
    setActionError(null);
    try {
      if (accept) await acceptFriendRequest(connection.id);
      else await declineFriendRequest(connection.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Die Anfrage konnte nicht verarbeitet werden.');
    } finally {
      setPendingConnectionId((current) => current === connection.id ? null : current);
    }
  }, [acceptFriendRequest, declineFriendRequest]);

  const confirmRemoval = useCallback((connection: FriendshipConnection) => {
    if (removingConnectionId) return;
    Alert.alert(
      'Freund entfernen?',
      `${connection.otherUser.displayName} wird aus deiner Freundesliste entfernt. Gemeinsame Inhalte bleiben nach ihren Teilnehmerregeln geschützt.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            setRemovingConnectionId(connection.id);
            setActionError(null);
            void removeFriendship(connection.id)
              .catch((error: unknown) => setActionError(
                error instanceof Error ? error.message : 'Der Freund konnte nicht entfernt werden.',
              ))
              .finally(() => setRemovingConnectionId(null));
          },
        },
      ],
    );
  }, [removeFriendship, removingConnectionId]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen maxWidth={760}>
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  const mappedSearchResult = searchResult ? searchView(searchResult) : null;
  const searchActionLabel = mappedSearchResult?.relationship === 'none'
    ? 'Hinzufügen'
    : mappedSearchResult?.relationship === 'pending_received'
      ? 'Annehmen'
      : undefined;

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      maxWidth={880}
      refreshControl={(
        <RefreshControl
          onRefresh={() => void refreshSocial()}
          refreshing={socialLoading}
          tintColor={theme.colors.primary}
        />
      )}>
      <AppCard padding="md" style={styles.searchCard}>
        <SectionHeader
          description="Suche exakt nach dem eindeutigen Benutzernamen."
          title="Freunde finden"
        />
        <FriendSearch
          actionLabel={searchActionLabel}
          actionState={pendingConnectionId === (searchResult?.connection?.id ?? searchResult?.user.id)
            ? 'loading'
            : 'idle'}
          errorMessage={searchError ?? undefined}
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
        <View style={styles.createActions}>
          <AppButton
            disabled={acceptedConnections.length === 0}
            fullWidth
            label="Gemeinsames Ziel erstellen"
            onPress={() => router.push('/(tabs)/(friends)/shared-goal/create')}
          />
          <AppButton
            disabled={acceptedConnections.length === 0}
            fullWidth
            label="Gemeinsame Session erstellen"
            onPress={() => router.push('/(tabs)/(friends)/shared-session/create')}
            variant="secondary"
          />
        </View>
      </AppCard>

      {(actionError || (searchStatus !== 'error' && visibleSocialError)) ? (
        <AppCard padding="sm" variant="outlined">
          <Text
            accessibilityRole="alert"
            selectable
            style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {actionError ?? visibleSocialError}
          </Text>
        </AppCard>
      ) : null}

      {(socialRealtimeUnavailable || realtimeBackendError) ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={[theme.typography.caption, { color: theme.colors.textMuted }]}
          testID="social-realtime-unavailable">
          Der Live-Status ist momentan nicht verfügbar. Die Freundesfunktionen können weiterhin verwendet werden.
        </Text>
      ) : null}

      {requests.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Anfragen" />
          <AppCard padding="none" style={styles.list}>
            {requests.map((connection) => (
              <FriendRequestRow
                connection={connection}
                key={connection.id}
                onAccept={() => void respondToRequest(connection, true)}
                onDecline={() => void respondToRequest(connection, false)}
                pending={pendingConnectionId === connection.id}
              />
            ))}
          </AppCard>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title={`Freunde (${friends.length})`} />
        {friends.length === 0 ? (
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Suche oben nach einem Benutzernamen, um Freunde hinzuzufügen.
          </Text>
        ) : (
          <AppCard padding="none" style={styles.list}>
            {friends.map(({ connection, overview }) => (
              <FriendPresenceRow
                key={connection.id}
                now={now}
                onRemove={() => confirmRemoval(connection)}
                overview={{
                  friend: overview.friend,
                  presenceStatus: overview.presenceStatus,
                  lastActiveAt: overview.lastActiveAt,
                  presenceExpiresAt: overview.presenceExpiresAt,
                  onlineExpiresAt: overview.onlineExpiresAt,
                }}
                removing={removingConnectionId === connection.id}
              />
            ))}
          </AppCard>
        )}
      </View>

      {goalViews.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Gemeinsamer Fortschritt" />
          <View style={styles.cardList}>
            {goalViews.map((goal) => (
              <SharedGoalSummaryCard
                goal={goal}
                key={goal.id}
                onPress={() => router.push({
                  pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
                  params: { 'goal-id': goal.id },
                })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {sessionViews.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Gemeinsame Sessions" />
          <View style={styles.cardList}>
            {sessionViews.map((session) => (
              <PlannedSessionCard
                key={session.id}
                onPress={() => router.push({
                  pathname: '/(tabs)/(friends)/shared-session/[session-id]',
                  params: { 'session-id': session.id },
                })}
                session={session}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchCard: { width: '100%', gap: 16 },
  createActions: { width: '100%', gap: 8 },
  section: { width: '100%', gap: 12 },
  list: { width: '100%', overflow: 'hidden' },
  cardList: { width: '100%', gap: 12 },
});
