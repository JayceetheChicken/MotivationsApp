import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatClock, formatMinutes } from '@/lib/format';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { SharedStudySession, SharedStudySessionParticipant } from '@/types/study';

type ParticipantAction = 'start' | 'pause' | 'resume' | 'finish' | 'leave';

const PARTICIPANT_STATUS_LABELS: Readonly<Record<SharedStudySessionParticipant['status'], string>> = {
  invited: 'Eingeladen',
  joined: 'Bereit',
  active: 'Lernt',
  paused: 'Macht Pause',
  finished: 'Hat beendet',
  declined: 'Abgelehnt',
  left: 'Hat verlassen',
};

function singleParam(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Startzeit offen';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function participantElapsedMinutes(
  participant: SharedStudySessionParticipant,
  calculatedAt: string | null,
  nowMs: number,
): number {
  const baselineAt = calculatedAt ? Date.parse(calculatedAt) : Number.NaN;
  const runningMinutes = participant.status === 'active' && Number.isFinite(baselineAt)
    ? Math.max(0, nowMs - baselineAt) / 60_000
    : 0;
  return Math.max(0, participant.elapsedMinutes + runningMinutes);
}

function parsedTimestamp(value: string | null): number | null {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function selectLatestSharedStudySession(
  loadedSession: SharedStudySession | null,
  cachedSession: SharedStudySession | null,
): SharedStudySession | null {
  if (!loadedSession) return cachedSession;
  if (!cachedSession) return loadedSession;

  const loadedCalculatedAt = parsedTimestamp(loadedSession.calculatedAt);
  const cachedCalculatedAt = parsedTimestamp(cachedSession.calculatedAt);
  if (loadedCalculatedAt !== cachedCalculatedAt) {
    if (loadedCalculatedAt === null) return cachedSession;
    if (cachedCalculatedAt === null) return loadedSession;
    return cachedCalculatedAt > loadedCalculatedAt ? cachedSession : loadedSession;
  }

  const loadedUpdatedAt = parsedTimestamp(loadedSession.updatedAt);
  const cachedUpdatedAt = parsedTimestamp(cachedSession.updatedAt);
  if (loadedUpdatedAt !== cachedUpdatedAt) {
    if (loadedUpdatedAt === null) return cachedSession;
    if (cachedUpdatedAt === null) return loadedSession;
    return cachedUpdatedAt > loadedUpdatedAt ? cachedSession : loadedSession;
  }

  // Preserve an immediately returned local action result on an exact tie.
  return loadedSession;
}

function isSessionAccessLoss(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'forbidden' || code === 'not_found' || code === 'unauthorized';
}

export default function SharedStudySessionDetailsScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams();
  const sessionId = singleParam(params['session-id'] as string | readonly string[] | undefined);
  const {
    data,
    sharedStudySessions,
    socialError,
    getSharedStudySessionDetails,
    respondSharedStudySessionInvitation,
    updateSharedStudySessionParticipant,
    cancelSharedStudySession,
  } = useStudyStore();
  const cachedSession = useMemo(
    () => sharedStudySessions.find((entry) => entry.id === sessionId) ?? null,
    [sessionId, sharedStudySessions],
  );
  const [loadedSession, setLoadedSession] = useState<(typeof sharedStudySessions)[number] | null>(null);
  const [cacheBackedSessionId, setCacheBackedSessionId] = useState<string | null>(
    () => cachedSession?.id ?? null,
  );
  const [accessDeniedSessionId, setAccessDeniedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadGenerationRef = useRef(0);

  const cacheAccessLost = cacheBackedSessionId === sessionId && !cachedSession;
  const session = useMemo(() => {
    if (accessDeniedSessionId === sessionId || cacheAccessLost) return null;
    return selectLatestSharedStudySession(loadedSession, cachedSession);
  }, [accessDeniedSessionId, cacheAccessLost, cachedSession, loadedSession, sessionId]);
  const currentParticipant = session?.participants.find(
    (participant) => participant.userId === data.currentUser?.id,
  );

  useEffect(() => {
    if (!cachedSession || cacheBackedSessionId === cachedSession.id) return;
    const task = setTimeout(() => setCacheBackedSessionId(cachedSession.id), 0);
    return () => clearTimeout(task);
  }, [cacheBackedSessionId, cachedSession]);

  const load = useCallback(async (silent = false) => {
    if (auth.activeMode !== 'supabase' || !sessionId) {
      loadGenerationRef.current += 1;
      setLoading(false);
      return;
    }
    const generation = ++loadGenerationRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await getSharedStudySessionDetails(sessionId);
      if (generation !== loadGenerationRef.current) return;
      setLoadedSession(next);
      setAccessDeniedSessionId(next ? null : sessionId);
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      if (isSessionAccessLoss(loadError)) {
        setLoadedSession(null);
        setAccessDeniedSessionId(sessionId);
      }
      if (!silent) {
        setError(loadError instanceof Error
          ? loadError.message
          : 'Die gemeinsame Lern-Session konnte nicht geladen werden.');
      }
    } finally {
      if (!silent && generation === loadGenerationRef.current) setLoading(false);
    }
  }, [auth.activeMode, getSharedStudySessionDetails, sessionId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  useEffect(() => {
    if (session?.status !== 'active') return;
    const clock = setInterval(() => setNowMs(Date.now()), 1_000);
    const refresh = setInterval(() => void load(true), 15_000);
    return () => {
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, [load, session?.status]);

  const respond = async (accept: boolean) => {
    if (!sessionId) return;
    setPendingAction(accept ? 'accept' : 'decline');
    setError(null);
    loadGenerationRef.current += 1;
    try {
      const next = await respondSharedStudySessionInvitation(sessionId, accept);
      loadGenerationRef.current += 1;
      if (next) setLoadedSession(next);
      if (!accept) router.replace('/friends');
    } catch (respondError) {
      setError(respondError instanceof Error
        ? respondError.message
        : 'Die Einladung konnte nicht beantwortet werden.');
    } finally {
      setPendingAction(null);
    }
  };

  const runParticipantAction = async (action: ParticipantAction) => {
    if (!sessionId) return;
    setPendingAction(action);
    setError(null);
    loadGenerationRef.current += 1;
    try {
      const next = await updateSharedStudySessionParticipant(sessionId, action);
      loadGenerationRef.current += 1;
      if (next) setLoadedSession(next);
      if (action === 'leave') router.replace('/friends');
    } catch (actionError) {
      setError(actionError instanceof Error
        ? actionError.message
        : 'Dein Session-Status konnte nicht aktualisiert werden.');
    } finally {
      setPendingAction(null);
    }
  };

  const confirmCancel = () => {
    if (!sessionId || pendingAction) return;
    Alert.alert(
      'Gemeinsame Session absagen?',
      'Alle Teilnehmer sehen danach nur noch, dass die Session abgesagt wurde.',
      [
        { text: 'Zurück', style: 'cancel' },
        {
          text: 'Session absagen',
          style: 'destructive',
          onPress: () => {
            setPendingAction('cancel');
            loadGenerationRef.current += 1;
            void cancelSharedStudySession(sessionId)
              .then((next) => {
                loadGenerationRef.current += 1;
                if (next) setLoadedSession(next);
              })
              .catch((cancelError: unknown) => setError(
                cancelError instanceof Error ? cancelError.message : 'Die Session konnte nicht abgesagt werden.',
              ))
              .finally(() => setPendingAction(null));
          },
        },
      ],
    );
  };

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader description="Gemeinsame Sessions benötigen ein verbundenes Konto." title="Gemeinsame Lern-Session" />
        <AccountRequiredCta loading={auth.loading} onRegister={() => router.push('/register')} onSignIn={() => router.push('/login')} />
      </Screen>
    );
  }

  if (!sessionId) {
    return <Screen centered><EmptyState message="Der Session-Link ist ungültig." symbol="?" title="Session nicht gefunden" /></Screen>;
  }

  if (loading && !session) {
    return (
      <Screen centered>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Gemeinsame Session wird geladen …</Text>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen centered>
        <EmptyState message={error ?? socialError ?? 'Die Session existiert nicht oder ist nicht mehr sichtbar.'} symbol="○" title="Session nicht verfügbar" />
        <AppButton label="Erneut versuchen" onPress={() => void load()} variant="outline" />
      </Screen>
    );
  }

  const invited = currentParticipant?.status === 'invited';
  const participating = currentParticipant && ['joined', 'active', 'paused', 'finished'].includes(currentParticipant.status);
  const visibleParticipants = session.participants.filter(
    (participant) => ['joined', 'active', 'paused', 'finished'].includes(participant.status),
  );
  const elapsedByParticipant = visibleParticipants.map((participant) => ({
    participant,
    minutes: participantElapsedMinutes(
      participant,
      session.receivedAt ?? session.calculatedAt,
      nowMs,
    ),
  }));
  const progressPercent = elapsedByParticipant.length > 0
    ? elapsedByParticipant.reduce(
        (sum, entry) => sum + Math.min(100, (entry.minutes / session.plannedDurationMinutes) * 100),
        0,
      ) / elapsedByParticipant.length
    : 0;
  const currentElapsed = currentParticipant
    ? participantElapsedMinutes(
        currentParticipant,
        session.receivedAt ?? session.calculatedAt,
        nowMs,
      )
    : 0;
  const hasLinkedPrivateTimer = data.activeTimer?.sharedSessionId === session.id;
  const hasOtherActiveTimer = Boolean(
    data.activeTimer && data.activeTimer.sharedSessionId !== session.id,
  );
  const canOpenPrivateTimer = currentParticipant?.status === 'joined' ||
    currentParticipant?.status === 'active' || currentParticipant?.status === 'paused';

  return (
    <Screen
      refreshControl={<RefreshControl onRefresh={() => void load()} refreshing={loading} tintColor={theme.colors.primary} />}>
      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error ?? socialError}</Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.hero} variant={session.status === 'active' ? 'highlight' : 'default'}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <View style={[styles.statusBadge, { backgroundColor: session.status === 'active' ? theme.colors.successMuted : theme.colors.surfaceMuted, borderRadius: theme.radii.pill }]}>
              <Text selectable style={[theme.typography.caption, { color: session.status === 'active' ? theme.colors.success : theme.colors.textMuted }]}>
                {session.status === 'planned' ? 'Geplant' : session.status === 'active' ? 'Läuft gerade' : session.status === 'completed' ? 'Beendet' : 'Abgesagt'}
              </Text>
            </View>
            <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>{session.title}</Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{formatDateTime(session.startsAt)}</Text>
          </View>
          <View style={styles.durationCopy}>
            <Text selectable style={[theme.typography.metric, styles.numeric, { color: theme.colors.primaryText }]}>{session.plannedDurationMinutes}</Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Min. geplant</Text>
          </View>
        </View>

        {session.status === 'active' ? (
          <View style={styles.timerSummary}>
            <Text selectable style={[styles.sharedClock, { color: theme.colors.text }]}>
              {formatClock(Math.round(currentElapsed * 60))}
            </Text>
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>deine absolvierte Zeit</Text>
          </View>
        ) : null}

        {elapsedByParticipant.length > 0 ? (
          <ProgressBar label="Gemeinsamer Session-Fortschritt" max={100} showValue value={progressPercent} />
        ) : null}
      </AppCard>

      {invited ? (
        <AppCard style={styles.invitationCard} variant="subtle">
          <SectionHeader description="Nach der Annahme siehst du den gemeinsamen Timer und die Status der Teilnehmer." title="Einladung zur Lern-Session" />
          <AppButton fullWidth label="Teilnehmen" loading={pendingAction === 'accept'} onPress={() => void respond(true)} />
          <AppButton disabled={pendingAction !== null} fullWidth label="Ablehnen" onPress={() => void respond(false)} variant="ghost" />
        </AppCard>
      ) : null}

      {participating && session.status !== 'cancelled' ? (
        <AppCard style={styles.actionCard} variant="subtle">
          <SectionHeader
            description="Dein Fach, deine Aufgabe und deine Notizen werden ausschließlich im privaten Timer gespeichert."
            title="Dein Lernstatus"
          />
          {hasOtherActiveTimer ? (
            <Text accessibilityRole="alert" selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Beende zuerst deinen bereits laufenden privaten Timer. Danach kannst du diese gemeinsame Session verbinden.
            </Text>
          ) : hasLinkedPrivateTimer ? (
            <AppButton
              fullWidth
              label="Privaten Lerntimer öffnen"
              onPress={() => router.push({ pathname: '/session', params: { sharedSessionId: session.id } })}
              size="large"
            />
          ) : canOpenPrivateTimer && currentParticipant?.status !== 'finished' ? (
            <AppButton
              fullWidth
              label={currentParticipant?.status === 'joined' ? 'Lernen starten' : 'Privaten Timer verbinden'}
              onPress={() => router.push({
                pathname: '/session',
                params: {
                  sharedSessionId: session.id,
                  plannedDuration: String(session.plannedDurationMinutes),
                },
              })}
              size="large"
            />
          ) : null}

          {!hasLinkedPrivateTimer && currentParticipant?.status === 'active' ? (
            <View style={styles.inlineActions}>
              <AppButton label="Pause" loading={pendingAction === 'pause'} onPress={() => void runParticipantAction('pause')} style={styles.inlineAction} variant="outline" />
              <AppButton label="Beenden" loading={pendingAction === 'finish'} onPress={() => void runParticipantAction('finish')} style={styles.inlineAction} variant="secondary" />
            </View>
          ) : null}
          {!hasLinkedPrivateTimer && currentParticipant?.status === 'paused' ? (
            <View style={styles.inlineActions}>
              <AppButton label="Fortsetzen" loading={pendingAction === 'resume'} onPress={() => void runParticipantAction('resume')} style={styles.inlineAction} />
              <AppButton label="Beenden" loading={pendingAction === 'finish'} onPress={() => void runParticipantAction('finish')} style={styles.inlineAction} variant="outline" />
            </View>
          ) : null}
        </AppCard>
      ) : null}

      <View style={styles.section}>
        <SectionHeader description="Andere sehen nur deinen Status und die absolvierte Dauer." title="Teilnehmer" />
        <AppCard padding="none" style={styles.participantList}>
          {elapsedByParticipant.map(({ participant, minutes }) => (
            <View
              accessibilityLabel={`${participant.user.displayName}, ${PARTICIPANT_STATUS_LABELS[participant.status]}, ${formatMinutes(minutes, true)}`}
              key={participant.userId}
              style={[styles.participantRow, { borderBottomColor: theme.colors.divider }]}>
              <View>
                <Avatar name={participant.user.displayName} size="sm" source={participant.user.avatarUrl ? { uri: participant.user.avatarUrl } : undefined} />
                <View style={[styles.statusDot, { backgroundColor: participant.status === 'active' ? theme.colors.success : participant.status === 'paused' ? theme.colors.warning : theme.colors.textSubtle, borderColor: theme.colors.surface }]} />
              </View>
              <View style={styles.participantCopy}>
                <Text numberOfLines={1} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{participant.user.displayName}</Text>
                <Text numberOfLines={1} selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{PARTICIPANT_STATUS_LABELS[participant.status]}</Text>
              </View>
              <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.primaryText }]}>{formatMinutes(minutes, true)}</Text>
            </View>
          ))}
        </AppCard>
      </View>

      <AppCard style={styles.privacyCard} variant="subtle">
        <Text accessibilityRole="header" selectable style={[theme.typography.label, { color: theme.colors.text }]}>Was andere nicht sehen</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Fach, Aufgabe, privates Ziel, Notizen und der genaue Verlauf deines persönlichen Timers bleiben vollständig privat.</Text>
      </AppCard>

      {hasLinkedPrivateTimer ? (
        <Text accessibilityRole="alert" selectable style={[theme.typography.caption, styles.linkedTimerHint, { color: theme.colors.textMuted }]}>
          Beende oder verwirf zuerst deinen verbundenen privaten Timer, bevor du diese gemeinsame Session verlässt oder absagst.
        </Text>
      ) : null}

      {participating && currentParticipant?.status !== 'finished' && session.creatorId !== data.currentUser?.id ? (
        <AppButton disabled={hasLinkedPrivateTimer} label="Session verlassen" loading={pendingAction === 'leave'} onPress={() => void runParticipantAction('leave')} variant="ghost" />
      ) : null}
      {session.creatorId === data.currentUser?.id && ['planned', 'active'].includes(session.status) ? (
        <AppButton disabled={hasLinkedPrivateTimer} label="Gemeinsame Session absagen" loading={pendingAction === 'cancel'} onPress={confirmCancel} variant="ghost" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', gap: 20 },
  heroTopRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  heroCopy: { minWidth: 0, flex: 1, gap: 7 },
  statusBadge: { minHeight: 26, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 4 },
  durationCopy: { alignItems: 'flex-end' },
  numeric: { fontVariant: ['tabular-nums'] },
  timerSummary: { alignItems: 'center', gap: 2, paddingVertical: 8 },
  sharedClock: { fontSize: 44, lineHeight: 52, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  invitationCard: { width: '100%', gap: 12 },
  actionCard: { width: '100%', gap: 14 },
  inlineActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  inlineAction: { minWidth: 150, flexGrow: 1 },
  section: { width: '100%', gap: 14 },
  participantList: { width: '100%', overflow: 'hidden' },
  participantRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  statusDot: { position: 'absolute', right: -2, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  participantCopy: { minWidth: 0, flex: 1, gap: 1 },
  privacyCard: { width: '100%', gap: 5 },
  linkedTimerHint: { width: '100%', textAlign: 'center' },
});
