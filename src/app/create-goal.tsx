import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SegmentedControl } from '@/components/segmented-control';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { createAutomaticGoalTitle } from '@/lib/goals';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { GoalPeriod, GoalSourcePolicy, StudyGoal } from '@/types/study';

type GoalType = 'duration' | 'sessions';

const TYPE_OPTIONS = [
  { value: 'duration', label: 'Lernzeit' },
  { value: 'sessions', label: 'Sessions' },
] as const;

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
  { value: 'year', label: 'Jahr' },
] as const;

const SOURCE_OPTIONS = [
  { value: 'all', label: 'Alle Zeiten' },
  { value: 'timer_only', label: 'Nur Timer' },
] as const;

function SubjectChoice({
  label,
  color,
  selected,
  onPress,
}: {
  label: string;
  color?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.subjectChoice,
        {
          backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radii.md,
          opacity: pressed ? 0.72 : 1,
        },
      ]}>
      {color ? <View style={[styles.subjectDot, { backgroundColor: color }]} /> : null}
      <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimaryMuted : theme.colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function CreateGoalScreen() {
  const theme = useAppTheme();
  const { goalId } = useLocalSearchParams<{ goalId?: string }>();
  const { data, createGoal, updateGoal } = useStudyStore();
  const existing = data.goals.find((goal) => goal.id === goalId);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<GoalType>(existing?.type ?? 'duration');
  const [period, setPeriod] = useState<GoalPeriod>(existing?.period ?? 'week');
  const [target, setTarget] = useState(() => existing
    ? String(existing.type === 'duration' ? existing.targetMinutes : existing.targetSessions)
    : '');
  const [minimumMinutes, setMinimumMinutes] = useState(() =>
    existing?.type === 'sessions' ? String(existing.minimumSessionMinutes) : '10',
  );
  const [sourcePolicy, setSourcePolicy] = useState<GoalSourcePolicy>(existing?.sourcePolicy ?? 'all');
  const [subjectId, setSubjectId] = useState<string | undefined>(existing?.subjectIds?.[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const numericTarget = Number(target.replace(',', '.'));

  const previewGoal = useMemo<StudyGoal>(() => {
    const common = {
      id: existing?.id ?? 'preview',
      userId: data.currentUser?.id ?? 'local-user',
      period,
      sourcePolicy: type === 'sessions' ? ('timer_only' as const) : sourcePolicy,
      subjectIds: subjectId ? [subjectId] : undefined,
      status: 'active' as const,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      startsAt: existing?.startsAt ?? new Date().toISOString(),
    };
    return type === 'duration'
      ? { ...common, type, targetMinutes: Number.isFinite(numericTarget) ? Math.max(0, numericTarget) : 0 }
      : {
          ...common,
          type,
          targetSessions: Number.isFinite(numericTarget) ? Math.max(0, Math.round(numericTarget)) : 0,
          minimumSessionMinutes: Math.max(0, Number(minimumMinutes) || 0),
        };
  }, [data.currentUser?.id, existing, minimumMinutes, numericTarget, period, sourcePolicy, subjectId, type]);
  const generatedTitle = createAutomaticGoalTitle(previewGoal, data.subjects);

  const save = () => {
    if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
      setError('Bitte gib einen Zielwert größer als 0 ein.');
      return;
    }
    const minimum = Number(minimumMinutes);
    if (type === 'sessions' && (!Number.isFinite(minimum) || minimum < 1)) {
      setError('Die Mindestdauer muss mindestens 1 Minute betragen.');
      return;
    }

    setSaving(true);
    const input = {
      title: title.trim() || undefined,
      type,
      target: numericTarget,
      subjectId,
      sourcePolicy: type === 'sessions' ? ('timer_only' as const) : sourcePolicy,
      period,
      minimumSessionMinutes: type === 'sessions' ? Math.round(minimum) : undefined,
    };
    if (existing) {
      updateGoal(existing.id, { ...input, title: title.trim() || null, subjectId: subjectId ?? null });
    } else {
      createGoal(input);
    }
    setSaving(false);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen
      contentContainerStyle={styles.form}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maxWidth={720}>
      <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
        {existing
          ? 'Passe dein Ziel an. Bereits erfasste Lernzeit wird danach mit den neuen Regeln ausgewertet.'
          : 'Lege ein realistisches Ziel fest. Es zählt erst ab dem Zeitpunkt seiner Erstellung.'}
      </Text>

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Titel (optional)</Text>
          <TextInput
            accessibilityLabel="Eigener Zieltitel"
            maxLength={60}
            onChangeText={setTitle}
            placeholder={generatedTitle}
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.body,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.borderStrong,
                borderRadius: theme.radii.md,
              },
            ]}
            value={title}
          />
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Ohne eigenen Titel: „{generatedTitle}“
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zieltyp</Text>
          <SegmentedControl
            accessibilityLabel="Zieltyp"
            onChange={(nextType) => {
              setType(nextType);
              if (nextType === 'sessions') setSourcePolicy('timer_only');
              setError(null);
            }}
            options={TYPE_OPTIONS}
            value={type}
          />
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zeitraum</Text>
          <SegmentedControl accessibilityLabel="Zielzeitraum" onChange={setPeriod} options={PERIOD_OPTIONS} value={period} />
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {type === 'duration' ? 'Zielwert in Minuten' : 'Anzahl Sessions'}
          </Text>
          <TextInput
            accessibilityLabel={type === 'duration' ? 'Zielwert in Minuten' : 'Anzahl Sessions'}
            keyboardType="number-pad"
            onChangeText={(value) => { setTarget(value); setError(null); }}
            placeholder={type === 'duration' ? '120' : '3'}
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.heading,
              styles.numeric,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
                borderRadius: theme.radii.md,
              },
            ]}
            value={target}
          />
        </View>

        {type === 'sessions' ? (
          <View style={styles.field}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Mindestdauer je Session</Text>
            <TextInput
              accessibilityLabel="Mindestdauer je Session in Minuten"
              keyboardType="number-pad"
              onChangeText={(value) => { setMinimumMinutes(value); setError(null); }}
              style={[
                styles.input,
                theme.typography.body,
                { color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md },
              ]}
              value={minimumMinutes}
            />
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Sessionziele zählen ausschließlich automatisch gemessene Timer-Sessions.</Text>
          </View>
        ) : null}
      </AppCard>

      {type === 'duration' ? (
        <AppCard style={styles.section}>
          <View style={styles.field}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Welche Lernzeit zählt?</Text>
            <SegmentedControl
              accessibilityLabel="Zeitquelle für das Ziel"
              onChange={setSourcePolicy}
              options={SOURCE_OPTIONS}
              value={sourcePolicy}
            />
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              „Nur Timer“ eignet sich besonders für nachvollziehbare soziale Vergleiche.
            </Text>
          </View>
        </AppCard>
      ) : null}

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Fach (optional)</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Ohne Auswahl zählen alle Fächer.</Text>
          <View accessibilityRole="radiogroup" style={styles.subjectChoices}>
            <SubjectChoice label="Alle Fächer" onPress={() => setSubjectId(undefined)} selected={!subjectId} />
            {data.subjects.filter((subject) => !subject.archived).map((subject) => (
              <SubjectChoice
                color={subject.color}
                key={subject.id}
                label={subject.name}
                onPress={() => setSubjectId(subject.id)}
                selected={subjectId === subject.id}
              />
            ))}
          </View>
        </View>
      </AppCard>

      {error ? (
        <Text accessibilityRole="alert" style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}
      <AppButton
        fullWidth
        label={existing ? 'Änderungen speichern' : 'Ziel erstellen'}
        loading={saving}
        onPress={save}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 20 },
  section: { width: '100%', gap: 24 },
  field: { width: '100%', gap: 10 },
  input: { width: '100%', minHeight: 52, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  subjectChoices: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  subjectChoice: { minHeight: 48, minWidth: 145, flexGrow: 1, flexBasis: '40%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 14 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  numeric: { fontVariant: ['tabular-nums'] },
});
