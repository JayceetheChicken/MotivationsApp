import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { formatMinutes } from '@/lib/format';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { GoalSourcePolicy } from '@/types/study';

type GoalType = 'duration' | 'sessions';
type FormErrors = Partial<Record<'title' | 'target', string>>;

function ChoiceButton({
  label,
  description,
  selected,
  disabled = false,
  onPress,
  style,
  color,
}: {
  label: string;
  description?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  const theme = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.choice,
        {
          minHeight: theme.layout.minTouchTarget,
          borderRadius: theme.radii.md,
          borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
          backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
        },
        pressed && !disabled ? { backgroundColor: theme.colors.surfacePressed } : undefined,
        disabled ? styles.disabled : undefined,
        style,
      ]}>
      {color ? <View style={[styles.colorDot, { backgroundColor: color }]} /> : null}
      <View style={styles.choiceCopy}>
        <Text
          style={[
            theme.typography.label,
            { color: selected ? theme.colors.onPrimaryMuted : theme.colors.text },
          ]}>
          {label}
        </Text>
        {description ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.radio,
          {
            borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
            backgroundColor: selected ? theme.colors.primary : 'transparent',
          },
        ]}>
        {selected ? <View style={[styles.radioInner, { backgroundColor: theme.colors.onPrimary }]} /> : null}
      </View>
    </Pressable>
  );
}

export default function CreateGoalScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { data, addGoal } = useStudyStore();
  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('duration');
  const [target, setTarget] = useState('300');
  const [sourcePolicy, setSourcePolicy] = useState<GoalSourcePolicy>('all');
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  const numericTarget = Number(target.trim().replace(',', '.'));
  const targetPreview =
    goalType === 'duration' && Number.isFinite(numericTarget) && numericTarget > 0
      ? formatMinutes(numericTarget)
      : null;

  const selectGoalType = (nextType: GoalType) => {
    setGoalType(nextType);
    setTarget(nextType === 'duration' ? '300' : '4');
    setErrors((current) => ({ ...current, target: undefined }));

    if (nextType === 'sessions') {
      setSourcePolicy('timer_only');
    }
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};
    const normalizedTitle = title.trim();
    const normalizedTarget = target.trim();

    if (normalizedTitle.length < 3) {
      nextErrors.title = 'Bitte gib einen Titel mit mindestens 3 Zeichen ein.';
    }

    if (!/^\d+$/.test(normalizedTarget) || !Number.isFinite(numericTarget)) {
      nextErrors.target = 'Bitte gib eine ganze Zahl ein.';
    } else if (goalType === 'duration' && (numericTarget < 15 || numericTarget > 10_080)) {
      nextErrors.target = 'Wähle zwischen 15 und 10.080 Minuten.';
    } else if (goalType === 'sessions' && (numericTarget < 1 || numericTarget > 100)) {
      nextErrors.target = 'Wähle zwischen 1 und 100 Sessions.';
    }

    return nextErrors;
  };

  const saveGoal = () => {
    if (isSaving) return;
    const nextErrors = validate();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSaving(true);
    addGoal({
      title: title.trim(),
      type: goalType,
      target: numericTarget,
      sourcePolicy: goalType === 'sessions' ? 'timer_only' : sourcePolicy,
      subjectId,
    });
    router.back();
  };

  return (
    <Screen
      contentContainerStyle={styles.form}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maxWidth={720}>
      <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
        Lege ein persönliches Wochenziel fest. Fortschritt wird ab sofort automatisch angerechnet.
      </Text>

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zieltitel</Text>
          <TextInput
            accessibilityLabel="Zieltitel"
            autoCapitalize="sentences"
            autoCorrect
            maxLength={60}
            onChangeText={(value: string) => {
              setTitle(value);
              if (errors.title) setErrors((current) => ({ ...current, title: undefined }));
            }}
            placeholder="z. B. Fünf Stunden pro Woche"
            placeholderTextColor={theme.colors.textSubtle}
            returnKeyType="next"
            style={[
              styles.input,
              theme.typography.body,
              {
                minHeight: 52,
                borderRadius: theme.radii.md,
                borderColor: errors.title ? theme.colors.danger : theme.colors.borderStrong,
                backgroundColor: theme.colors.surface,
                color: theme.colors.text,
              },
            ]}
            value={title}
          />
          {errors.title ? (
            <Text
              accessibilityRole="alert"
              selectable
              style={[theme.typography.caption, { color: theme.colors.danger }]}>
              {errors.title}
            </Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zieltyp</Text>
          <View accessibilityRole="radiogroup" style={styles.twoColumnChoices}>
            <ChoiceButton
              description="Gesamte Lernzeit erreichen"
              label="Dauer"
              onPress={() => selectGoalType('duration')}
              selected={goalType === 'duration'}
              style={styles.flexChoice}
            />
            <ChoiceButton
              description="Konzentrierte Sessions schaffen"
              label="Sessions"
              onPress={() => selectGoalType('sessions')}
              selected={goalType === 'sessions'}
              style={styles.flexChoice}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Zielwert</Text>
          <View
            style={[
              styles.targetInputRow,
              {
                minHeight: 52,
                borderRadius: theme.radii.md,
                borderColor: errors.target ? theme.colors.danger : theme.colors.borderStrong,
                backgroundColor: theme.colors.surface,
              },
            ]}>
            <TextInput
              accessibilityLabel={goalType === 'duration' ? 'Zielwert in Minuten' : 'Anzahl Sessions'}
              keyboardType="number-pad"
              maxLength={5}
              onChangeText={(value: string) => {
                setTarget(value);
                if (errors.target) setErrors((current) => ({ ...current, target: undefined }));
              }}
              placeholder={goalType === 'duration' ? '300' : '4'}
              placeholderTextColor={theme.colors.textSubtle}
              returnKeyType="done"
              style={[
                styles.targetInput,
                theme.typography.heading,
                { color: theme.colors.text },
              ]}
              value={target}
            />
            <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
              {goalType === 'duration' ? 'Minuten' : 'Sessions'}
            </Text>
          </View>
          {errors.target ? (
            <Text
              accessibilityRole="alert"
              selectable
              style={[theme.typography.caption, { color: theme.colors.danger }]}>
              {errors.target}
            </Text>
          ) : targetPreview ? (
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Entspricht {targetPreview}
            </Text>
          ) : null}
        </View>
      </AppCard>

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Welche Zeit zählt?</Text>
          <View accessibilityRole="radiogroup" style={styles.choiceStack}>
            <ChoiceButton
              description="Timer und manuell eingetragene Lernzeit"
              disabled={goalType === 'sessions'}
              label="Alle Lernzeiten"
              onPress={() => setSourcePolicy('all')}
              selected={sourcePolicy === 'all' && goalType === 'duration'}
            />
            <ChoiceButton
              description="Nur automatisch gemessene Zeit"
              label="Nur Timer"
              onPress={() => setSourcePolicy('timer_only')}
              selected={sourcePolicy === 'timer_only' || goalType === 'sessions'}
            />
          </View>
          {goalType === 'sessions' ? (
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Sessionziele zählen nur automatisch gemessene Timer-Sessions.
            </Text>
          ) : null}
        </View>
      </AppCard>

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Fach (optional)</Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Ohne Auswahl zählen Lernzeiten aus allen Fächern.
          </Text>
          <View accessibilityRole="radiogroup" style={styles.subjectChoices}>
            <ChoiceButton
              label="Alle Fächer"
              onPress={() => setSubjectId(undefined)}
              selected={subjectId === undefined}
              style={styles.subjectChoice}
            />
            {data.subjects
              .filter((subject) => !subject.archived)
              .map((subject) => (
                <ChoiceButton
                  color={subject.color}
                  key={subject.id}
                  label={subject.name}
                  onPress={() => setSubjectId(subject.id)}
                  selected={subjectId === subject.id}
                  style={styles.subjectChoice}
                />
              ))}
          </View>
        </View>
      </AppCard>

      <AppButton
        fullWidth
        label="Ziel speichern"
        loading={isSaving}
        onPress={saveGoal}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 20,
  },
  section: {
    width: '100%',
    gap: 24,
  },
  field: {
    width: '100%',
    gap: 10,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  targetInputRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  targetInput: {
    minHeight: 50,
    flex: 1,
    paddingVertical: 8,
    fontVariant: ['tabular-nums'],
  },
  twoColumnChoices: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  flexChoice: {
    flex: 1,
  },
  choiceStack: {
    width: '100%',
    gap: 10,
  },
  choice: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choiceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  disabled: {
    opacity: 0.45,
  },
  radio: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 10,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  subjectChoices: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  subjectChoice: {
    minWidth: 160,
    flexGrow: 1,
    flexBasis: '45%',
  },
});
