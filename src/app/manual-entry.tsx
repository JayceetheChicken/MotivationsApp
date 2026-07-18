import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SubjectSelector } from '@/components/subject-selector';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SourceBadge } from '@/components/ui/source-badge';
import { toLocalDateInput } from '@/lib/format';
import { getGoalSubjectId } from '@/lib/goals';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

const quickDurations = [15, 30, 45, 60];

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export default function ManualEntryScreen() {
  const theme = useAppTheme();
  const { data, addManualEntry, addSubject } = useStudyStore();
  const [subjectId, setSubjectId] = useState(() => data.subjects[0]?.id ?? '');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [duration, setDuration] = useState('30');
  const [studiedOn, setStudiedOn] = useState(() => toLocalDateInput(new Date()));
  const [error, setError] = useState<string | null>(null);
  const parsedDuration = Number(duration.replace(',', '.'));
  const durationIsValid = Number.isFinite(parsedDuration) && parsedDuration >= 1 && parsedDuration <= 720;
  const dateIsValid = isValidDateInput(studiedOn);
  const isValid = Boolean(subjectId) && durationIsValid && dateIsValid;
  const dateOptions = useMemo(
    () => [
      { label: 'Heute', offset: 0 },
      { label: 'Gestern', offset: -1 },
      { label: 'Vorgestern', offset: -2 },
    ].map((option) => {
      const date = new Date();
      date.setDate(date.getDate() + option.offset);
      return { ...option, value: toLocalDateInput(date) };
    }),
    [],
  );
  const availableSubjects = data.subjects.filter((subject) => !subject.archived);
  const assignableGoals = data.goals.filter((goal) => {
    const goalSubjectId = getGoalSubjectId(goal);
    return goal.status === 'active'
      && goal.sourcePolicy === 'all'
      && Boolean(goalSubjectId)
      && availableSubjects.some((subject) => subject.id === goalSubjectId);
  });
  const selectedGoal = assignableGoals.find((goal) => goal.id === goalId);

  const selectGoal = (nextGoalId: string | null) => {
    setGoalId(nextGoalId);
    setError(null);
    const goal = assignableGoals.find((candidate) => candidate.id === nextGoalId);
    const goalSubjectId = goal ? getGoalSubjectId(goal) : null;
    if (goalSubjectId) setSubjectId(goalSubjectId);
  };

  const save = () => {
    if (!isValid) return;
    const saved = addManualEntry({
      subjectId,
      goalId,
      durationMinutes: parsedDuration,
      studiedOn,
    });
    if (!saved) {
      setError('Der Eintrag konnte nicht gespeichert werden. Prüfe bitte Ziel, Fach und Datum.');
      return;
    }
    router.back();
  };

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      maxWidth={720}
      contentContainerStyle={styles.content}>
      <AppCard
        variant="highlight"
        style={[
          styles.sourceInfo,
          {
            backgroundColor: theme.colors.accentPeachMuted,
            borderLeftColor: theme.colors.primary,
          },
        ]}>
        <SourceBadge source="manual" />
        <View style={styles.sourceCopy}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Transparent erfasst</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Der Eintrag zählt zu deinem persönlichen Fortschritt, bleibt in Vergleichen aber klar als manuell gekennzeichnet.
          </Text>
        </View>
      </AppCard>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Lernziel</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>Optional</Text>
        </View>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          Nur der Eintrag mit der passenden Ziel-ID wird diesem Ziel angerechnet.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.goalChoices}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: !goalId }}
            onPress={() => selectGoal(null)}
            style={({ pressed }) => [
              styles.goalChoice,
              {
                backgroundColor: !goalId ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                borderColor: !goalId ? theme.colors.primary : theme.colors.border,
                borderRadius: theme.radii.lg,
              },
              pressed ? styles.pressed : undefined,
            ]}>
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Freie Lernzeit</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Keinem Ziel zuordnen</Text>
          </Pressable>
          {assignableGoals.map((goal) => {
            const selected = goal.id === goalId;
            const subject = availableSubjects.find((candidate) => candidate.id === getGoalSubjectId(goal));
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={goal.id}
                onPress={() => selectGoal(goal.id)}
                style={({ pressed }) => [
                  styles.goalChoice,
                  {
                    backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderRadius: theme.radii.lg,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{goal.title || 'Lernziel'}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{subject?.name ?? 'Fach nicht verfügbar'}</Text>
              </Pressable>
            );
          })}
        </View>
        {assignableGoals.length === 0 ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>
            Aktuell gibt es kein aktives Ziel, das manuell erfasste Lernzeit zulässt.
          </Text>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Fach</Text>
        {selectedGoal ? (
          <AppCard style={styles.lockedSubject} variant="subtle">
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Durch das Lernziel festgelegt</Text>
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
              {availableSubjects.find((subject) => subject.id === subjectId)?.name ?? 'Fach nicht verfügbar'}
            </Text>
          </AppCard>
        ) : (
          <SubjectSelector
            onCreateSubject={addSubject}
            onSelectSubject={(subject) => { setSubjectId(subject.id); setGoalId(null); setError(null); }}
            selectedSubjectId={subjectId}
            subjects={data.subjects}
          />
        )}
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Dauer</Text>
          {!durationIsValid && duration.length > 0 ? (
            <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>1 bis 720 Minuten</Text>
          ) : null}
        </View>
        <View style={styles.wrapRow}>
          {quickDurations.map((minutes) => {
            const selected = parsedDuration === minutes;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={minutes}
                onPress={() => setDuration(String(minutes))}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimaryMuted : theme.colors.text }]}>
                  {minutes === 60 ? '1 Stunde' : `${minutes} Min.`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View
          style={[
            styles.inputShell,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.accentBrownMuted,
            },
          ]}>
          <TextInput
            accessibilityLabel="Lerndauer in Minuten"
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={setDuration}
            placeholder="Eigene Dauer"
            placeholderTextColor={theme.colors.textSubtle}
            selectTextOnFocus
            style={[theme.typography.body, styles.input, { color: theme.colors.text }]}
            value={duration}
          />
          <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Minuten</Text>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Lerntag</Text>
        <View accessibilityRole="radiogroup" style={styles.wrapRow}>
          {dateOptions.map((option) => {
            const selected = studiedOn === option.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.value}
                onPress={() => { setStudiedOn(option.value); setError(null); }}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimaryMuted : theme.colors.text }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          accessibilityLabel="Eigenes Lerndatum im Format Jahr Monat Tag"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          onChangeText={(value) => { setStudiedOn(value); setError(null); }}
          placeholder="JJJJ-MM-TT"
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            theme.typography.body,
            styles.subjectNameInput,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: dateIsValid ? theme.colors.accentBrownMuted : theme.colors.danger,
              borderRadius: theme.radii.lg,
            },
          ]}
          value={studiedOn}
        />
        {!dateIsValid ? (
          <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>Bitte nutze ein gültiges Datum im Format JJJJ-MM-TT.</Text>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}

      <AppButton
        disabled={!isValid}
        fullWidth
        label="Lernzeit speichern"
        onPress={save}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 30,
  },
  sourceInfo: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 14,
    borderLeftWidth: 4,
  },
  sourceCopy: {
    flex: 1,
    gap: 3,
  },
  fieldGroup: {
    gap: 13,
  },
  goalChoices: {
    gap: 10,
  },
  goalChoice: {
    width: '100%',
    minHeight: 64,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
  },
  lockedSubject: {
    gap: 4,
  },
  subjectNameInput: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  choice: {
    minHeight: 48,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  inputShell: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 14,
  },
  input: {
    flex: 1,
    minHeight: 54,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
});
