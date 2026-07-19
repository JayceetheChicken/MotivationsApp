import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AccountRequiredCta,
  SharedGoalFormFields,
  type SharedGoalFormErrors,
  type SharedGoalFormValue,
  type SharedGoalPeriod,
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

const INITIAL_VALUE: SharedGoalFormValue = {
  title: '',
  description: '',
  mode: 'per_participant',
  targetType: 'duration',
  durationUnit: 'hours',
  period: 'week',
  sourcePolicy: 'all',
  targetValue: '',
  minimumSessionMinutes: '10',
  participantIds: [],
};

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function periodBounds(period: SharedGoalPeriod, reference = new Date()): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(reference);
  startsAt.setHours(0, 0, 0, 0);

  if (period === 'week') {
    const daysSinceMonday = (startsAt.getDay() + 6) % 7;
    startsAt.setDate(startsAt.getDate() - daysSinceMonday);
  } else if (period === 'month') {
    startsAt.setDate(1);
  }

  const endsAt = new Date(startsAt);
  if (period === 'day') endsAt.setDate(endsAt.getDate() + 1);
  if (period === 'week') endsAt.setDate(endsAt.getDate() + 7);
  if (period === 'month') endsAt.setMonth(endsAt.getMonth() + 1);
  return { startsAt, endsAt };
}

function periodPreview(period: SharedGoalPeriod, startsAt: Date, endsAt: Date): string {
  const formatter = new Intl.DateTimeFormat('de-DE', {
    weekday: period === 'day' ? 'long' : undefined,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const inclusiveEnd = new Date(endsAt.getTime() - 1);
  if (period === 'day') return formatter.format(startsAt);
  return `${formatter.format(startsAt)} bis ${formatter.format(inclusiveEnd)}`;
}

export default function CreateSharedGoalScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const {
    socialLoading,
    socialError,
    friendConnections,
    refreshSocial,
    createSharedGoal,
  } = useStudyStore();
  const [value, setValue] = useState<SharedGoalFormValue>(INITIAL_VALUE);
  const [errors, setErrors] = useState<SharedGoalFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.activeMode === 'supabase') void refreshSocial();
  }, [auth.activeMode, refreshSocial]);

  const friends = useMemo<readonly SocialUserSummary[]>(
    () => friendConnections
      .filter((connection) => connection.status === 'accepted')
      .map((connection) => ({
        id: connection.otherUser.id,
        username: connection.otherUser.username,
        displayName: connection.otherUser.displayName,
        avatarUrl: connection.otherUser.avatarUrl,
      })),
    [friendConnections],
  );
  const bounds = useMemo(() => periodBounds(value.period), [value.period]);

  const submit = useCallback(async () => {
    const nextErrors: {
      title?: string;
      targetValue?: string;
      minimumSessionMinutes?: string;
      participantIds?: string;
    } = {};
    const parsedTarget = parsePositiveNumber(value.targetValue);
    const parsedMinimum = parsePositiveNumber(value.minimumSessionMinutes);

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

    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0 || parsedTarget === null) return;

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
        period: value.period,
        startsAt: bounds.startsAt.toISOString(),
        endsAt: bounds.endsAt.toISOString(),
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
  }, [bounds.endsAt, bounds.startsAt, createSharedGoal, value]);

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
        description="Lege fest, ob jede Person dasselbe Ziel erreicht oder alle Beiträge gemeinsam zählen."
        eyebrow="Mit Freunden lernen"
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
            {periodPreview(value.period, bounds.startsAt, bounds.endsAt)}
          </Text>
        </View>
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          Die endgültigen Grenzen berechnet der Server anhand deiner gespeicherten Zeitzone. Es werden keine optionalen Datumsfelder gespeichert.
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
