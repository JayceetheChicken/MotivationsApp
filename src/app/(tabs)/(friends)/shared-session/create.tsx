import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AccountRequiredCta } from '@/components/social';
import { SegmentedControl } from '@/components/segmented-control';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import type { CreateSharedStudySessionInput } from '@/data/repositories/study-repository';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

type StartMode = 'now' | 'planned';

const START_OPTIONS = [
  { value: 'now', label: 'Jetzt starten' },
  { value: 'planned', label: 'Planen' },
] as const;
const DURATION_OPTIONS = [25, 45, 60, 90] as const;

function singleParam(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function initialSchedule(reference = new Date()): { date: string; time: string } {
  const next = new Date(reference);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil((next.getMinutes() + 15) / 15) * 15);
  return {
    date: `${next.getFullYear()}-${twoDigits(next.getMonth() + 1)}-${twoDigits(next.getDate())}`,
    time: `${twoDigits(next.getHours())}:${twoDigits(next.getMinutes())}`,
  };
}

function parseLocalSchedule(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day &&
    parsed.getHours() === hour &&
    parsed.getMinutes() === minute
    ? parsed
    : null;
}

export default function CreateSharedStudySessionScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams();
  const requestedGroupId = singleParam(params.groupId as string | readonly string[] | undefined);
  const {
    data,
    friendConnections,
    studyGroups,
    socialError,
    createSharedStudySession,
  } = useStudyStore();
  const initial = useMemo(() => initialSchedule(), []);
  const [title, setTitle] = useState('Gemeinsam lernen');
  const [startMode, setStartMode] = useState<StartMode>('now');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState('45');
  const [inviteeIds, setInviteeIds] = useState<readonly string[]>([]);
  const initializedGroupId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const group = studyGroups.find((entry) => entry.id === requestedGroupId) ?? null;
  const candidates = useMemo(() => {
    if (group) {
      return group.members.flatMap((member) => (
        member.status === 'accepted' && member.userId !== data.currentUser?.id
          ? [member.user]
          : []
      ));
    }
    return friendConnections.flatMap((connection) => (
      connection.status === 'accepted' ? [connection.otherUser] : []
    ));
  }, [data.currentUser?.id, friendConnections, group]);

  useEffect(() => {
    if (!group || initializedGroupId.current === group.id) return;
    initializedGroupId.current = group.id;
    const task = setTimeout(() => {
      setInviteeIds(candidates.map((candidate) => candidate.id));
      setTitle(`${group.name}: Lernsession`);
    }, 0);
    return () => clearTimeout(task);
  }, [candidates, group]);

  const toggleInvitee = (userId: string) => {
    setInviteeIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
    setError(null);
  };

  const submit = async () => {
    const cleanTitle = title.trim();
    const parsedDuration = Number(duration.trim().replace(',', '.'));
    const schedule = startMode === 'now' ? new Date() : parseLocalSchedule(date.trim(), time.trim());

    if (cleanTitle.length < 3) {
      setError('Gib einen Sessionnamen mit mindestens drei Zeichen ein.');
      return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 5 || parsedDuration > 720) {
      setError('Die geplante Dauer muss zwischen 5 und 720 Minuten liegen.');
      return;
    }
    if (!schedule || schedule.getTime() < Date.now() - 60_000) {
      setError('Wähle einen gültigen Startzeitpunkt in der Zukunft.');
      return;
    }
    if (inviteeIds.length === 0) {
      setError('Lade mindestens einen Freund zur gemeinsamen Session ein.');
      return;
    }

    const input: CreateSharedStudySessionInput = {
      operationId: randomUUID(),
      inviteeIds,
      session: {
        id: randomUUID(),
        title: cleanTitle,
        groupId: group?.id ?? null,
        startsAt: schedule.toISOString(),
        plannedDurationMinutes: parsedDuration,
        startNow: startMode === 'now',
      },
    };

    setSubmitting(true);
    setError(null);
    try {
      const session = await createSharedStudySession(input);
      if (!session) throw new Error('Die gemeinsame Session wurde nicht zurückgegeben.');
      router.replace({
        pathname: '/(tabs)/(friends)/shared-session/[session-id]',
        params: { 'session-id': session.id },
      });
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : 'Die gemeinsame Session konnte nicht erstellt werden.');
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Gemeinsame Lern-Sessions stehen nur mit einem verbundenen Konto zur Verfügung."
          title="Gemeinsame Session"
        />
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={820} keyboardShouldPersistTaps="handled">
      <SectionHeader
        description="Ihr teilt Start, Timer und Status. Fach, Aufgabe und persönliche Notizen bleiben bei jeder Person privat."
        eyebrow={group ? group.name : 'Gemeinsam fokussieren'}
        title="Lern-Session starten oder planen"
      />

      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {error ?? socialError}
          </Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.formCard}>
        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Name der gemeinsamen Session</Text>
          <TextInput
            accessibilityLabel="Name der gemeinsamen Lern-Session"
            maxLength={80}
            onChangeText={(value) => { setTitle(value); setError(null); }}
            placeholder="Gemeinsam lernen"
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.body,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, color: theme.colors.text },
            ]}
            value={title}
          />
        </View>

        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Start</Text>
          <SegmentedControl
            accessibilityLabel="Startart der gemeinsamen Lern-Session"
            onChange={setStartMode}
            options={START_OPTIONS}
            value={startMode}
          />
        </View>

        {startMode === 'planned' ? (
          <View style={styles.scheduleRow}>
            <View style={styles.scheduleField}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Datum</Text>
              <TextInput
                accessibilityLabel="Datum der gemeinsamen Lern-Session"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                onChangeText={(value) => { setDate(value); setError(null); }}
                placeholder="JJJJ-MM-TT"
                placeholderTextColor={theme.colors.textSubtle}
                style={[styles.input, theme.typography.body, styles.numeric, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, color: theme.colors.text }]}
                value={date}
              />
            </View>
            <View style={styles.scheduleField}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Uhrzeit</Text>
              <TextInput
                accessibilityLabel="Uhrzeit der gemeinsamen Lern-Session"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                onChangeText={(value) => { setTime(value); setError(null); }}
                placeholder="HH:MM"
                placeholderTextColor={theme.colors.textSubtle}
                style={[styles.input, theme.typography.body, styles.numeric, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, color: theme.colors.text }]}
                value={time}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Geplante Dauer</Text>
          <View style={styles.durationChoices}>
            {DURATION_OPTIONS.map((minutes) => {
              const selected = duration === String(minutes);
              return (
                <Pressable
                  accessibilityLabel={`${minutes} Minuten`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={minutes}
                  onPress={() => { setDuration(String(minutes)); setError(null); }}
                  style={({ pressed }) => [
                    styles.durationChoice,
                    {
                      backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderRadius: theme.radii.md,
                    },
                    pressed ? styles.pressed : undefined,
                  ]}>
                  <Text style={[theme.typography.label, { color: selected ? theme.colors.primaryText : theme.colors.textMuted }]}>{minutes} Min.</Text>
                </Pressable>
              );
            })}
            <View style={[styles.customDuration, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radii.md }]}>
              <TextInput
                accessibilityLabel="Eigene geplante Dauer in Minuten"
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={(value) => { setDuration(value); setError(null); }}
                style={[styles.durationInput, theme.typography.label, styles.numeric, { color: theme.colors.text }]}
                value={DURATION_OPTIONS.includes(Number(duration) as (typeof DURATION_OPTIONS)[number]) ? '' : duration}
              />
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Min.</Text>
            </View>
          </View>
        </View>
      </AppCard>

      <View style={styles.section}>
        <SectionHeader
          description={group
            ? 'Alle angenommenen Gruppenmitglieder sind vorausgewählt.'
            : 'Nur bestätigte Freunde können eingeladen werden.'}
          title="Teilnehmer"
        />
        {candidates.length === 0 ? (
          <AppCard variant="subtle">
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Für diese Session stehen noch keine bestätigten Freunde zur Verfügung.
            </Text>
          </AppCard>
        ) : (
          <AppCard padding="none" style={styles.friendList}>
            {candidates.map((candidate) => {
              const selected = inviteeIds.includes(candidate.id);
              return (
                <Pressable
                  accessibilityLabel={`${candidate.displayName} zur Session einladen`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={candidate.id}
                  onPress={() => toggleInvitee(candidate.id)}
                  style={({ pressed }) => [styles.friendRow, { borderBottomColor: theme.colors.divider }, pressed ? styles.pressed : undefined]}>
                  <Avatar name={candidate.displayName} size="sm" source={candidate.avatarUrl ? { uri: candidate.avatarUrl } : undefined} />
                  <View style={styles.friendCopy}>
                    <Text numberOfLines={1} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{candidate.displayName}</Text>
                    <Text numberOfLines={1} selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>@{candidate.username}</Text>
                  </View>
                  <View style={[styles.checkbox, { backgroundColor: selected ? theme.colors.primary : theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.borderStrong, borderRadius: theme.radii.sm }]}>
                    <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimary : 'transparent' }]}>✓</Text>
                  </View>
                </Pressable>
              );
            })}
          </AppCard>
        )}
      </View>

      <AppButton
        disabled={candidates.length === 0}
        fullWidth
        label={startMode === 'now' ? 'Session starten und einladen' : 'Session planen und einladen'}
        loading={submitting}
        onPress={() => void submit()}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  formCard: { width: '100%', gap: 20 },
  field: { width: '100%', gap: 8 },
  input: { width: '100%', minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  scheduleRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  scheduleField: { minWidth: 190, flex: 1, gap: 8 },
  durationChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  durationChoice: { minWidth: 88, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1 },
  customDuration: { minWidth: 108, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, borderWidth: 1 },
  durationInput: { minWidth: 48, minHeight: 44, flex: 1, textAlign: 'right' },
  numeric: { fontVariant: ['tabular-nums'] },
  section: { width: '100%', gap: 14 },
  friendList: { width: '100%', overflow: 'hidden' },
  friendRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  friendCopy: { minWidth: 0, flex: 1, gap: 1 },
  checkbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pressed: { opacity: 0.74 },
});
