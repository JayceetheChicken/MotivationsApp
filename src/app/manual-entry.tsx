import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SubjectChip } from '@/components/subject-chip';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SourceBadge } from '@/components/ui/source-badge';
import { toLocalDateInput } from '@/lib/format';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

const quickDurations = [15, 30, 45, 60];

export default function ManualEntryScreen() {
  const theme = useAppTheme();
  const { data, addManualEntry } = useStudyStore();
  const [subjectId, setSubjectId] = useState(() => data.subjects[0]?.id ?? '');
  const [duration, setDuration] = useState('30');
  const [studiedOn, setStudiedOn] = useState(() => toLocalDateInput(new Date()));
  const [note, setNote] = useState('');
  const parsedDuration = Number(duration.replace(',', '.'));
  const isValid = Boolean(subjectId) && Number.isFinite(parsedDuration) && parsedDuration >= 1 && parsedDuration <= 720;
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

  const save = () => {
    if (!isValid) return;
    addManualEntry({
      subjectId,
      durationMinutes: parsedDuration,
      studiedOn,
      note,
    });
    router.back();
  };

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      maxWidth={720}
      contentContainerStyle={styles.content}>
      <AppCard variant="highlight" style={styles.sourceInfo}>
        <SourceBadge source="manual" />
        <View style={styles.sourceCopy}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Transparent erfasst</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Der Eintrag zählt zu deinem persönlichen Fortschritt, bleibt in Vergleichen aber klar als manuell gekennzeichnet.
          </Text>
        </View>
      </AppCard>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Fach</Text>
        <View accessibilityRole="radiogroup" style={styles.wrapRow}>
          {data.subjects.filter((subject) => !subject.archived).map((subject) => (
            <SubjectChip
              key={subject.id}
              onPress={() => setSubjectId(subject.id)}
              selected={subjectId === subject.id}
              subject={subject}
            />
          ))}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Dauer</Text>
          {!isValid && duration.length > 0 ? (
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
                    backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.label, { color: selected ? theme.colors.primary : theme.colors.text }]}>
                  {minutes === 60 ? '1 Stunde' : `${minutes} Min.`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.inputShell, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
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
                onPress={() => setStudiedOn(option.value)}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.label, { color: selected ? theme.colors.primary : theme.colors.text }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Notiz</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>Optional</Text>
        </View>
        <TextInput
          accessibilityLabel="Notiz zum Lerneintrag"
          maxLength={180}
          multiline
          onChangeText={setNote}
          placeholder="Was hast du geschafft?"
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            theme.typography.body,
            styles.noteInput,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
          textAlignVertical="top"
          value={note}
        />
      </View>

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
  },
  sourceCopy: {
    flex: 1,
    gap: 3,
  },
  fieldGroup: {
    gap: 13,
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
  noteInput: {
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
});
