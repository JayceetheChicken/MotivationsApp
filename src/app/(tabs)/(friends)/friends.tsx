import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import {
  AccountRequiredCta,
  ActiveFriendsList,
  FriendList,
  PlannedSessionCard,
  SharedGoalSummaryCard,
  SocialConnectionsList,
  SocialPrivacyNote,
  SocialQuickActions,
  StudyGroupCard,
  UsernameSearch,
  type FriendStatusViewModel,
  type PlannedSessionViewModel,
  type SharedGoalProgressValues,
  type SharedGoalSummaryViewModel,
  type SocialConnection,
  type SocialUserSummary,
  type StudyGroupViewModel,
  type UsernameSearchResult as SearchResultView,
} from '@/components/social';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  ChallengeParticipant,
  ChallengeParticipantProgress,
  FriendOverview,
  FriendSearchResult,
  FriendshipConnection,
  SharedGoalProgress,
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

function toFriendView(overview: FriendOverview): FriendStatusViewModel {
  return {
    user: toSocialUser(overview.friend),
    status: overview.learningStatus,
    activeSince: overview.activeSince,
    lastStudyAt: overview.lastStudyAt,
    weekMinutes: overview.weekMinutes,
    streakDays: overview.streakDays,
  };
}

function participantUser(
  participant: ChallengeParticipant,
  currentUser: StudyUser | null,
  connections: readonly FriendshipConnection[],
): SocialUserSummary {
  if (currentUser?.id === participant.userId) return toSocialUser(currentUser);
  if (participant.user) return toSocialUser(participant.user);
  const connection = connections.find((item) => item.otherUser.id === participant.userId);
  return connection
    ? toSocialUser(connection.otherUser)
    : { id: participant.userId, username: 'mitglied', displayName: 'Teilnehmer' };
}

function progressValues(
  participant: ChallengeParticipantProgress | undefined,
): SharedGoalProgressValues | null {
  if (!participant || participant.target === null || participant.progressPercent === null ||
      participant.remaining === null || participant.achieved === null || participant.exceededBy === null) {
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

function overallProgress(progress: SharedGoalProgress | undefined): SharedGoalProgressValues | null {
  if (!progress) return null;
  const value = progress.overall;
  return {
    value: value.contribution,
    target: value.target,
    percent: value.progressPercent,
    remaining: value.remaining,
    reached: value.achieved,
    exceeded: value.exceededBy,
  };
}

function formatGoalCadence(goal: StudyChallenge): string {
  return goal.cadence === 'daily' ? 'Tagesziel' : 'Wochenziel';
}

function remainingLabel(endsAt: string, now = Date.now()): string {
  const remainingMs = Date.parse(endsAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Zeitraum beendet';
  const remainingHours = Math.ceil(remainingMs / 3_600_000);
  return remainingHours < 48
    ? `Noch ${remainingHours} ${remainingHours === 1 ? 'Stunde' : 'Stunden'}`
    : `Noch ${Math.ceil(remainingHours / 24)} Tage`;
}

function formatNextSession(startsAt: string | undefined): string {
  if (!startsAt) return 'Keine geplant';
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return 'Keine geplant';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function FriendsScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const currentTime = useCurrentDate();
  const { width } = useWindowDimensions();
  const {
    data,
    socialLoading,
    socialError,
    friendConnections,
    friendOverviews,
    studyGroups,
    sharedStudySessions,
    sharedGoalProgressById,
    refreshSocial,
    findFriendByUsername,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriendship,
  } = useStudyStore();
  const [showFriendSearch, setShowFriendSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<FriendSearchResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const twoColumns = width >= theme.layout.tabletBreakpoint;

  const refresh = useCallback(async () => {
    if (auth.activeMode !== 'supabase') return;
    setActionError(null);
    try {
      await refreshSocial();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Die Freundesübersicht konnte nicht aktualisiert werden.');
    }
  }, [auth.activeMode, refreshSocial]);

  useEffect(() => {
    const refreshTask = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(refreshTask);
  }, [refresh]);

  useEffect(() => {
    if (auth.activeMode !== 'supabase') return;
    const heartbeat = setInterval(() => {
      void refreshSocial({ silent: true });
    }, 120_000);
    return () => clearInterval(heartbeat);
  }, [auth.activeMode, refreshSocial]);

  const acceptedConnections = useMemo(
    () => friendConnections.filter((connection) => connection.status === 'accepted'),
    [friendConnections],
  );
  const pendingConnections = useMemo(
    () => friendConnections.flatMap((connection) => {
      const mapped = toSocialConnection(connection);
      return mapped && mapped.status !== 'accepted' ? [mapped] : [];
    }),
    [friendConnections],
  );
  const friendViews = useMemo<readonly FriendStatusViewModel[]>(() => {
    const byId = new Map(friendOverviews.map((overview) => [overview.friend.id, toFriendView(overview)]));
    for (const connection of acceptedConnections) {
      if (!byId.has(connection.otherUser.id)) {
        byId.set(connection.otherUser.id, {
          user: toSocialUser(connection.otherUser),
          status: 'not_learned_today',
          activeSince: null,
          lastStudyAt: null,
          weekMinutes: null,
          streakDays: null,
        });
      }
    }
    return [...byId.values()];
  }, [acceptedConnections, friendOverviews]);
  const openFriend = useCallback((userId: string) => {
    router.push({ pathname: '/(tabs)/(friends)/friend/[user-id]', params: { 'user-id': userId } });
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
      setSearchResult(await findFriendByUsername(searchResult.user.username));
      await refreshSocial();
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Die Aktion konnte nicht abgeschlossen werden.');
      setSearchStatus('error');
    } finally {
      setPendingConnectionId(null);
    }
  }, [acceptFriendRequest, findFriendByUsername, openFriend, refreshSocial, searchResult, sendFriendRequest]);

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
      setActionError(error instanceof Error ? error.message : 'Die Freundschaftsaktion konnte nicht abgeschlossen werden.');
    } finally {
      setPendingConnectionId(null);
    }
  }, [acceptFriendRequest, declineFriendRequest, refreshSocial, removeFriendship]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Deine Lerndaten bleiben im Gastmodus vollständig auf diesem Gerät."
          eyebrow="Freiwillig verbinden"
          title="Freunde & gemeinsam lernen"
        />
        <AccountRequiredCta loading={auth.loading} onRegister={() => router.push('/register')} onSignIn={() => router.push('/login')} />
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
  const goalViews: readonly SharedGoalSummaryViewModel[] = data.challenges.map((goal) => {
    const progress = sharedGoalProgressById[goal.id];
    const ownParticipant = progress?.participants.find((participant) => participant.userId === data.currentUser?.id);
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      targetType: goal.target.type,
      periodLabel: formatGoalCadence(goal),
      remainingLabel: remainingLabel(goal.endsAt),
      participants: goal.participants
        .filter((participant) => participant.status === 'accepted')
        .map((participant) => participantUser(participant, data.currentUser, friendConnections)),
      ownProgress: progressValues(ownParticipant),
      teamProgress: overallProgress(progress),
    };
  });
  const sessionViews: readonly PlannedSessionViewModel[] = sharedStudySessions
    .filter((session) => session.status === 'planned' || session.status === 'active')
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      plannedDurationMinutes: session.plannedDurationMinutes,
      status: session.status,
      participants: session.participants
        .filter((participant) => !['declined', 'left'].includes(participant.status))
        .map((participant) => toSocialUser(participant.user)),
    }));
  const groupViews: readonly StudyGroupViewModel[] = studyGroups
    .filter((group) => group.members.some(
      (member) => member.userId === data.currentUser?.id && ['accepted', 'invited'].includes(member.status),
    ))
    .map((group) => {
      const next = sharedStudySessions
        .filter((session) => session.groupId === group.id && (session.status === 'planned' || session.status === 'active'))
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];
      return {
        id: group.id,
        name: group.name,
        icon: group.icon,
        imageUrl: group.imageUrl,
        memberCount: group.members.filter((member) => member.status === 'accepted').length,
        activeGoalCount: data.challenges.filter((goal) => goal.groupId === group.id && goal.status === 'active').length,
        nextSessionAt: next?.startsAt ?? null,
      };
    });
  const nextSession = sessionViews[0];
  const activeGoalCount = data.challenges.filter((goal) => goal.status === 'active').length;

  return (
    <Screen
      refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={socialLoading} tintColor={theme.colors.primary} />}>
      <SectionHeader
        description="Gemeinsame Ziele und Fokuszeiten motivieren – ohne private Fächer, Aufgaben oder Notizen offenzulegen."
        eyebrow="Gemeinsam dranbleiben"
        title="Deine Freundesübersicht"
      />

      {(actionError || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{actionError ?? socialError}</Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.overviewCard} variant="highlight">
        <View style={styles.overviewHeader}>
          <View style={styles.overviewCopy}>
            <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Gemeinsam fällt Anfangen leichter</Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Ein ruhiger Überblick über eure gemeinsamen Lernmomente.</Text>
          </View>
          {socialLoading && friendViews.length === 0 ? <ActivityIndicator color={theme.colors.primary} /> : null}
        </View>
        <View style={styles.overviewFacts}>
          <View style={styles.overviewFact}>
            <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.text }]}>{friendViews.length}</Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Freunde</Text>
          </View>
          <View style={styles.overviewFact}>
            <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.success }]}>{friendViews.filter((friend) => friend.status === 'learning_now').length}</Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>lernen gerade</Text>
          </View>
          <View style={styles.overviewFact}>
            <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.accentOlive }]}>{activeGoalCount}</Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>aktive Ziele</Text>
          </View>
          <View style={[styles.overviewFact, styles.nextFact]}>
            <Text numberOfLines={1} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{formatNextSession(nextSession?.startsAt)}</Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>nächste Session</Text>
          </View>
        </View>
      </AppCard>

      <SocialQuickActions
        onAddFriend={() => setShowFriendSearch((visible) => !visible)}
        onCreateGroup={() => router.push('/(tabs)/(friends)/group/create')}
        onStartSession={() => router.push('/(tabs)/(friends)/shared-session/create')}
      />

      {showFriendSearch ? (
        <AppCard padding="lg" style={styles.searchCard}>
          <SectionHeader
            description="Die Suche ist absichtlich exakt. Es gibt kein öffentliches Personenverzeichnis."
            title="Per @Benutzername hinzufügen"
          />
          <UsernameSearch
            actionLabel={searchActionLabel}
            actionState={pendingConnectionId ? 'loading' : 'idle'}
            errorMessage={searchError ?? undefined}
            onOpenProfile={mappedSearchResult?.relationship === 'accepted' && searchResult ? () => openFriend(searchResult.user.id) : undefined}
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
      ) : null}

      {pendingConnections.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader description="Anfragen sind nur für die beteiligten Personen sichtbar." title="Offene Anfragen" />
          <SocialConnectionsList
            connections={pendingConnections}
            onAccept={(connection) => void runConnectionAction(connection, 'accept')}
            onDecline={(connection) => void runConnectionAction(connection, 'decline')}
            pendingActionId={pendingConnectionId}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader description="Wer gerade lernt, steht zuerst – ganz ohne Rangliste." title="Aktive Freunde" />
        <ActiveFriendsList friends={friendViews} maxItems={6} now={currentTime} onOpenFriend={(friend) => openFriend(friend.user.id)} />
      </View>

      <View style={[styles.dashboardColumns, twoColumns ? styles.dashboardColumnsWide : undefined]}>
        <View style={styles.dashboardColumn}>
          <SectionHeader
            actionLabel={acceptedConnections.length > 0 ? 'Neues Ziel' : undefined}
            description="Gezählt wird nur die Dauer, die ausdrücklich dem gemeinsamen Ziel zugeordnet ist."
            onActionPress={acceptedConnections.length > 0 ? () => router.push('/(tabs)/(friends)/shared-goal/create') : undefined}
            title="Gemeinsame Ziele"
          />
          {goalViews.length === 0 ? (
            <EmptyState compact message="Erstellt ein Tages- oder Wochenziel und motiviert euch gegenseitig." symbol="◎" title="Noch kein gemeinsames Ziel" />
          ) : (
            <View style={styles.cardList}>
              {goalViews.map((goal) => (
                <SharedGoalSummaryCard
                  goal={goal}
                  key={goal.id}
                  onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-goal/[goal-id]', params: { 'goal-id': goal.id } })}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.dashboardColumn}>
          <SectionHeader
            actionLabel={acceptedConnections.length > 0 ? 'Planen' : undefined}
            description="Gemeinsamer Timer und Status – die eigene Aufgabe bleibt privat."
            onActionPress={acceptedConnections.length > 0 ? () => router.push('/(tabs)/(friends)/shared-session/create') : undefined}
            title="Geplante Sessions"
          />
          {sessionViews.length === 0 ? (
            <EmptyState compact message="Plant eine Fokuszeit oder startet direkt zusammen." symbol="◷" title="Keine Session geplant" />
          ) : (
            <View style={styles.cardList}>
              {sessionViews.map((session) => (
                <PlannedSessionCard
                  key={session.id}
                  onJoin={() => router.push({ pathname: '/(tabs)/(friends)/shared-session/[session-id]', params: { 'session-id': session.id } })}
                  onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-session/[session-id]', params: { 'session-id': session.id } })}
                  session={session}
                />
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          actionLabel={acceptedConnections.length > 0 ? 'Neue Gruppe' : undefined}
          description="Gruppen zeigen ausschließlich gemeinsame Gruppeninhalte – keinen privaten Aktivitätsfeed."
          onActionPress={acceptedConnections.length > 0 ? () => router.push('/(tabs)/(friends)/group/create') : undefined}
          title="Lerngruppen"
        />
        {groupViews.length === 0 ? (
          <EmptyState compact message="Bündelt Ziele und geplante Sessions in einer privaten Lerngruppe." symbol="◉" title="Noch keine Lerngruppe" />
        ) : (
          <View style={styles.grid}>
            {groupViews.map((group) => (
              <View key={group.id} style={twoColumns ? styles.gridCellWide : styles.gridCell}>
                <StudyGroupCard
                  group={group}
                  onPress={() => router.push({ pathname: '/(tabs)/(friends)/group/[group-id]', params: { 'group-id': group.id } })}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader description="Wochenlernzeit und Streak sind bewusst kompakt gehalten." title="Alle Freunde" />
        <FriendList friends={friendViews} now={currentTime} onOpenFriend={(friend) => openFriend(friend.user.id)} />
      </View>

      <SocialPrivacyNote />

    </Screen>
  );
}

const styles = StyleSheet.create({
  overviewCard: { width: '100%', gap: 20 },
  overviewHeader: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  overviewCopy: { minWidth: 0, flex: 1, gap: 4 },
  overviewFacts: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  overviewFact: { minWidth: 112, flex: 1, gap: 2 },
  nextFact: { minWidth: 170, justifyContent: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  searchCard: { width: '100%', gap: 18 },
  section: { width: '100%', gap: 16 },
  dashboardColumns: { width: '100%', gap: 24 },
  dashboardColumnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  dashboardColumn: { minWidth: 0, flex: 1, gap: 16 },
  cardList: { width: '100%', gap: 14 },
  grid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 16 },
  gridCell: { width: '100%' },
  gridCellWide: { minWidth: 320, flexBasis: '47%', flexGrow: 1 },
});
