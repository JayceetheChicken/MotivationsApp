import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { SegmentedControl } from '@/components/segmented-control';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/theme';

import type {
  SharedGoalDurationUnit,
  SharedGoalCadence,
  SharedGoalFormValue,
  SharedGoalMode,
  SharedGoalSourcePolicy,
  SharedGoalTargetType,
  SocialUserSummary,
} from './types';

const TARGET_TYPE_OPTIONS: readonly { value: SharedGoalTargetType; label: string }[] = [
  { value: 'duration', label: 'Lernzeit' },
  { value: 'sessions', label: 'Sessions' },
];

const MODE_OPTIONS: readonly { value: SharedGoalMode; label: string }[] = [
  { value: 'per_participant', label: 'Pro Person' },
  { value: 'shared', label: 'Gemeinsam' },
];

const CADENCE_OPTIONS: readonly { value: SharedGoalCadence; label: string }[] = [
  { value: 'daily', label: 'Täglich' },
  { value: 'weekly', label: 'Wöchentlich' },
];

const SOURCE_OPTIONS: readonly { value: SharedGoalSourcePolicy; label: string }[] = [
  { value: 'all', label: 'Alle Zeiten' },
  { value: 'timer_only', label: 'Nur Timer' },
];

const DURATION_UNIT_OPTIONS: readonly { value: SharedGoalDurationUnit; label: string }[] = [
  { value: 'minutes', label: 'Minuten' },
  { value: 'hours', label: 'Stunden' },
];

export type SharedGoalFormErrors = Partial<
  Readonly<Record<
    'title' | 'targetValue' | 'minimumSessionMinutes' | 'participantIds' | 'startsOn' | 'endsOn',
    string
  >>
>;

export type SharedGoalFormFieldsProps = {
  value: SharedGoalFormValue;
  friends: readonly SocialUserSummary[];
  onChange: (value: SharedGoalFormValue) => void;
  errors?: SharedGoalFormErrors;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function FieldError({ message }: { message?: string }) {
  const theme = useAppTheme();
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      selectable
      style={[theme.typography.caption, { color: theme.colors.danger }]}>
      {message}
    </Text>
  );
}

export function SharedGoalFormFields({
  value,
  friends,
  onChange,
  errors,
  disabled = false,
  style,
}: SharedGoalFormFieldsProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= theme.layout.tabletBreakpoint;
  const update = <Key extends keyof SharedGoalFormValue>(
    key: Key,
    nextValue: SharedGoalFormValue[Key],
  ) => onChange({ ...value, [key]: nextValue });

  const toggleParticipant = (userId: string) => {
    const isSelected = value.participantIds.includes(userId);
    update(
      'participantIds',
      isSelected
        ? value.participantIds.filter((participantId) => participantId !== userId)
        : [...value.participantIds, userId],
    );
  };

  const inputStyle = [
    styles.input,
    theme.typography.body,
    {
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radii.lg,
    },
  ];

  return (
    <View style={[styles.form, style]} testID="shared-goal-form-fields">
      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
            Titel
          </Text>
          <TextInput
            accessibilityLabel="Titel des gemeinsamen Lernziels"
            editable={!disabled}
            maxLength={60}
            onChangeText={(text) => update('title', text)}
            placeholder="z. B. Gemeinsam für die Prüfung lernen"
            placeholderTextColor={theme.colors.textSubtle}
            style={inputStyle}
            value={value.title}
          />
          <FieldError message={errors?.title} />
        </View>

        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
            Beschreibung
          </Text>
          <TextInput
            accessibilityLabel="Beschreibung des gemeinsamen Lernziels"
            editable={!disabled}
            maxLength={240}
            multiline
            onChangeText={(text) => update('description', text)}
            placeholder="Worum geht es bei eurem Ziel?"
            placeholderTextColor={theme.colors.textSubtle}
            style={[inputStyle, styles.multilineInput]}
            textAlignVertical="top"
            value={value.description}
          />
        </View>

        <View
          style={[styles.fieldPair, tablet ? styles.fieldPairTablet : undefined]}
          testID="shared-goal-form-layout">
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
              Zieltyp
            </Text>
            <SegmentedControl
              accessibilityLabel="Typ des gemeinsamen Lernziels"
              onChange={(targetType) => update('targetType', targetType)}
              options={TARGET_TYPE_OPTIONS}
              value={value.targetType}
            />
          </View>
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
              Zielmodus
            </Text>
            <SegmentedControl
              accessibilityLabel="Modus des gemeinsamen Lernziels"
              onChange={(mode) => update('mode', mode)}
              options={MODE_OPTIONS}
              value={value.mode}
            />
          </View>
        </View>

        <View style={[styles.fieldPair, tablet ? styles.fieldPairTablet : undefined]}>
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
              Lernrhythmus
            </Text>
            <SegmentedControl
              accessibilityLabel="Rhythmus des gemeinsamen Lernziels"
              onChange={(cadence) => update('cadence', cadence)}
              options={CADENCE_OPTIONS}
              value={value.cadence}
            />
          </View>
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
              Welche Lernzeit zählt?
            </Text>
            <SegmentedControl
              accessibilityLabel="Zeitquelle des gemeinsamen Lernziels"
              onChange={(sourcePolicy) => update('sourcePolicy', sourcePolicy)}
              options={SOURCE_OPTIONS}
              value={value.sourcePolicy}
            />
          </View>
        </View>

        <View style={[styles.fieldPair, tablet ? styles.fieldPairTablet : undefined]}>
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Startdatum</Text>
            <TextInput
              accessibilityLabel="Startdatum des gemeinsamen Lernziels"
              autoCorrect={false}
              editable={!disabled}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              onChangeText={(text) => update('startsOn', text)}
              placeholder="JJJJ-MM-TT"
              placeholderTextColor={theme.colors.textSubtle}
              style={[inputStyle, styles.numeric]}
              value={value.startsOn}
            />
            <FieldError message={errors?.startsOn} />
          </View>
          <View style={styles.pairedField}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Enddatum</Text>
            <TextInput
              accessibilityLabel="Enddatum des gemeinsamen Lernziels"
              autoCorrect={false}
              editable={!disabled}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              onChangeText={(text) => update('endsOn', text)}
              placeholder="JJJJ-MM-TT"
              placeholderTextColor={theme.colors.textSubtle}
              style={[inputStyle, styles.numeric]}
              value={value.endsOn}
            />
            <FieldError message={errors?.endsOn} />
          </View>
        </View>

        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
            Zielwert
          </Text>
          {value.targetType === 'duration' ? (
            <SegmentedControl
              accessibilityLabel="Einheit des gemeinsamen Lernzeitziels"
              onChange={(durationUnit) => update('durationUnit', durationUnit)}
              options={DURATION_UNIT_OPTIONS}
              value={value.durationUnit}
            />
          ) : null}
          <TextInput
            accessibilityLabel={
              value.targetType === 'duration'
                ? `Zielwert in ${value.durationUnit === 'hours' ? 'Stunden' : 'Minuten'}`
                : 'Anzahl Sessions für das gemeinsame Lernziel'
            }
            editable={!disabled}
            keyboardType="decimal-pad"
            onChangeText={(text) => update('targetValue', text)}
            placeholder={value.targetType === 'duration' ? (value.durationUnit === 'hours' ? '10' : '600') : '10'}
            placeholderTextColor={theme.colors.textSubtle}
            style={[inputStyle, theme.typography.heading, styles.numeric]}
            value={value.targetValue}
          />
          <FieldError message={errors?.targetValue} />
        </View>

        {value.targetType === 'sessions' ? (
          <View style={styles.field}>
            <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
              Mindestdauer je Session
            </Text>
            <TextInput
              accessibilityLabel="Mindestdauer je Session in Minuten"
              editable={!disabled}
              keyboardType="number-pad"
              onChangeText={(text) => update('minimumSessionMinutes', text)}
              placeholder="10"
              placeholderTextColor={theme.colors.textSubtle}
              style={inputStyle}
              value={value.minimumSessionMinutes}
            />
            <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Nur zugeordnete Sessions ab dieser Dauer zählen.
            </Text>
            <FieldError message={errors?.minimumSessionMinutes} />
          </View>
        ) : null}
      </AppCard>

      <AppCard style={styles.section}>
        <View style={styles.field}>
          <Text
            accessibilityRole="header"
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            Freunde einladen
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            Wähle mindestens einen bestätigten Freund. Du selbst nimmst automatisch teil.
          </Text>
        </View>

        {friends.length === 0 ? (
          <View
            style={[
              styles.noFriends,
              { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radii.lg },
            ]}>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Verbinde dich zuerst mit einem Freund, um ein gemeinsames Ziel zu erstellen.
            </Text>
          </View>
        ) : (
          <View accessibilityRole="list" style={styles.friendList}>
            {friends.map((friend) => {
              const selected = value.participantIds.includes(friend.id);
              return (
                <Pressable
                  accessibilityLabel={`${friend.displayName} einladen`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  key={friend.id}
                  onPress={() => toggleParticipant(friend.id)}
                  style={({ pressed }) => [
                    styles.friendChoice,
                    {
                      backgroundColor: selected ? theme.colors.accentPeachMuted : theme.colors.surface,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderRadius: theme.radii.lg,
                    },
                    pressed ? styles.pressed : undefined,
                  ]}>
                  <Avatar
                    name={friend.displayName}
                    size="sm"
                    source={friend.avatarUrl ? { uri: friend.avatarUrl } : undefined}
                  />
                  <View style={styles.friendCopy}>
                    <Text
                      numberOfLines={1}
                      selectable
                      style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                      {friend.displayName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      selectable
                      style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      @{friend.username}
                    </Text>
                  </View>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.check,
                      {
                        backgroundColor: selected ? theme.colors.primary : 'transparent',
                        borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                        borderRadius: theme.radii.sm,
                      },
                    ]}>
                    {selected ? (
                      <Text style={[theme.typography.label, { color: theme.colors.onPrimary }]}>✓</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <FieldError message={errors?.participantIds} />
      </AppCard>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    width: '100%',
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
  fieldPair: {
    width: '100%',
    gap: 18,
  },
  fieldPairTablet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pairedField: {
    minWidth: 0,
    flex: 1,
    gap: 10,
  },
  input: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  multilineInput: {
    minHeight: 104,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  noFriends: {
    width: '100%',
    padding: 16,
  },
  friendList: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  friendChoice: {
    minWidth: 220,
    minHeight: 64,
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  friendCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  check: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.74,
  },
});
