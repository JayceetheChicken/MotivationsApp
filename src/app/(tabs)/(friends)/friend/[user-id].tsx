import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import {
  AccountRequiredCta,
  FriendStatusCard,
  PlannedSessionCard,
  SharedGoalSummaryCard,
  SocialPrivacyNote,
  StudyGroupCard,
  type FriendStatusViewModel,
  type PlannedSessionViewModel,
  type SharedGoalProgressValues,
  type SharedGoalSummaryViewModel,
  type StudyGroupViewModel,
} from '@/components/social';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useCurrentDate } from '@/hooks/use-current-date';
import { formatMinutes } from '@/lib/format';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  ChallengeParticipantProgress,
  FriendOverview,
  SharedGoalProgress,
  StudyUser,
} from '@/types/study';

function singleParam(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function socialUser(user: StudyUser) {
  return { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function friendView(overview: FriendOverview): FriendStatusViewModel {
  return {
    user: socialUser(overview.friend),
    status: overview.learningStatus,
    activeSince: overview.activeSince,
    lastStudyAt: overview.lastStudyAt,
    weekMinutes: overview.weekMinutes,
    streakDays: overview.streakDays,
  };
}

function individualProgress(participant: ChallengeParticipantProgress | undefined): SharedGoalProgressValues | null {
  if (!participant || participant.target === null || participant.progressPercent === null ||
      participant.remaining === null || participant.achieved === null || participant.exceededBy === null) return null;
  return {
    value: participant.contribution,
    target: participant.target,
    percent: participant.progressPercent,
    remaining: participant.remaining,
    reached: participant.achieved,
    exceeded: participant.exceededBy,
  };
}

function teamProgress(progress: SharedGoalProgress | undefined): SharedGoalProgressValues | null {
  if (!progress) return null;
  return {
    value: progress.overall.contribution,
    target: progress.overall.target,
    percent: progress.overall.progressPercent,
    remaining: progress.overall.remaining,
    reached: progress.overall.achieved,
    exceeded: progress.overall.exceededBy,
  };
}

function remainingLabel(endsAt: string): string {
  const hours = Math.ceil((Date.parse(endsAt) - Date.now()) / 3_600_000);
  if (!Number.isFinite(hours) || hours <= 0) return 'Zeitraum beendet';
  return hours < 48 ? `Noch ${hours} Std.` : `Noch ${Math.ceil(hours / 24)} Tage`;
}

export default function FriendProfileScreen() {
  const theme = useAppTheme();
  const currentTime = useCurrentDate();
  const auth = useAuthStore();
  const params = useLocalSearchParams();
  const friendId = singleParam(params['user-id'] as string | readonly string[] | undefined);
  const {
    data,
    socialError,
    friendConnections,
    friendOverviews,
    studyGroups,
    sharedStudySessions,
    sharedGoalProgressById,
    refreshSocial,
    getFriendOverview,
    removeFriendship,
  } = useStudyStore();
  const [overview, setOverview] = useState<FriendOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const connection = useMemo(
    () => friendConnections.find(
      (item) => item.status === 'accepted' && item.otherUser.id === friendId,
    ) ?? null,
    [friendConnections, friendId],
  );
  const cachedOverview = useMemo(
    () => friendOverviews.find((entry) => entry.friend.id === friendId) ?? null,
    [friendId, friendOverviews],
  );
  const currentOverview = overview ?? cachedOverview;

  const load = useCallback(async () => {
    if (auth.activeMode !== 'supabase' || !friendId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getFriendOverview(friendId);
      setOverview(next);
      await refreshSocial();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Das Freundesprofil konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [auth.activeMode, friendId, getFriendOverview, refreshSocial]);

  useEffect(() => {
    const loadTask = setTimeout(() => void load(), 0);
    return () => clearTimeout(loadTask);
  }, [load]);

  useEffect(() => {
    if (auth.activeMode !== 'supabase' || !friendId) return;
    const heartbeat = setInterval(() => {
      void getFriendOverview(friendId).then((next) => {
        if (next) setOverview(next);
      });
    }, 120_000);
    return () => clearInterval(heartbeat);
  }, [auth.activeMode, friendId, getFriendOverview]);

  const confirmRemoval = useCallback(() => {
    if (!connection || removing) return;
    Alert.alert(
      'Freundschaft entfernen?',
      `Du und ${connection.otherUser.displayName} seht danach keine Freundesübersicht mehr. Bereits gemeinsam erstellte Inhalte folgen ihren eigenen Teilnehmerregeln.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            setRemoving(true);
            void removeFriendship(connection.id)
              .then(() => router.replace('/friends'))
              .catch((removeError: unknown) => setError(
                removeError instanceof Error ? removeError.message : 'Die Freundschaft konnte nicht entfernt werden.',
              ))
              .finally(() => setRemoving(false));
          },
        },
      ],
    );
  }, [connection, removeFriendship, removing]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader description="Freundesprofile stehen nur mit einem verbundenen Konto zur Verfügung." title="Freundesprofil" />
        <AccountRequiredCta loading={auth.loading} onRegister={() => router.push('/register')} onSignIn={() => router.push('/login')} />
      </Screen>
    );
  }

  if (!friendId) {
    return <Screen centered><EmptyState message="Der Profil-Link enthält keinen gültigen Benutzer." symbol="?" title="Profil nicht gefunden" /></Screen>;
  }

  if (!currentOverview && !loading) {
    return (
      <Screen centered>
        <EmptyState message={error ?? socialError ?? 'Die Freundschaft besteht nicht mehr oder das Profil ist nicht verfügbar.'} symbol="○" title="Profil nicht verfügbar" />
        <AppButton label="Erneut versuchen" onPress={() => void load()} variant="outline" />
      </Screen>
    );
  }

  const sharedGoals = currentOverview
    ? data.challenges.filter((goal) => currentOverview.sharedGoalIds.includes(goal.id))
    : [];
  const sharedSessions = currentOverview
    ? sharedStudySessions.filter((session) => currentOverview.sharedSessionIds.includes(session.id))
    : [];
  const commonGroups = currentOverview
    ? studyGroups.filter((group) => currentOverview.groupIds.includes(group.id))
    : [];
  const goalViews: readonly SharedGoalSummaryViewModel[] = sharedGoals.map((goal) => {
    const progress = sharedGoalProgressById[goal.id];
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      targetType: goal.target.type,
      periodLabel: goal.cadence === 'daily' ? 'Tagesziel' : 'Wochenziel',
      remainingLabel: remainingLabel(goal.endsAt),
      participants: progress
        ? progress.participants
            .filter((participant) => participant.status === 'accepted')
            .map((participant) => socialUser(participant.user))
        : goal.participants.flatMap((participant) => participant.user ? [socialUser(participant.user)] : []),
      ownProgress: individualProgress(progress?.participants.find((participant) => participant.userId === data.currentUser?.id)),
      teamProgress: teamProgress(progress),
    };
  });
  const sessionViews: readonly PlannedSessionViewModel[] = sharedSessions.map((session) => ({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt,
    plannedDurationMinutes: session.plannedDurationMinutes,
    status: session.status,
    participants: session.participants
      .filter((participant) => !['declined', 'left'].includes(participant.status))
      .map((participant) => socialUser(participant.user)),
  }));
  const groupViews: readonly StudyGroupViewModel[] = commonGroups.map((group) => {
    const nextSession = sharedStudySessions
      .filter((session) => session.groupId === group.id && ['planned', 'active'].includes(session.status))
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];
    return {
      id: group.id,
      name: group.name,
      icon: group.icon,
      imageUrl: group.imageUrl,
      memberCount: group.members.filter((member) => member.status === 'accepted').length,
      activeGoalCount: data.challenges.filter((goal) => goal.groupId === group.id && goal.status === 'active').length,
      nextSessionAt: nextSession?.startsAt ?? null,
    };
  });

  return (
    <Screen refreshControl={<RefreshControl onRefresh={() => void load()} refreshing={loading} tintColor={theme.colors.primary} />}>
      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error ?? socialError}</Text>
        </AppCard>
      ) : null}

      {currentOverview ? (
        <>
          <FriendStatusCard friend={friendView(currentOverview)} now={currentTime} showMetrics={false} />

          <View style={styles.metrics}>
            <AppCard padding="lg" style={styles.metricCard} variant="subtle">
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Diese Woche</Text>
              <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(currentOverview.weekMinutes, true)}</Text>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>gesamte Lernzeit</Text>
            </AppCard>
            <AppCard padding="lg" style={styles.metricCard} variant="subtle">
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Aktueller Streak</Text>
              <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.accentOlive }]}>{currentOverview.streakDays}</Text>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{currentOverview.streakDays === 1 ? 'Tag' : 'Tage'}</Text>
            </AppCard>
          </View>
        </>
      ) : null}

      <View style={styles.section}>
        <SectionHeader description="Nur Ziele, an denen ihr beide teilnehmt." title="Gemeinsame Ziele" />
        {goalViews.length === 0 ? (
          <EmptyState compact message="Ihr habt aktuell kein gemeinsames Lernziel." symbol="◎" title="Keine gemeinsamen Ziele" />
        ) : (
          <View style={styles.list}>{goalViews.map((goal) => (
            <SharedGoalSummaryCard goal={goal} key={goal.id} onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-goal/[goal-id]', params: { 'goal-id': goal.id } })} />
          ))}</View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader description="Gemeinsam geplante und vergangene Fokuszeiten – ohne private Aufgaben." title="Gemeinsame Sessions" />
        {sessionViews.length === 0 ? (
          <EmptyState compact message="Ihr habt noch keine gemeinsame Lern-Session." symbol="◷" title="Keine gemeinsamen Sessions" />
        ) : (
          <View style={styles.list}>{sessionViews.map((session) => (
            <PlannedSessionCard key={session.id} onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-session/[session-id]', params: { 'session-id': session.id } })} session={session} />
          ))}</View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader description="Nur Gruppen, in denen ihr beide Mitglied seid." title="Gemeinsame Gruppen" />
        {groupViews.length === 0 ? (
          <EmptyState compact message="Ihr seid aktuell in keiner gemeinsamen Lerngruppe." symbol="◉" title="Keine gemeinsame Gruppe" />
        ) : (
          <View style={styles.list}>{groupViews.map((group) => (
            <StudyGroupCard group={group} key={group.id} onPress={() => router.push({ pathname: '/(tabs)/(friends)/group/[group-id]', params: { 'group-id': group.id } })} />
          ))}</View>
        )}
      </View>

      <SocialPrivacyNote message="Private Ziele, Sessions, Fächer, Aufgaben, Notizen, Hausaufgaben und Noten sind in diesem Profil nicht sichtbar." />

      {connection ? (
        <AppButton label="Freundschaft entfernen" loading={removing} onPress={confirmRemoval} variant="ghost" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { minWidth: 210, flex: 1, gap: 3 },
  numeric: { fontVariant: ['tabular-nums'] },
  section: { width: '100%', gap: 14 },
  list: { width: '100%', gap: 14 },
});
