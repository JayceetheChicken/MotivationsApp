import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AccountRequiredCta } from '@/components/social';
import { EmptyState } from '@/components/empty-state';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

function singleParam(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Termin offen';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function StudyGroupDetailsScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams();
  const groupId = singleParam(params['group-id'] as string | readonly string[] | undefined);
  const {
    data,
    studyGroups,
    sharedStudySessions,
    sharedGoalProgressById,
    socialError,
    refreshSocial,
    getStudyGroupDetails,
    respondStudyGroupInvitation,
    leaveStudyGroup,
  } = useStudyStore();
  const [loadedGroup, setLoadedGroup] = useState<(typeof studyGroups)[number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'accept' | 'decline' | 'leave' | null>(null);

  const cachedGroup = useMemo(
    () => studyGroups.find((entry) => entry.id === groupId) ?? null,
    [groupId, studyGroups],
  );
  const group = loadedGroup ?? cachedGroup;
  const currentMember = group?.members.find((member) => member.userId === data.currentUser?.id);

  const load = useCallback(async () => {
    if (auth.activeMode !== 'supabase' || !groupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [next] = await Promise.all([
        getStudyGroupDetails(groupId),
        refreshSocial({ silent: true }),
      ]);
      setLoadedGroup(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Die Lerngruppe konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [auth.activeMode, getStudyGroupDetails, groupId, refreshSocial]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const respond = async (accept: boolean) => {
    if (!groupId) return;
    setAction(accept ? 'accept' : 'decline');
    setError(null);
    try {
      const next = await respondStudyGroupInvitation(groupId, accept);
      if (next) setLoadedGroup(next);
      if (!accept) router.replace('/friends');
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : 'Die Einladung konnte nicht beantwortet werden.');
    } finally {
      setAction(null);
    }
  };

  const confirmLeave = () => {
    if (!groupId || action) return;
    Alert.alert(
      'Lerngruppe verlassen?',
      'Du siehst danach keine neuen Gruppenaktivitäten mehr. Deine privaten Lerndaten bleiben unverändert.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Gruppe verlassen',
          style: 'destructive',
          onPress: () => {
            setAction('leave');
            void leaveStudyGroup(groupId)
              .then(() => router.replace('/friends'))
              .catch((leaveError: unknown) => setError(
                leaveError instanceof Error ? leaveError.message : 'Die Gruppe konnte nicht verlassen werden.',
              ))
              .finally(() => setAction(null));
          },
        },
      ],
    );
  };

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader description="Lerngruppen benötigen ein verbundenes Konto." title="Lerngruppe" />
        <AccountRequiredCta loading={auth.loading} onRegister={() => router.push('/register')} onSignIn={() => router.push('/login')} />
      </Screen>
    );
  }

  if (!groupId) {
    return <Screen centered><EmptyState message="Der Gruppen-Link ist ungültig." symbol="?" title="Gruppe nicht gefunden" /></Screen>;
  }

  if (loading && !group) {
    return (
      <Screen centered>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Lerngruppe wird geladen …</Text>
      </Screen>
    );
  }

  if (!group) {
    return (
      <Screen centered>
        <EmptyState message={error ?? socialError ?? 'Die Gruppe existiert nicht oder ist nicht mehr sichtbar.'} symbol="○" title="Gruppe nicht verfügbar" />
        <AppButton label="Erneut versuchen" onPress={() => void load()} variant="outline" />
      </Screen>
    );
  }

  const invited = currentMember?.status === 'invited';
  const accepted = currentMember?.status === 'accepted';
  const acceptedMembers = group.members.filter((member) => member.status === 'accepted');
  const groupGoals = data.challenges.filter((goal) =>
    goal.groupId === group.id || group.sharedGoalIds.includes(goal.id),
  );
  const groupSessions = sharedStudySessions.filter((session) =>
    session.groupId === group.id || group.sharedSessionIds.includes(session.id),
  );
  const upcomingSessions = groupSessions
    .filter((session) => session.status === 'planned' || session.status === 'active')
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const pastSessions = groupSessions
    .filter((session) => session.status === 'completed' || session.status === 'cancelled')
    .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt));
  const goalProgressValues = groupGoals.flatMap((goal) => {
    const progress = sharedGoalProgressById[goal.id];
    return progress ? [progress.overall.progressPercent] : [];
  });
  const groupProgress = goalProgressValues.length > 0
    ? goalProgressValues.reduce((sum, value) => sum + value, 0) / goalProgressValues.length
    : 0;

  return (
    <Screen
      refreshControl={<RefreshControl onRefresh={() => void load()} refreshing={loading} tintColor={theme.colors.primary} />}>
      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error ?? socialError}</Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.hero} variant="highlight">
        <View style={[styles.groupIcon, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl }]}>
          <Text style={styles.groupIconText}>{group.icon}</Text>
        </View>
        <View style={styles.heroCopy}>
          <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>{group.name}</Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {acceptedMembers.length} {acceptedMembers.length === 1 ? 'Mitglied' : 'Mitglieder'} · {groupGoals.length} gemeinsame {groupGoals.length === 1 ? 'Ziel' : 'Ziele'}
          </Text>
        </View>
      </AppCard>

      {invited ? (
        <AppCard style={styles.invitationCard} variant="subtle">
          <SectionHeader description="Erst nach deiner Annahme siehst du Mitglieder und gemeinsame Inhalte." title="Einladung zur Lerngruppe" />
          <AppButton fullWidth label="Einladung annehmen" loading={action === 'accept'} onPress={() => void respond(true)} />
          <AppButton disabled={action !== null} fullWidth label="Ablehnen" onPress={() => void respond(false)} variant="ghost" />
        </AppCard>
      ) : null}

      {accepted ? (
        <>
          <View style={styles.quickActions}>
            <AppButton
              label="Gemeinsames Ziel"
              onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-goal/create', params: { groupId: group.id } })}
              style={styles.quickAction}
              variant="secondary"
            />
            <AppButton
              label="Session planen"
              onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-session/create', params: { groupId: group.id } })}
              style={styles.quickAction}
            />
          </View>

          <View style={styles.section}>
            <SectionHeader description="Nur angenommene Mitglieder werden innerhalb der Gruppe angezeigt." title="Mitglieder" />
            <AppCard padding="none" style={styles.memberList}>
              {group.members.filter((member) => member.status === 'accepted' || member.status === 'invited').map((member) => (
                <View key={member.userId} style={[styles.memberRow, { borderBottomColor: theme.colors.divider }]}>
                  <Avatar name={member.user.displayName} size="sm" source={member.user.avatarUrl ? { uri: member.user.avatarUrl } : undefined} />
                  <View style={styles.memberCopy}>
                    <Text numberOfLines={1} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{member.user.displayName}</Text>
                    <Text numberOfLines={1} selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      @{member.user.username} · {member.role === 'owner' ? 'Erstellt die Gruppe' : member.status === 'invited' ? 'Eingeladen' : 'Mitglied'}
                    </Text>
                  </View>
                </View>
              ))}
            </AppCard>
          </View>

          <View style={styles.section}>
            <SectionHeader description="Der Gruppenfortschritt basiert ausschließlich auf gemeinsamen Zielen." title="Gemeinsame Ziele" />
            {groupGoals.length === 0 ? (
              <EmptyState compact message="Erstellt euer erstes gemeinsames Gruppenziel." symbol="◎" title="Noch kein Gruppenziel" />
            ) : (
              <View style={styles.cardList}>
                {groupGoals.map((goal) => {
                  const progress = sharedGoalProgressById[goal.id];
                  return (
                    <AppCard
                      accessibilityLabel={`${goal.title}, gemeinsames Gruppenziel`}
                      key={goal.id}
                      onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-goal/[goal-id]', params: { 'goal-id': goal.id } })}
                      style={styles.summaryCard}>
                      <View style={styles.summaryHeader}>
                        <View style={styles.summaryCopy}>
                          <Text numberOfLines={2} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{goal.title}</Text>
                          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{goal.participants.filter((participant) => participant.status === 'accepted').length} Teilnehmer</Text>
                        </View>
                        <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.primaryText }]}>
                          {progress ? `${Math.round(progress.overall.progressPercent)} %` : '—'}
                        </Text>
                      </View>
                      <ProgressBar max={100} value={progress?.overall.progressPercent ?? 0} />
                    </AppCard>
                  );
                })}
                {goalProgressValues.length > 0 ? (
                  <AppCard variant="subtle"><ProgressBar label="Gruppenfortschritt" max={100} showValue value={groupProgress} /></AppCard>
                ) : null}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Geplante Lern-Sessions" />
            {upcomingSessions.length === 0 ? (
              <EmptyState compact message="Plant eine gemeinsame Fokuszeit für die Gruppe." symbol="◷" title="Keine Session geplant" />
            ) : (
              <View style={styles.cardList}>
                {upcomingSessions.map((session) => (
                  <AppCard
                    key={session.id}
                    onPress={() => router.push({ pathname: '/(tabs)/(friends)/shared-session/[session-id]', params: { 'session-id': session.id } })}
                    style={styles.sessionCard}>
                    <View style={styles.summaryCopy}>
                      <Text numberOfLines={2} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{session.title}</Text>
                      <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{formatDateTime(session.startsAt)} · {session.plannedDurationMinutes} Min.</Text>
                    </View>
                    <Text selectable style={[theme.typography.caption, { color: theme.colors.primaryText }]}>
                      {session.status === 'active' ? 'Öffnen' : 'Ansehen'} →
                    </Text>
                  </AppCard>
                ))}
              </View>
            )}
          </View>

          {pastSessions.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader description="Es werden nur gemeinsame Dauer und Status gezeigt." title="Vergangene Sessions" />
              <View style={styles.cardList}>
                {pastSessions.slice(0, 5).map((session) => (
                  <AppCard key={session.id} padding="sm" variant="subtle">
                    <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{session.title}</Text>
                    <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{formatDateTime(session.startsAt)} · {session.status === 'cancelled' ? 'Abgesagt' : 'Beendet'}</Text>
                  </AppCard>
                ))}
              </View>
            </View>
          ) : null}

          <AppCard style={styles.privacyCard} variant="subtle">
            <Text accessibilityRole="header" selectable style={[theme.typography.label, { color: theme.colors.text }]}>Privat bleibt privat</Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Diese Gruppe besitzt keinen Aktivitätsfeed. Sichtbar sind ausschließlich Ziele und Sessions, die ausdrücklich für diese Gruppe erstellt wurden.</Text>
          </AppCard>

          {group.creatorId !== data.currentUser?.id ? (
            <AppButton label="Lerngruppe verlassen" loading={action === 'leave'} onPress={confirmLeave} variant="ghost" />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 16 },
  groupIcon: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center' },
  groupIconText: { fontSize: 32, lineHeight: 38 },
  heroCopy: { minWidth: 0, flex: 1, gap: 3 },
  invitationCard: { width: '100%', gap: 12 },
  quickActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickAction: { minWidth: 180, flexGrow: 1 },
  section: { width: '100%', gap: 14 },
  memberList: { width: '100%', overflow: 'hidden' },
  memberRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  memberCopy: { minWidth: 0, flex: 1, gap: 1 },
  cardList: { width: '100%', gap: 12 },
  summaryCard: { width: '100%', gap: 12 },
  summaryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  summaryCopy: { minWidth: 0, flex: 1, gap: 2 },
  numeric: { fontVariant: ['tabular-nums'] },
  sessionCard: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 },
  privacyCard: { width: '100%', gap: 5 },
});
