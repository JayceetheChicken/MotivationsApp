import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AccountRequiredCta,
  SharedGoalFormFields,
  type SharedGoalFormErrors,
  type SharedGoalFormValue,
  type SocialUserSummary,
} from '@/components/social';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import type { CreateSharedGoalInput } from '@/data/repositories/study-repository';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialFormValue(reference = new Date()): SharedGoalFormValue {
  const end = new Date(reference);
  end.setDate(end.getDate() + 28);
  return {
    title: '',
    description: '',
    mode: 'per_participant',
    targetType: 'duration',
    durationUnit: 'hours',
    cadence: 'weekly',
    startsOn: localDateString(reference),
    endsOn: localDateString(end),
    sourcePolicy: 'all',
    targetValue: '',
    minimumSessionMinutes: '10',
    participantIds: [],
  };
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDateBoundary(value: string, endOfDay: boolean): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function periodPreview(startsAt: Date, endsAt: Date): string {
  const formatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${formatter.format(startsAt)} bis ${formatter.format(endsAt)}`;
}

export default function CreateSharedGoalScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const params = useLocalSearchParams();
  const rawGroupId = params.groupId as string | readonly string[] | undefined;
  const requestedGroupId = typeof rawGroupId === 'string' ? rawGroupId : rawGroupId?.[0] ?? null;
  const {
    data,
    socialLoading,
    socialError,
    friendConnections,
    studyGroups,
    refreshSocial,
    createSharedGoal,
  } = useStudyStore();
  const [value, setValue] = useState<SharedGoalFormValue>(() => initialFormValue());
  const [errors, setErrors] = useState<SharedGoalFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const initializedGroupId = useRef<string | null>(null);
  const group = studyGroups.find((entry) => entry.id === requestedGroupId) ?? null;

  useEffect(() => {
    if (auth.activeMode === 'supabase') void refreshSocial();
  }, [auth.activeMode, refreshSocial]);

  const friends = useMemo<readonly SocialUserSummary[]>(
    () => (group
      ? group.members.flatMap((member) => (
          member.status === 'accepted' && member.userId !== data.currentUser?.id
            ? [member.user]
            : []
        ))
      : friendConnections
          .filter((connection) => connection.status === 'accepted')
          .map((connection) => connection.otherUser))
      .map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      })),
    [data.currentUser?.id, friendConnections, group],
  );

  useEffect(() => {
    if (!group || initializedGroupId.current === group.id) return;
    initializedGroupId.current = group.id;
    const task = setTimeout(() => {
      setValue((current) => ({
        ...current,
        participantIds: friends.map((friend) => friend.id),
      }));
    }, 0);
    return () => clearTimeout(task);
  }, [friends, group]);

  const submit = useCallback(async () => {
    const nextErrors: {
      title?: string;
      targetValue?: string;
      minimumSessionMinutes?: string;
      participantIds?: string;
      startsOn?: string;
      endsOn?: string;
    } = {};
    const parsedTarget = parsePositiveNumber(value.targetValue);
    const parsedMinimum = parsePositiveNumber(value.minimumSessionMinutes);
    const startsAt = parseDateBoundary(value.startsOn.trim(), false);
    const endsAt = parseDateBoundary(value.endsOn.trim(), true);

    if (value.title.trim().length < 3) {
      nextErrors.title = 'Gib einen Titel mit mindestens drei Zeichen ein.';
    }
    if (parsedTarget === null || (value.targetType === 'sessions' && !Number.isInteger(parsedTarget))) {
      nextErrors.targetValue = value.targetType === 'sessions'
        ? 'Gib eine positive ganze Anzahl Sessions ein.'
        : 'Gib einen positiven Zielwert ein.';
    }
    if (value.targetType === 'sessions' && (parsedMinimum === null || !Number.isInteger(parsedMinimum))) {
      nextErrors.minimumSessionMinutes = 'Gib eine positive ganze Mindestdauer ein.';
    }
    if (value.participantIds.length === 0) {
      nextErrors.participantIds = 'Wähle mindestens einen bestätigten Freund aus.';
    }
    if (!startsAt) nextErrors.startsOn = 'Gib ein gültiges Startdatum im Format JJJJ-MM-TT ein.';
    if (!endsAt) nextErrors.endsOn = 'Gib ein gültiges Enddatum im Format JJJJ-MM-TT ein.';
    if (startsAt && endsAt && endsAt <= startsAt) {
      nextErrors.endsOn = 'Das Enddatum muss nach dem Startdatum liegen.';
    }

    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0 || parsedTarget === null || !startsAt || !endsAt) return;

    const targetMinutes = value.targetType === 'duration'
      ? Math.round(parsedTarget * (value.durationUnit === 'hours' ? 60 : 1))
      : undefined;
    const targetSessions = value.targetType === 'sessions' ? parsedTarget : undefined;
    const minimumSessionMinutes = value.targetType === 'sessions' && parsedMinimum !== null
      ? parsedMinimum
      : undefined;
    const input: CreateSharedGoalInput = {
      operationId: randomUUID(),
      inviteeIds: value.participantIds,
      goal: {
        id: randomUUID(),
        title: value.title.trim(),
        description: value.description.trim(),
        type: value.targetType,
        mode: value.mode,
        targetMinutes,
        targetSessions,
        minimumSessionMinutes,
        sourcePolicy: value.sourcePolicy,
        period: 'custom',
        cadence: value.cadence,
        groupId: group?.id ?? null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    };

    setSubmitting(true);
    try {
      const challenge = await createSharedGoal(input);
      if (!challenge) throw new Error('Das gemeinsame Ziel wurde nicht zurückgegeben.');
      router.replace({
        pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
        params: { 'goal-id': challenge.id },
      });
    } catch (error) {
      setSubmitError(error instanceof Error
        ? error.message
        : 'Das gemeinsame Ziel konnte nicht erstellt werden.');
    } finally {
      setSubmitting(false);
    }
  }, [createSharedGoal, group?.id, value]);

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

  return (
    <Screen maxWidth={920}>
      <SectionHeader
        description="Lege Laufzeit, Tages- oder Wochenrhythmus und den Zielwert pro Person oder für das Team fest."
        eyebrow={group ? group.name : 'Mit Freunden lernen'}
        title="Gemeinsames Lernziel erstellen"
      />

      {(submitError || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {submitError ?? socialError}
          </Text>
        </AppCard>
      ) : null}

      <SharedGoalFormFields
        disabled={submitting || socialLoading}
        errors={errors}
        friends={friends}
        onChange={(nextValue) => {
          setValue(nextValue);
          setErrors({});
          setSubmitError(null);
        }}
        value={value}
      />

      <AppCard style={styles.periodPreview} variant="subtle">
        <View style={styles.previewCopy}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Gewählter Zeitraum</Text>
          <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {parseDateBoundary(value.startsOn, false) && parseDateBoundary(value.endsOn, true)
              ? periodPreview(
                  parseDateBoundary(value.startsOn, false) as Date,
                  parseDateBoundary(value.endsOn, true) as Date,
                )
              : 'Bitte Start- und Enddatum prüfen'}
          </Text>
        </View>
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {value.cadence === 'daily'
            ? 'Der Zielwert gilt für jeden Kalendertag innerhalb dieses Zeitraums.'
            : 'Der Zielwert gilt für jede Kalenderwoche innerhalb dieses Zeitraums.'}
        </Text>
      </AppCard>

      <AppButton
        disabled={friends.length === 0}
        fullWidth
        label="Ziel erstellen und einladen"
        loading={submitting}
        onPress={() => void submit()}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  periodPreview: { width: '100%', gap: 8 },
  previewCopy: { gap: 2 },
});
