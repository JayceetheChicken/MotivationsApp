import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GradeModalShell } from '@/components/grade-modal-shell';
import { SubjectSelector } from '@/components/subject-selector';
import { AppButton } from '@/components/ui/app-button';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import { isValidGradeDate } from '@/lib/grades';
import type { NewGrade } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { GradeAssessmentType, StudySession, Subject } from '@/types/study';

interface GradeEntryModalProps {
  onClose: () => void;
  onCreateSubject: (name: string) => Subject;
  onSave: (grade: NewGrade) => boolean;
  sessions: readonly StudySession[];
  subjects: readonly Subject[];
  userId: string;
  visible: boolean;
}

const assessmentOptions: readonly {
  type: GradeAssessmentType;
  title: string;
  description: string;
}[] = [
  {
    type: 'exam',
    title: 'Klausur',
    description: 'Großer Leistungsnachweis',
  },
  {
    type: 'other',
    title: 'Sonstiger Leistungsnachweis',
    description: 'Mündlich, schriftlich oder praktisch',
  },
];

function formatSessionDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
    : 'Datum unbekannt';
}

export function GradeEntryModal({
  onClose,
  onCreateSubject,
  onSave,
  sessions,
  subjects,
  userId,
  visible,
}: GradeEntryModalProps) {
  const theme = useAppTheme();
  const availableSubjects = useMemo(
    () => subjects.filter((subject) => !subject.archived),
    [subjects],
  );
  const [subjectId, setSubjectId] = useState(() => availableSubjects[0]?.id ?? '');
  const [assessmentType, setAssessmentType] = useState<GradeAssessmentType>('exam');
  const [title, setTitle] = useState('');
  const [assessmentDate, setAssessmentDate] = useState('');
  const [points, setPoints] = useState<number | null>(null);
  const [additionalMinutes, setAdditionalMinutes] = useState('0');
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const availableSessions = useMemo(
    () => sessions
      .filter((session) =>
        session.userId === userId &&
        session.subjectId === subjectId &&
        (!session.status || session.status === 'completed'))
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)),
    [sessions, subjectId, userId],
  );
  const selectedSessions = availableSessions.filter((session) => sessionIds.includes(session.id));
  const parsedAdditionalMinutes = Number(additionalMinutes.replace(',', '.'));
  const additionalMinutesAreValid = additionalMinutes.trim().length > 0 &&
    Number.isInteger(parsedAdditionalMinutes) && parsedAdditionalMinutes >= 0;
  const trimmedAssessmentDate = assessmentDate.trim();
  const assessmentDateIsValid = !trimmedAssessmentDate || isValidGradeDate(trimmedAssessmentDate);
  const totalStudyMinutes = selectedSessions.reduce(
    (sum, session) => sum + session.durationMinutes,
    additionalMinutesAreValid ? parsedAdditionalMinutes : 0,
  );
  const formIsValid = Boolean(
    subjectId &&
    points !== null &&
    assessmentDateIsValid &&
    additionalMinutesAreValid,
  );

  const selectSubject = (nextSubjectId: string) => {
    setSubjectId(nextSubjectId);
    setSessionIds([]);
    setError(null);
  };

  const toggleSession = (sessionId: string) => {
    setSessionIds((current) => current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]);
  };

  const save = () => {
    if (!formIsValid || points === null) return;
    const saved = onSave({
      subjectId,
      assessmentType,
      title: title.trim() || undefined,
      assessmentDate: trimmedAssessmentDate || undefined,
      points,
      additionalStudyMinutes: parsedAdditionalMinutes,
      sessionIds,
    });
    if (!saved) {
      setError('Die Note konnte nicht gespeichert werden. Prüfe bitte alle Angaben.');
      return;
    }
    onClose();
  };

  return (
    <GradeModalShell onClose={onClose} title="Neue Note eintragen" visible={visible}>
      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Fach</Text>
        <SubjectSelector
          onCreateSubject={onCreateSubject}
          onSelectSubject={(subject) => selectSubject(subject.id)}
          selectedSubjectId={subjectId}
          subjects={subjects}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Leistungsart</Text>
        <View accessibilityRole="radiogroup" style={styles.assessmentChoices}>
          {assessmentOptions.map((option) => {
            const selected = option.type === assessmentType;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.type}
                onPress={() => { setAssessmentType(option.type); setError(null); }}
                style={({ pressed }) => [
                  styles.assessmentChoice,
                  {
                    backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderRadius: theme.radii.lg,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{option.title}</Text>
                <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{option.description}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Titel (optional)</Text>
        <TextInput
          accessibilityLabel="Optionaler Titel der Leistung"
          maxLength={100}
          onChangeText={(value) => { setTitle(value); setError(null); }}
          placeholder={assessmentType === 'exam' ? 'z. B. Analysis-Klausur' : 'z. B. Referat'}
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            theme.typography.body,
            styles.textInput,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
              color: theme.colors.text,
            },
          ]}
          value={title}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Datum (optional)</Text>
        <TextInput
          accessibilityLabel="Optionales Datum im Format Jahr Monat Tag"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          onChangeText={(value) => { setAssessmentDate(value); setError(null); }}
          placeholder="JJJJ-MM-TT"
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            theme.typography.body,
            styles.textInput,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: assessmentDateIsValid ? theme.colors.border : theme.colors.danger,
              borderRadius: theme.radii.lg,
              color: theme.colors.text,
            },
          ]}
          value={assessmentDate}
        />
        {!assessmentDateIsValid ? (
          <Text accessibilityRole="alert" selectable style={[theme.typography.caption, { color: theme.colors.danger }]}>Bitte nutze ein gültiges Datum im Format JJJJ-MM-TT.</Text>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Punktzahl</Text>
        <View accessibilityRole="radiogroup" style={styles.pointsGrid}>
          {Array.from({ length: 16 }, (_, value) => {
            const selected = points === value;
            return (
              <Pressable
                accessibilityLabel={`${value} Punkte`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={value}
                onPress={() => { setPoints(value); setError(null); }}
                style={({ pressed }) => [
                  styles.pointChoice,
                  {
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
                    borderColor: selected ? theme.colors.primaryPressed : theme.colors.border,
                    borderRadius: theme.radii.md,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.label, styles.numeric, { color: selected ? theme.colors.onPrimary : theme.colors.text }]}>{value}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Lernzeit</Text>
          <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.primaryText }]}>{formatMinutes(totalStudyMinutes, true)}</Text>
        </View>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Wähle passende Sessions aus und ergänze bei Bedarf nicht erfasste Lernzeit.</Text>
        <View style={[styles.minuteInputShell, { backgroundColor: theme.colors.surfaceMuted, borderColor: additionalMinutesAreValid ? theme.colors.border : theme.colors.danger, borderRadius: theme.radii.lg }]}>
          <TextInput
            accessibilityLabel="Zusätzliche Lernzeit in Minuten"
            keyboardType="number-pad"
            maxLength={5}
            onChangeText={(value) => { setAdditionalMinutes(value); setError(null); }}
            placeholder="0"
            placeholderTextColor={theme.colors.textSubtle}
            selectTextOnFocus
            style={[theme.typography.body, styles.minuteInput, styles.numeric, { color: theme.colors.text }]}
            value={additionalMinutes}
          />
          <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>zusätzliche Minuten</Text>
        </View>
        {!additionalMinutesAreValid ? (
          <Text accessibilityRole="alert" selectable style={[theme.typography.caption, { color: theme.colors.danger }]}>Bitte gib eine ganze Zahl ab 0 ein.</Text>
        ) : null}

        <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Zugeordnete Lern-Sessions</Text>
        {availableSessions.length === 0 ? (
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Für dieses Fach gibt es noch keine abgeschlossene Session.</Text>
        ) : (
          <View style={styles.sessionChoices}>
            {availableSessions.map((session) => {
              const selected = sessionIds.includes(session.id);
              return (
                <Pressable
                  accessibilityLabel={`${formatSessionDate(session.startedAt)}, ${formatMinutes(session.durationMinutes)}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={session.id}
                  onPress={() => toggleSession(session.id)}
                  style={({ pressed }) => [
                    styles.sessionChoice,
                    {
                      backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surfaceMuted,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderRadius: theme.radii.lg,
                    },
                    pressed ? styles.pressed : undefined,
                  ]}>
                  <View style={[styles.checkmark, { backgroundColor: selected ? theme.colors.primary : theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.borderStrong }]}>
                    <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimary : theme.colors.textMuted }]}>{selected ? '✓' : ''}</Text>
                  </View>
                  <View style={styles.sessionCopy}>
                    <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{formatSessionDate(session.startedAt)}</Text>
                    <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{session.note?.trim() || 'Lern-Session'}</Text>
                  </View>
                  <View style={styles.sessionValue}>
                    <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(session.durationMinutes, true)}</Text>
                    <SourceBadge compact source={session.source} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {error ? (
        <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}

      <AppButton
        disabled={!formIsValid}
        fullWidth
        label="Note speichern"
        onPress={save}
        size="large"
      />
    </GradeModalShell>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: 12,
  },
  assessmentChoices: {
    gap: 10,
  },
  assessmentChoice: {
    minHeight: 66,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  textInput: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  pointsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pointChoice: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  minuteInputShell: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  minuteInput: {
    minWidth: 72,
    minHeight: 52,
    flex: 1,
  },
  sessionChoices: {
    gap: 8,
  },
  sessionChoice: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  checkmark: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  sessionCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  sessionValue: {
    alignItems: 'flex-end',
    gap: 4,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
