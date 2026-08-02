import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { ReportEntityType, ReportReason } from '@/types/study';

const reasonLabels: Readonly<Record<ReportReason, string>> = {
  harassment: 'Belästigung',
  hate: 'Hassrede',
  sexual_content: 'Sexualisierte Inhalte',
  violence: 'Gewalt',
  spam: 'Spam',
  impersonation: 'Identitätsmissbrauch',
  privacy: 'Privatsphäre',
  other: 'Sonstiges',
};

const typeLabels: Readonly<Record<ReportEntityType, string>> = {
  profile: 'Profil allgemein',
  profile_name: 'Benutzer- oder Anzeigename',
  profile_image: 'Profilbild',
  group: 'Gruppe allgemein',
  group_name: 'Gruppenname',
  group_image: 'Gruppenbild',
  shared_goal: 'Gemeinsames Ziel',
  shared_session: 'Gemeinsame Session',
};

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : value?.[0] ?? '';
}

function entityOptions(kind: string): readonly ReportEntityType[] {
  if (kind === 'profile') return ['profile', 'profile_name', 'profile_image'];
  if (kind === 'group') return ['group', 'group_name', 'group_image'];
  if (kind === 'shared_goal') return ['shared_goal'];
  if (kind === 'shared_session') return ['shared_session'];
  return [];
}

export default function ReportContentScreen() {
  const theme = useAppTheme();
  const params = useLocalSearchParams();
  const entityId = single(params.entityId as string | string[] | undefined);
  const kind = single(params.kind as string | string[] | undefined);
  const label = single(params.label as string | string[] | undefined) || 'Inhalt';
  const options = useMemo(() => entityOptions(kind), [kind]);
  const { submitContentReport } = useStudyStore();
  const [entityType, setEntityType] = useState<ReportEntityType | null>(options[0] ?? null);
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!entityId || !entityType || description.length > 500) return;
    setPending(true);
    setError(null);
    try {
      await submitContentReport({
        entityType,
        entityId,
        reason,
        description: description.trim() || undefined,
      });
      setSent(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error
        ? submissionError.message
        : 'Die Meldung konnte nicht gesendet werden.');
    } finally {
      setPending(false);
    }
  };

  if (!entityId || options.length === 0) {
    return (
      <Screen centered>
        <Stack.Title>Inhalt melden</Stack.Title>
        <Text accessibilityRole="alert" style={[theme.typography.body, { color: theme.colors.danger }]}>Das Meldeziel ist ungültig oder nicht mehr verfügbar.</Text>
        <AppButton label="Schließen" onPress={() => router.back()} variant="outline" />
      </Screen>
    );
  }

  if (sent) {
    return (
      <Screen centered>
        <SectionHeader description="Die Meldung wurde mit minimalen Angaben an die Moderationswarteschlange übergeben." title="Meldung gesendet" />
        <AppButton label="Schließen" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} maxWidth={680}>
      <Stack.Title>Inhalt melden</Stack.Title>
      <SectionHeader description={label} title="Was möchtest du melden?" />
      <AppCard style={styles.card} variant="subtle">
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: entityType === option }}
              key={option}
              onPress={() => setEntityType(option)}
              style={[
                styles.option,
                { borderColor: entityType === option ? theme.colors.primary : theme.colors.border },
              ]}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{typeLabels[option]}</Text>
            </Pressable>
          ))}
        </View>
      </AppCard>

      <SectionHeader title="Grund" />
      <AppCard style={styles.card} variant="subtle">
        <View style={styles.options}>
          {(Object.keys(reasonLabels) as ReportReason[]).map((option) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === option }}
              key={option}
              onPress={() => setReason(option)}
              style={[
                styles.option,
                { borderColor: reason === option ? theme.colors.primary : theme.colors.border },
              ]}>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{reasonLabels[option]}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Optionale Beschreibung"
          maxLength={500}
          multiline
          onChangeText={setDescription}
          placeholder="Optional: kurze Beschreibung ohne zusätzliche sensible Daten"
          placeholderTextColor={theme.colors.textSubtle}
          style={[styles.input, theme.typography.body, { borderColor: theme.colors.border, color: theme.colors.text }]}
          value={description}
        />
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{description.length}/500 Zeichen</Text>
        {error ? <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text> : null}
        <AppButton fullWidth label="Meldung senden" loading={pending} onPress={() => void submit()} variant="danger" />
        <AppButton disabled={pending} fullWidth label="Abbrechen" onPress={() => router.back()} variant="outline" />
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  card: { gap: 14 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { minHeight: 42, justifyContent: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 120, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
});
