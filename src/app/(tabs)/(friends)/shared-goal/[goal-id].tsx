import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import {
  AccountRequiredCta,
  SharedGoalCard,
  type SharedGoalParticipantProgress,
  type SharedGoalProgressValues,
  type SocialUserSummary,
} from '@/components/social';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  ChallengeParticipant,
  ChallengeParticipantProgress,
  FriendshipConnection,
  SharedGoalProgress,
  StudyChallenge,
  StudyUser,
} from '@/types/study';

function singleParam(value: string | readonly string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.[0] ?? null;
}

function targetValue(challenge: StudyChallenge): number {
  return challenge.target.type === 'duration'
    ? challenge.target.targetMinutes
    : challenge.target.targetSessions;
}

function toSocialUser(user: StudyUser): SocialUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

function fallbackUser(
  participant: ChallengeParticipant,
  currentUser: StudyUser | null,
  connections: readonly FriendshipConnection[],
): SocialUserSummary {
  if (currentUser?.id === participant.userId) return toSocialUser(currentUser);
  if (participant.user) return toSocialUser(participant.user);
  const connection = connections.find((item) => item.otherUser.id === participant.userId);
  if (connection) return toSocialUser(connection.otherUser);
  return { id: participant.userId, username: 'mitglied', displayName: 'Teilnehmer' };
}

function mapParticipantProgress(
  participant: ChallengeParticipantProgress,
  currentUser: StudyUser | null,
  connections: readonly FriendshipConnection[],
): SharedGoalParticipantProgress {
  const hasIndividualProgress = participant.target !== null &&
    participant.progressPercent !== null &&
    participant.remaining !== null &&
    participant.achieved !== null &&
    participant.exceededBy !== null;

  return {
    user: participant.user
      ? toSocialUser(participant.user)
      : fallbackUser({ userId: participant.userId, status: participant.status }, currentUser, connections),
    status: participant.status,
    contribution: participant.contribution,
    progress: hasIndividualProgress
      ? {
          value: participant.contribution,
          target: participant.target as number,
          percent: participant.progressPercent as number,
          remaining: participant.remaining as number,
          reached: participant.achieved as boolean,
          exceeded: participant.exceededBy as number,
        }
      : undefined,
  };
}

function formatGoalPeriod(challenge: StudyChallenge): string {
  const startsAt = new Date(challenge.startsAt);
  const endsAt = challenge.endsAt ? new Date(challenge.endsAt) : null;
  if (!Number.isFinite(startsAt.getTime())) {
    return 'Fester Zeitraum';
  }

  const formatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: !endsAt || startsAt.getFullYear() !== endsAt.getFullYear() ? 'numeric' : undefined,
  });
  if (!endsAt || !Number.isFinite(endsAt.getTime())) {
    return `Seit ${formatter.format(startsAt)} · ohne Enddatum`;
  }
  return `${formatter.format(startsAt)}–${formatter.format(endsAt)}`;
}

export default function SharedGoalDetailsScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams<{ 'goal-id': string | string[] }>();
  const goalId = singleParam(params['goal-id']);
  const {
    data,
    socialError,
    friendConnections,
    getSharedGoalDetails,
    getSharedGoalProgress,
    respondSharedGoalInvitation,
    subscribeSharedGoalProgress,
    withdrawFromSharedGoal,
  } = useStudyStore();
  const [details, setDetails] = useState<StudyChallenge | null>(null);
  const [progress, setProgress] = useState<SharedGoalProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'accept' | 'decline' | 'withdraw' | null>(null);

  const cachedGoal = useMemo(
    () => data.challenges.find((challenge) => challenge.id === goalId) ?? null,
    [data.challenges, goalId],
  );
  const goal = details ?? cachedGoal;
  const currentParticipant = goal?.participants.find(
    (participant) => participant.userId === data.currentUser?.id,
  );
  const acceptedForRealtime = currentParticipant?.status === 'accepted';

  const load = useCallback(async () => {
    if (auth.activeMode !== 'supabase' || !goalId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextDetails = await getSharedGoalDetails(goalId);
      setDetails(nextDetails);
      const participant = nextDetails?.participants.find(
        (entry) => entry.userId === data.currentUser?.id,
      );
      if (participant?.status === 'accepted') {
        setProgress(await getSharedGoalProgress(goalId));
      } else {
        setProgress(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Das gemeinsame Lernziel konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [auth.activeMode, data.currentUser?.id, getSharedGoalDetails, getSharedGoalProgress, goalId]);

  useEffect(() => {
    const loadTask = setTimeout(() => void load(), 0);
    return () => clearTimeout(loadTask);
  }, [load]);

  useEffect(() => {
    if (auth.activeMode !== 'supabase' || !goalId || !acceptedForRealtime) return;
    const controller = new AbortController();
    let unsubscribe: (() => Promise<void>) | null = null;

    void subscribeSharedGoalProgress(
      goalId,
      {
        onProgress: (nextProgress) => {
          setProgress(nextProgress);
          setError(null);
        },
        onError: (subscriptionError) => {
          if (!controller.signal.aborted) setError(subscriptionError.message);
        },
      },
      controller.signal,
    ).then((cleanup) => {
      if (controller.signal.aborted) void cleanup();
      else unsubscribe = cleanup;
    }).catch((subscriptionError: unknown) => {
      if (!controller.signal.aborted) {
        setError(subscriptionError instanceof Error
          ? subscriptionError.message
          : 'Live-Aktualisierungen sind gerade nicht verfügbar.');
      }
    });

    return () => {
      controller.abort();
      if (unsubscribe) void unsubscribe();
    };
  }, [acceptedForRealtime, auth.activeMode, goalId, subscribeSharedGoalProgress]);

  const participants = useMemo<readonly SharedGoalParticipantProgress[]>(() => {
    if (progress) {
      return progress.participants.map((participant) => (
        mapParticipantProgress(participant, data.currentUser, friendConnections)
      ));
    }
    if (!goal) return [];
    return goal.participants.map((participant) => ({
      user: fallbackUser(participant, data.currentUser, friendConnections),
      status: participant.status,
      contribution: null,
    }));
  }, [data.currentUser, friendConnections, goal, progress]);

  const teamProgress = useMemo<SharedGoalProgressValues | undefined>(() => {
    if (!goal || !progress) return undefined;
    const overall = progress.overall;
    if (overall) {
      return {
        value: overall.contribution,
        target: overall.target,
        percent: overall.progressPercent,
        remaining: overall.remaining,
        reached: overall.achieved,
        exceeded: overall.exceededBy,
      };
    }
    return undefined;
  }, [goal, progress]);

  const respond = useCallback(async (accept: boolean) => {
    if (!goalId) return;
    setAction(accept ? 'accept' : 'decline');
    setError(null);
    try {
      const nextDetails = await respondSharedGoalInvitation(goalId, accept);
      if (nextDetails) setDetails(nextDetails);
      if (accept) await load();
      else router.replace('/friends');
    } catch (respondError) {
      setError(respondError instanceof Error
        ? respondError.message
        : 'Die Einladung konnte nicht beantwortet werden.');
    } finally {
      setAction(null);
    }
  }, [goalId, load, respondSharedGoalInvitation]);

  const confirmWithdrawal = useCallback(() => {
    if (!goalId || !goal || action) return;
    Alert.alert(
      'Gemeinsames Ziel verlassen?',
      'Deine bisherigen gültigen Beiträge bleiben als Historie erhalten. Neue Sessions zählen danach nicht mehr.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Ziel verlassen',
          style: 'destructive',
          onPress: () => {
            setAction('withdraw');
            void withdrawFromSharedGoal(goalId)
              .then(() => router.replace('/friends'))
              .catch((withdrawError: unknown) => {
                setError(withdrawError instanceof Error
                  ? withdrawError.message
                  : 'Das Ziel konnte nicht verlassen werden.');
              })
              .finally(() => setAction(null));
          },
        },
      ],
    );
  }, [action, goal, goalId, withdrawFromSharedGoal]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Gemeinsame Lernziele stehen nur mit einem verbundenen Konto zur Verfügung."
        title="Gemeinsames Ziel"
      />
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  if (!goalId) {
    return (
      <Screen centered>
        <EmptyState
          message="Der Link enthält keine gültige Ziel-ID."
          symbol="?"
          title="Ziel nicht gefunden"
        />
      </Screen>
    );
  }

  if (loading && !goal) {
    return (
      <Screen centered>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          Gemeinsames Ziel wird geladen …
        </Text>
      </Screen>
    );
  }

  if (!goal) {
    return (
      <Screen centered>
        <EmptyState
          message={error ?? socialError ?? 'Das Ziel existiert nicht oder du darfst es nicht mehr sehen.'}
          symbol="○"
          title="Ziel nicht verfügbar"
        />
        <AppButton label="Erneut versuchen" onPress={() => void load()} variant="outline" />
      </Screen>
    );
  }

  const accepted = currentParticipant?.status === 'accepted';
  const invited = currentParticipant?.status === 'invited';
  const canStudy = accepted && goal.status === 'active';
  const sourceLabel = goal.sourcePolicy === 'timer_only' ? 'Nur Timer-Sessions' : 'Timer und manuelle Einträge';

  return (
    <Screen
      refreshControl={(
        <RefreshControl
          onRefresh={() => void load()}
          refreshing={loading}
          tintColor={theme.colors.primary}
        />
      )}>
      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {error ?? socialError}
          </Text>
        </AppCard>
      ) : null}

      <SharedGoalCard
        description={goal.description}
        invitationActionState={action ? 'loading' : 'idle'}
        mode={goal.target.mode}
        onAcceptInvitation={invited ? () => void respond(true) : undefined}
        onDeclineInvitation={invited ? () => void respond(false) : undefined}
        onOpenParticipant={(participant) => {
          if (friendConnections.some(
            (connection) => connection.status === 'accepted' &&
              connection.otherUser.id === participant.user.id,
          )) {
            router.push({
              pathname: '/(tabs)/(friends)/friend/[user-id]',
              params: { 'user-id': participant.user.id },
            });
          }
        }}
        participants={participants}
        periodLabel={formatGoalPeriod(goal)}
        status={goal.status}
        target={targetValue(goal)}
        targetType={goal.target.type}
        teamProgress={teamProgress}
        title={goal.title}
      />

      <View style={styles.infoGrid}>
        <AppCard padding="sm" style={styles.infoCard} variant="subtle">
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Zielrhythmus</Text>
          <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {goal.cadence === 'daily' ? 'Tagesziel' : 'Wochenziel'}{' '}
            {goal.target.mode === 'per_participant' ? 'pro Person' : 'für das Team'}
          </Text>
        </AppCard>
        <AppCard padding="sm" style={styles.infoCard} variant="subtle">
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Gewertete Quellen</Text>
          <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{sourceLabel}</Text>
        </AppCard>
        {goal.target.type === 'sessions' ? (
          <AppCard padding="sm" style={styles.infoCard} variant="subtle">
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Mindestdauer</Text>
            <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
              {goal.target.minimumSessionMinutes} Minuten je Session
            </Text>
          </AppCard>
        ) : null}
      </View>

      {canStudy ? (
        <AppCard style={styles.actionCard} variant="highlight">
          <SectionHeader
            description="Nur Sessions, die diesem Ziel ausdrücklich zugeordnet sind, fließen in den Fortschritt ein."
            title="Beitrag erfassen"
          />
          <View style={styles.studyActions}>
            <AppButton
              label="Timer starten"
              onPress={() => router.push({ pathname: '/session', params: { goalId: goal.id } })}
              style={styles.studyAction}
            />
            {goal.sourcePolicy === 'all' ? (
              <AppButton
                label="Manuell eintragen"
                onPress={() => router.push({ pathname: '/manual-entry', params: { goalId: goal.id } })}
                style={styles.studyAction}
                variant="outline"
              />
            ) : null}
          </View>
        </AppCard>
      ) : null}

      {accepted && goal.creatorId !== data.currentUser?.id ? (
        <AppButton
          label="Gemeinsames Ziel verlassen"
          loading={action === 'withdraw'}
          onPress={confirmWithdrawal}
          variant="ghost"
        />
      ) : null}
      <AppButton
        label="Gemeinsames Ziel melden"
        onPress={() => router.push(`/report-content?kind=shared_goal&entityId=${encodeURIComponent(goal.id)}&label=${encodeURIComponent(goal.title)}` as Href)}
        variant="outline"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  infoGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  infoCard: { minWidth: 220, flex: 1, gap: 3 },
  actionCard: { width: '100%', gap: 18 },
  studyActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  studyAction: { minWidth: 180, flexGrow: 1 },
});
