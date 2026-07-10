import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import {
  type PrivacyPreferences,
  useStudyStore,
} from '@/state/study-store';
import { useAppTheme } from '@/theme';

interface PreferenceRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

function PreferenceRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: PreferenceRowProps) {
  const theme = useAppTheme();
  return (
    <View style={[styles.preferenceRow, { borderBottomColor: theme.colors.divider }]}>
      <View style={styles.preferenceCopy}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.track, true: theme.colors.primaryMuted }}
        thumbColor={value ? theme.colors.primary : theme.colors.textSubtle}
        value={value}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useAppTheme();
  const {
    data,
    privacy,
    setFriendComparisonsEnabled,
    setPrivacyPreference,
    resetDemo,
  } = useStudyStore();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const preferenceRows: {
    key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>;
    label: string;
    description: string;
  }[] = [
    {
      key: 'shareAutomaticMinutes',
      label: 'Gemessene Minuten',
      description: 'Freunde sehen nur die mit dem Timer erfasste Wochenzeit.',
    },
    {
      key: 'shareGoalProgress',
      label: 'Wochenziel',
      description: 'Zeigt, ob dein persönliches Ziel erreicht ist – nicht dessen Höhe.',
    },
    {
      key: 'shareStreak',
      label: 'Aktuelle Lernserie',
      description: 'Teilt die Anzahl aufeinanderfolgender Lerntage.',
    },
  ];

  return (
    <Screen maxWidth={760} contentContainerStyle={styles.content}>
      <AppCard style={styles.profileCard}>
        <Avatar name={data.currentUser.displayName} size="xl" />
        <View style={styles.profileCopy}>
          <Text accessibilityRole="header" style={[theme.typography.heading, { color: theme.colors.text }]}>
            {data.currentUser.displayName}
          </Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            @{data.currentUser.username}
          </Text>
          <View style={[styles.privatePill, { backgroundColor: theme.colors.successMuted }]}>
            <View style={[styles.privateDot, { backgroundColor: theme.colors.success }]} />
            <Text style={[theme.typography.caption, { color: theme.colors.success }]}>Privates Profil</Text>
          </View>
        </View>
      </AppCard>

      <View style={styles.section}>
        <SectionHeader
          eyebrow="Du entscheidest"
          title="Freundesvergleiche"
          description="Deine Werte sind nur für bestätigte Freunde sichtbar und können jederzeit ausgeblendet werden."
        />
        <AppCard padding="none" style={styles.preferencesCard}>
          <PreferenceRow
            description="Blendet den gesamten sozialen Statistikvergleich ein oder aus."
            label="Vergleiche aktivieren"
            onValueChange={setFriendComparisonsEnabled}
            value={privacy.friendComparisonsEnabled}
          />
          {preferenceRows.map((row) => (
            <PreferenceRow
              description={row.description}
              disabled={!privacy.friendComparisonsEnabled}
              key={row.key}
              label={row.label}
              onValueChange={(value) => setPrivacyPreference(row.key, value)}
              value={privacy[row.key]}
            />
          ))}
        </AppCard>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Nachvollziehbare Lernzeit" />
        <AppCard variant="subtle" style={styles.sourcesCard}>
          <View style={styles.sourceRow}>
            <SourceBadge source="timer" />
            <Text style={[theme.typography.body, styles.sourceText, { color: theme.colors.textMuted }]}>
              Wird für faire Freundesvergleiche als gemessene Zeit ausgewiesen.
            </Text>
          </View>
          <View style={styles.sourceRow}>
            <SourceBadge source="manual" />
            <Text style={[theme.typography.body, styles.sourceText, { color: theme.colors.textMuted }]}>
              Zählt zu deinem eigenen Fortschritt, bleibt aber separat sichtbar.
            </Text>
          </View>
        </AppCard>
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Lokaler Prototyp"
          description="Dieser Stand speichert deine Änderungen auf diesem Gerät. Kontosynchronisation und echte Freundesanfragen folgen mit dem Backend."
        />
        {confirmingReset ? (
          <AppCard variant="outlined" style={styles.resetCard}>
            <View style={styles.resetCopy}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Wirklich zurücksetzen?</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                Lokal ergänzte Sessions und Ziele werden durch den Ausgangsstand ersetzt.
              </Text>
            </View>
            <AppButton
              fullWidth
              label="Ja, Demodaten zurücksetzen"
              onPress={() => {
                resetDemo();
                setConfirmingReset(false);
              }}
              variant="danger"
            />
            <AppButton
              fullWidth
              label="Abbrechen"
              onPress={() => setConfirmingReset(false)}
              variant="ghost"
            />
          </AppCard>
        ) : (
          <AppButton
            fullWidth
            label="Demodaten zurücksetzen"
            onPress={() => setConfirmingReset(true)}
            variant="outline"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 34,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  profileCopy: {
    flex: 1,
    gap: 3,
  },
  privatePill: {
    minHeight: 26,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  privateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  section: {
    gap: 14,
  },
  preferencesCard: {
    overflow: 'hidden',
  },
  preferenceRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  preferenceCopy: {
    flex: 1,
    gap: 2,
  },
  sourcesCard: {
    gap: 18,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  sourceText: {
    flex: 1,
  },
  resetCard: {
    gap: 10,
  },
  resetCopy: {
    gap: 4,
    paddingBottom: 6,
  },
});
