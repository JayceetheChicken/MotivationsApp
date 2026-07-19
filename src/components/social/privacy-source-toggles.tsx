import { StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { SourceBadge } from '@/components/ui/source-badge';
import { useAppTheme } from '@/theme';

import type { PrivacySourceKey, PrivacySourceValues } from './types';

const ROWS: readonly Readonly<{
  key: PrivacySourceKey;
  label: string;
  description: string;
  source?: 'timer' | 'manual';
}>[] = [
  {
    key: 'shareTimerStats',
    label: 'Timer-Statistiken',
    description: 'Freunde sehen gemessene Minuten und die Anzahl deiner Timer-Sessions.',
    source: 'timer',
  },
  {
    key: 'shareManualStats',
    label: 'Manuelle Einträge',
    description: 'Freunde sehen manuell erfasste Minuten und Einträge separat.',
    source: 'manual',
  },
  {
    key: 'shareGoalProgress',
    label: 'Persönlicher Zielstatus',
    description: 'Teilt nur, ob ein persönliches Ziel erreicht wurde, nicht dessen Höhe.',
  },
  {
    key: 'shareStreak',
    label: 'Aktuelle Lernserie',
    description: 'Teilt die Anzahl aufeinanderfolgender Lerntage.',
  },
];

export type PrivacySourceTogglesProps = {
  values: PrivacySourceValues;
  onChange: (key: PrivacySourceKey, value: boolean) => void;
  disabled?: boolean;
  savingKey?: PrivacySourceKey | null;
  style?: StyleProp<ViewStyle>;
};

export function PrivacySourceToggles({
  values,
  onChange,
  disabled = false,
  savingKey,
  style,
}: PrivacySourceTogglesProps) {
  const theme = useAppTheme();

  return (
    <View style={[styles.container, style]}>
      <AppCard padding="none" style={styles.card}>
        {ROWS.map((row, index) => {
          const isSaving = savingKey === row.key;
          return (
            <View
              key={row.key}
              style={[
                styles.row,
                index < ROWS.length - 1
                  ? { borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }
                  : undefined,
              ]}>
              <View style={styles.copy}>
                <View style={styles.labelRow}>
                  <Text
                    selectable
                    style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                    {row.label}
                  </Text>
                  {row.source ? <SourceBadge compact source={row.source} /> : null}
                </View>
                <Text
                  selectable
                  style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                  {row.description}
                </Text>
              </View>
              <Switch
                accessibilityLabel={row.label}
                accessibilityState={{ busy: isSaving, disabled: disabled || isSaving }}
                disabled={disabled || isSaving}
                ios_backgroundColor={theme.colors.track}
                onValueChange={(value) => onChange(row.key, value)}
                thumbColor={values[row.key] ? theme.colors.primary : theme.colors.textSubtle}
                trackColor={{ false: theme.colors.track, true: theme.colors.primaryMuted }}
                value={values[row.key]}
              />
            </View>
          );
        })}
      </AppCard>
      <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
        Der Gesamtwert wird Freunden nur angezeigt, wenn Timer-Statistiken und manuelle Einträge beide freigegeben sind. Alle Freigaben sind standardmäßig aus.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 10,
  },
  card: {
    width: '100%',
    overflow: 'hidden',
  },
  row: {
    width: '100%',
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
});
