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
  FriendStatsGrid,
  type FriendStatsPeriod as FriendStatsPeriodView,
  type FriendStatsPeriodKey,
} from '@/components/social';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { FriendProfileStatistics, FriendStatsPeriod } from '@/types/study';

const PERIOD_ORDER: readonly FriendStatsPeriod[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
];

function singleParam(value: string | readonly string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.[0] ?? null;
}

function toStatsPeriods(statistics: FriendProfileStatistics): readonly FriendStatsPeriodView[] {
  return PERIOD_ORDER.map((key) => {
    const period = statistics.periods[key];
    return {
      key: key as FriendStatsPeriodKey,
      timer: period.timerMinutes === null || period.timerSessionCount === null
        ? null
        : { minutes: period.timerMinutes, sessionCount: period.timerSessionCount },
      manual: period.manualMinutes === null || period.manualSessionCount === null
        ? null
        : { minutes: period.manualMinutes, sessionCount: period.manualSessionCount },
      total: period.totalMinutes === null || period.totalSessionCount === null
        ? null
        : { minutes: period.totalMinutes, sessionCount: period.totalSessionCount },
    };
  });
}

export default function FriendProfileScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams<{ 'user-id': string | string[] }>();
  const friendId = singleParam(params['user-id']);
  const {
    privacy,
    setFriendComparisonsEnabled,
    socialError,
    friendConnections,
    refreshSocial,
    getFriendProfileStats,
    removeFriendship,
  } = useStudyStore();
  const [statistics, setStatistics] = useState<FriendProfileStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const connection = useMemo(
    () => friendConnections.find(
      (item) => item.status === 'accepted' && item.otherUser.id === friendId,
    ) ?? null,
    [friendConnections, friendId],
  );

  const load = useCallback(async () => {
    if (auth.activeMode !== 'supabase' || !friendId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextStatistics = await getFriendProfileStats(friendId);
      setStatistics(nextStatistics);
    } catch (loadError) {
      setStatistics(null);
      setError(loadError instanceof Error
        ? loadError.message
        : 'Die freigegebenen Statistiken konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [auth.activeMode, friendId, getFriendProfileStats]);

  useEffect(() => {
    if (auth.activeMode !== 'supabase') return;
    void refreshSocial();
    const loadTask = setTimeout(() => void load(), 0);
    return () => clearTimeout(loadTask);
  }, [auth.activeMode, load, refreshSocial]);

  const confirmRemoval = useCallback(() => {
    if (!connection || removing) return;
    Alert.alert(
      'Freundschaft entfernen?',
      `Du und ${connection.otherUser.displayName} könnt danach keine freigegebenen Statistiken mehr sehen.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            setRemoving(true);
            void removeFriendship(connection.id)
              .then(() => refreshSocial())
              .then(() => router.replace('/friends'))
              .catch((removeError: unknown) => {
                setError(removeError instanceof Error
                  ? removeError.message
                  : 'Die Freundschaft konnte nicht entfernt werden.');
              })
              .finally(() => setRemoving(false));
          },
        },
      ],
    );
  }, [connection, refreshSocial, removeFriendship, removing]);

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Freundesprofile stehen nur mit einem verbundenen Konto zur Verfügung."
          title="Freundesprofil"
        />
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  if (!friendId) {
    return (
      <Screen centered>
        <EmptyState
          message="Der Profil-Link enthält keinen gültigen Benutzer."
          symbol="?"
          title="Profil nicht gefunden"
        />
      </Screen>
    );
  }

  const friend = statistics?.friend ?? connection?.otherUser ?? null;
  const periods = statistics ? toStatsPeriods(statistics) : [];
  const allVisibleGoalsReached = statistics?.goals
    ? statistics.goals.evaluatedGoalCount > 0 &&
      statistics.goals.achievedGoalCount === statistics.goals.evaluatedGoalCount
    : null;

  return (
    <Screen
      refreshControl={(
        <RefreshControl
          onRefresh={() => void load()}
          refreshing={loading}
          tintColor={theme.colors.primary}
        />
      )}>
      {friend ? (
        <AppCard padding="lg" style={styles.profileCard} variant="subtle">
          <Avatar
            name={friend.displayName}
            size="lg"
            source={friend.avatarUrl ? { uri: friend.avatarUrl } : undefined}
          />
          <View style={styles.profileCopy}>
            <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>
              {friend.displayName}
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              @{friend.username}
            </Text>
          </View>
          {connection ? (
            <AppButton
              label="Freundschaft entfernen"
              loading={removing}
              onPress={confirmRemoval}
              size="compact"
              variant="outline"
            />
          ) : null}
        </AppCard>
      ) : null}

      <SectionHeader
        description="Timer und manuelle Einträge werden getrennt dargestellt. Gesamtwerte erscheinen nur, wenn beide Quellen freigegeben sind."
        eyebrow="Zeiträume in der Profil-Zeitzone"
        title="Freigegebene Lernstatistik"
      />

      {!privacy.friendComparisonsEnabled ? (
        <AppCard style={styles.hiddenCard} variant="subtle">
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>
            Vergleich auf diesem Gerät ausgeblendet
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Die Freigaben deines Freundes ändern sich dadurch nicht.
          </Text>
          <AppButton
            label="Statistik auf diesem Gerät anzeigen"
            onPress={() => setFriendComparisonsEnabled(true)}
            variant="outline"
          />
        </AppCard>
      ) : (
        <FriendStatsGrid
          errorMessage={error ?? socialError ?? undefined}
          goalReached={statistics ? allVisibleGoalsReached : undefined}
          onRetry={() => void load()}
          periods={periods}
          state={loading ? 'loading' : error || socialError ? 'error' : 'ready'}
          streakDays={statistics ? statistics.streakDays : undefined}
        />
      )}

      {!loading && !statistics && !error && !socialError ? (
        <EmptyState
          compact
          message="Die Freundschaft besteht nicht mehr oder das Profil ist nicht verfügbar."
          symbol="○"
          title="Keine Daten verfügbar"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  profileCopy: { minWidth: 160, flex: 1, gap: 2 },
  hiddenCard: { width: '100%', gap: 14 },
});
