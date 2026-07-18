import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SegmentedControl } from '@/components/segmented-control';
import { SubjectSelector } from '@/components/subject-selector';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { getGoalSubjectId } from '@/lib/goals';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { GoalPeriod, GoalSourcePolicy } from '@/types/study';

type GoalType = 'duration' | 'sessions';
type DurationUnit = 'minutes' | 'hours';

const TYPE_OPTIONS = [
  { value: 'duration', label: 'Lernzeit' },
  { value: 'sessions', label: 'Sessions' },
] as const;

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Täglich' },
  { value: 'week', label: 'Wöchentlich' },
  { value: 'month', label: 'Monatlich' },
] as const;

const LEGACY_YEAR_OPTION = { value: 'year', label: 'Jährlich' } as const;
const LEGACY_CUSTOM_OPTION = { value: 'custom', label: 'Eigener Zeitraum' } as const;

const SOURCE_OPTIONS = [
  { value: 'all', label: 'Alle Zeiten' },
  { value: 'timer_only', label: 'Nur Timer' },
] as const;

const DURATION_UNIT_OPTIONS = [
  { value: 'minutes', label: 'Minuten' },
  { value: 'hours', label: 'Stunden' },
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
          backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radii.lg,
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
  const { data, addSubject, createGoal, updateGoal } = useStudyStore();
  const existing = data.goals.find((goal) => goal.id === goalId);
  const existingDurationUsesHours = existing?.type === 'duration'
    && existing.targetMinutes >= 60
    && existing.targetMinutes % 60 === 0;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<GoalType>(existing?.type ?? 'duration');
  const [period, setPeriod] = useState<GoalPeriod>(existing?.period ?? 'week');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(existingDurationUsesHours ? 'hours' : 'minutes');
  const [target, setTarget] = useState(() => {
    if (!existing) return '';
    if (existing.type === 'sessions') return String(existing.targetSessions);
    return String(existingDurationUsesHours ? existing.targetMinutes / 60 : existing.targetMinutes);
  });
  const [minimumMinutes, setMinimumMinutes] = useState(() =>
    existing?.type === 'sessions' ? String(existing.minimumSessionMinutes) : '10',
  );
  const [sourcePolicy, setSourcePolicy] = useState<GoalSourcePolicy>(existing?.sourcePolicy ?? 'all');
  const [subjectId, setSubjectId] = useState<string | undefined>(
    existing ? getGoalSubjectId(existing) ?? undefined : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const numericTarget = Number(target.replace(',', '.'));
  const targetValue = type === 'duration' && durationUnit === 'hours'
    ? numericTarget * 60
    : numericTarget;
  const periodOptions = useMemo(
    () => {
      if (period === 'year') return [...PERIOD_OPTIONS, LEGACY_YEAR_OPTION];
      if (period === 'custom') return [...PERIOD_OPTIONS, LEGACY_CUSTOM_OPTION];
      return PERIOD_OPTIONS;
    },
    [period],
  );

  const clearError = () => setError(null);

  const save = () => {
    if (!title.trim()) {
      setError('Bitte gib deinem Ziel einen Titel.');
      return;
    }
    if (!subjectId) {
      setError('Bitte wähle ein Fach für das Ziel aus.');
      return;
    }
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
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
      title: title.trim(),
      type,
      target: type === 'duration' ? Math.round(targetValue) : Math.round(numericTarget),
      subjectId,
      sourcePolicy,
      period,
      minimumSessionMinutes: type === 'sessions' ? Math.round(minimum) : undefined,
    };
    if (existing) {
      updateGoal(existing.id, input);
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
          ? 'Passe dein Ziel an. Bereits zugeordnete Sessions bleiben mit diesem Ziel verbunden.'
          : 'Lege ein realistisches Ziel fest. Sessions zählen nur, wenn sie ausdrücklich für dieses Ziel gestartet oder eingetragen werden.'}
      </Text>

      <AppCard style={[styles.section, { borderTopColor: theme.colors.primary, borderTopWidth: 4 }]}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Titel</Text>
          <TextInput
            accessibilityLabel="Zieltitel"
            maxLength={60}
            onChangeText={(value) => { setTitle(value); clearError(); }}
            placeholder="z. B. Matheprüfung vorbereiten"
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.body,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.accentBrownMuted,
                borderRadius: theme.radii.lg,
              },
            ]}
            value={title}
          />
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zieltyp</Text>
          <SegmentedControl
            accessibilityLabel="Zieltyp"
            onChange={(nextType) => {
              setType(nextType);
              clearError();
            }}
            options={TYPE_OPTIONS}
            value={type}
          />
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zeitraum</Text>
          <View accessibilityRole="radiogroup" style={styles.periodChoices}>
            {periodOptions.map((option) => (
              <SubjectChoice
                key={option.value}
                label={option.label}
                onPress={() => { setPeriod(option.value); clearError(); }}
                selected={period === option.value}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Fach</Text>
          <SubjectSelector
            onCreateSubject={addSubject}
            onSelectSubject={(subject) => { setSubjectId(subject.id); clearError(); }}
            selectedSubjectId={subjectId}
            subjects={data.subjects}
          />
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zielwert</Text>
          {type === 'duration' ? (
            <SegmentedControl
              accessibilityLabel="Einheit des Lernzeitziels"
              onChange={setDurationUnit}
              options={DURATION_UNIT_OPTIONS}
              value={durationUnit}
            />
          ) : null}
          <TextInput
            accessibilityLabel={type === 'duration' ? `Zielwert in ${durationUnit === 'hours' ? 'Stunden' : 'Minuten'}` : 'Anzahl Sessions'}
            keyboardType="decimal-pad"
            onChangeText={(value) => { setTarget(value); clearError(); }}
            placeholder={type === 'duration' ? (durationUnit === 'hours' ? '2' : '120') : '3'}
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.heading,
              styles.numeric,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.accentPeachMuted,
                borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
                borderRadius: theme.radii.lg,
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
              onChangeText={(value) => { setMinimumMinutes(value); clearError(); }}
              style={[styles.input, theme.typography.body, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.accentBrownMuted, borderRadius: theme.radii.lg }]}
              value={minimumMinutes}
            />
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Nur Einträge ab dieser Dauer zählen als vollständige Session. Die erlaubte Quelle legst du darunter fest.</Text>
          </View>
        ) : null}
      </AppCard>

      <AppCard style={[styles.section, { borderLeftColor: theme.colors.accentMustard, borderLeftWidth: 4 }]}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Welche Lernzeit zählt?</Text>
          <SegmentedControl
            accessibilityLabel="Zeitquelle für das Ziel"
            onChange={setSourcePolicy}
            options={SOURCE_OPTIONS}
            value={sourcePolicy}
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            „Alle Zeiten“ lässt auch bewusst zugeordnete manuelle Einträge zählen. „Nur Timer“ eignet sich besonders für soziale Vergleiche.
          </Text>
        </View>
      </AppCard>

      {error ? (
        <Text accessibilityRole="alert" style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}
      <AppButton
        disabled={!subjectId}
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
  periodChoices: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  subjectChoice: { minHeight: 48, minWidth: 145, flexGrow: 1, flexBasis: '40%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 14 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  numeric: { fontVariant: ['tabular-nums'] },
});
