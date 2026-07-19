import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

export default function ImportLocalDataScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const study = useStudyStore();
  const preview = study.localImportPreview;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const confirm = async () => {
    await study.confirmLocalImport();
  };

  const acknowledgeReport = () => {
    study.acknowledgeLocalImportReport();
    close();
  };

  const defer = () => {
    study.deferLocalImport();
    close();
  };

  if (auth.activeMode !== 'supabase' || !preview) {
    return (
      <Screen contentContainerStyle={styles.content} maxWidth={680}>
        <SectionHeader title="Keine lokale Übertragung ausstehend" />
        <AppButton fullWidth label="Zur Übersicht" onPress={close} />
      </Screen>
    );
  }

  const rows = [
    ['Fächer', preview.subjects],
    ['Sessions', preview.sessions],
    ['Lernziele', preview.goals],
    ['Noten', preview.grades],
  ] as const;

  return (
    <Screen contentContainerStyle={styles.content} maxWidth={680}>
      <SectionHeader
        description="Die Daten bleiben auf diesem Gerät erhalten. Erst nach deiner Bestätigung werden sie deinem angemeldeten Konto zugeordnet und synchronisiert."
        eyebrow="Sicher übertragen"
        title="Gehören diese Lerndaten zu deinem Konto?"
      />

      <AppCard style={styles.card}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.row, { borderBottomColor: theme.colors.divider }]}>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>{label}</Text>
            <Text style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{value}</Text>
          </View>
        ))}
        {preview.hasActiveTimer ? (
          <Text style={[theme.typography.caption, { color: theme.colors.accentMustard }]}>Ein laufender Timer bleibt zunächst auf diesem Gerät und wird erst beim Abschluss synchronisiert.</Text>
        ) : null}
      </AppCard>

      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
        Lokale Freunde, vorbereitete Challenges und Freigaben werden aus Datenschutzgründen nicht übernommen. Bei Konflikten bleibt der vorhandene Kontostand unverändert.
      </Text>

      {preview.warnings.map((warning) => (
        <Text key={warning} style={[theme.typography.caption, { color: theme.colors.accentMustard }]}>
          {warning}
        </Text>
      ))}

      {study.migrationProgress ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {study.migrationProgress.stagedChunks} von {study.migrationProgress.totalChunks} Datenpaketen übertragen
        </Text>
      ) : null}

      {study.migrationError ? (
        <Text accessibilityRole="alert" style={[theme.typography.body, { color: theme.colors.danger }]}>
          {study.migrationError}
        </Text>
      ) : null}

      {study.migrationReport ? (
        <AppCard style={styles.card} variant="subtle">
          <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>Importbericht</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Der Cloud-Bestand wurde übernommen. Lokale Daten bleiben auf diesem Gerät erhalten.</Text>
          {rows.map(([label], index) => {
            const key = (['subjects', 'sessions', 'goals', 'grades'] as const)[index];
            return (
              <Text key={key} style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                {label}: {study.migrationReport?.imported[key] ?? 0} neu, {study.migrationReport?.duplicates[key] ?? 0} bereits vorhanden
              </Text>
            );
          })}
          {study.migrationReport.conflicts.length > 0 ? (
            <View style={styles.conflicts}>
              <Text accessibilityRole="alert" style={[theme.typography.bodyMedium, { color: theme.colors.accentMustard }]}>Konflikte ({study.migrationReport.conflicts.length})</Text>
              {study.migrationReport.conflicts.map((conflict, index) => (
                <Text key={`${conflict.entityType}-${conflict.localId}-${index}`} style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                  {conflict.entityType} · {conflict.localId || 'ohne lokale ID'}: {conflict.message}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={[theme.typography.caption, { color: theme.colors.accentOlive }]}>Keine Konflikte.</Text>
          )}
        </AppCard>
      ) : null}

      <View style={styles.actions}>
        {study.migrationReport ? (
          <AppButton
            fullWidth
            label="Importbericht schließen"
            onPress={acknowledgeReport}
            size="large"
          />
        ) : (
          <>
            <AppButton
              disabled={study.migrationStatus === 'importing'}
              fullWidth
              label="Daten diesem Konto zuordnen"
              loading={study.migrationStatus === 'importing'}
              onPress={() => void confirm()}
              size="large"
            />
            <AppButton
              disabled={study.migrationStatus === 'importing'}
              fullWidth
              label="Später entscheiden"
              onPress={defer}
              variant="ghost"
            />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  card: { gap: 12 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  numeric: { fontVariant: ['tabular-nums'] },
  conflicts: { gap: 7 },
  actions: { width: '100%', gap: 10 },
});
