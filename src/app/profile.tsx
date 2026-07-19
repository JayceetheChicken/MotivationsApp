import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useAuthStore } from '@/state/auth-store';
import { type PrivacyPreferences, useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { AccountStudyUser } from '@/types/study';

interface PreferenceRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

function PreferenceRow({ label, description, value, onValueChange, disabled = false }: PreferenceRowProps) {
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
        thumbColor={value ? theme.colors.primary : theme.colors.textSubtle}
        trackColor={{ false: theme.colors.track, true: theme.colors.primaryMuted }}
        value={value}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const {
    data,
    privacy,
    setFriendComparisonsEnabled,
    setPrivacyPreference,
    clearAllData,
    lastSyncError = null,
    pendingMutationCount = 0,
    retrySync = async () => undefined,
    sharingPreferences = null,
    socialError = null,
    socialLoading = false,
    syncStatus = {
      phase: 'idle',
      pendingMutationCount: 0,
      lastSyncedAt: null,
      lastError: null,
    },
  } = useStudyStore();
  const [confirmation, setConfirmation] = useState<'data' | 'local-profile' | null>(null);
  const isGuest = auth.activeMode === 'none';
  const accountProfile = auth.activeMode === 'supabase'
    ? data.currentUser as AccountStudyUser | null
    : null;
  const displayName = isGuest
    ? 'Gast'
    : data.currentUser?.displayName
      ?? auth.localProfile?.displayName
      ?? (auth.activeMode === 'supabase' ? 'Online-Profil' : 'Lernprofil');
  const username = data.currentUser?.username
    ?? auth.localProfile?.username
    ?? (auth.activeMode === 'supabase' ? 'profil-wird-geladen' : 'profil');
  const avatarUrl = isGuest ? undefined : data.currentUser?.avatarUrl ?? auth.localProfile?.avatarUri;
  const modeLabel = {
    none: 'Ohne Konto',
    local: 'Lokales Profil',
    supabase: 'Online-Konto',
  }[auth.activeMode];
  const preferenceRows: {
    key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>;
    label: string;
    description: string;
  }[] = [
    {
      key: 'shareAutomaticMinutes',
      label: 'Gemessene Minuten',
      description: 'Freunde sehen die mit dem Timer erfasste Wochenzeit.',
    },
    {
      key: 'shareManualMinutes',
      label: 'Manuell eingetragene Zeit',
      description: 'Freunde sehen manuelle Einträge getrennt von der Timer-Zeit.',
    },
    {
      key: 'shareGoalProgress',
      label: 'Zielstatus',
      description: 'Zeigt, ob dein persönliches Wochenziel erreicht ist – nicht dessen Höhe.',
    },
    {
      key: 'shareStreak',
      label: 'Aktuelle Lernserie',
      description: 'Teilt die Anzahl aufeinanderfolgender Lerntage.',
    },
  ];

  const signOut = async () => {
    const result = await auth.signOut();
    if (result.ok) router.replace('/');
  };

  const removeLocalProfileAndData = async () => {
    clearAllData();
    const result = await auth.removeLocalProfile();
    if (result.ok) router.replace('/');
  };

  return (
    <Screen contentContainerStyle={styles.content} maxWidth={760}>
      <AppCard
        style={[
          styles.profileCard,
          {
            backgroundColor: theme.colors.accentPeachMuted,
            borderColor: theme.colors.accentBrownMuted,
            boxShadow: `0 10px 24px ${theme.colors.shadow}`,
          },
        ]}>
        <Avatar name={displayName} size="xl" source={avatarUrl ? { uri: avatarUrl } : undefined} />
        <View style={styles.profileCopy}>
          <Text accessibilityRole="header" style={[theme.typography.heading, { color: theme.colors.text }]}>{displayName}</Text>
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{isGuest ? 'Direkt und ohne Anmeldung' : `@${username}`}</Text>
          <View style={[styles.modePill, { backgroundColor: theme.colors.accentMustardMuted }]}>
            <View style={[styles.modeDot, { backgroundColor: theme.colors.accentMustard }]} />
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{modeLabel}</Text>
          </View>
        </View>
      </AppCard>

      {accountProfile?.usernameNeedsReview ? (
        <AppCard style={styles.reviewCard} variant="outlined">
          <Text accessibilityRole="alert" style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Benutzername noch nicht bestätigt</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Bitte wähle einen eindeutigen Benutzernamen. Erst danach kannst du andere Personen finden und Social-Funktionen zuverlässig nutzen.</Text>
          <AppButton
            fullWidth
            label="Benutzernamen jetzt bestätigen"
            onPress={() => router.push('/local-profile')}
          />
        </AppCard>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          description="Online-Konten und lokale Profile sind freiwillig. Deine vorhandenen Lerndaten bleiben beim Wechsel erhalten."
          eyebrow="Optional"
          title="Konto & Synchronisierung"
        />
        <AppCard style={styles.accountActions} variant="subtle">
          {auth.activeMode === 'supabase' ? (
            <>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                {syncStatus.phase === 'offline'
                  ? `Offline – ${pendingMutationCount} ausstehende Änderung${pendingMutationCount === 1 ? '' : 'en'} bleibt auf diesem Gerät gespeichert.`
                  : syncStatus.phase === 'syncing'
                    ? 'Deine Lerndaten werden synchronisiert.'
                    : pendingMutationCount > 0
                      ? `${pendingMutationCount} Änderung${pendingMutationCount === 1 ? '' : 'en'} wartet auf die Synchronisierung.`
                      : 'Dein Online-Konto ist verbunden und aktuell.'}
              </Text>
              {lastSyncError ? (
                <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>
                  {lastSyncError}
                </Text>
              ) : null}
              {syncStatus.phase === 'error' || syncStatus.phase === 'offline' ? (
                <AppButton
                  fullWidth
                  label="Synchronisierung erneut versuchen"
                  onPress={() => void retrySync()}
                  variant="outline"
                />
              ) : null}
              <AppButton
                fullWidth
                label="Online-Profil bearbeiten"
                onPress={() => router.push('/local-profile')}
                variant="outline"
              />
            </>
          ) : auth.configuration.isConfigured ? (
            <>
              <AppButton fullWidth label="Online-Konto anmelden" onPress={() => router.push('/login')} />
              <AppButton fullWidth label="Online-Konto erstellen" onPress={() => router.push('/register')} variant="outline" />
            </>
          ) : null}
          {auth.activeMode !== 'supabase' ? (
            <AppButton
              fullWidth
              label={auth.localProfile ? 'Lokales Profil bearbeiten' : 'Lokales Profil erstellen'}
              onPress={() => router.push('/local-profile')}
              variant={auth.configuration.isConfigured ? 'ghost' : 'outline'}
            />
          ) : null}
        </AppCard>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description="Werte werden nur mit bestätigten Freunden und nur nach deiner Freigabe geteilt."
          eyebrow="Du entscheidest"
          title="Privatsphäre"
        />
        {auth.activeMode === 'supabase' ? (
          <>
            {socialError ? (
              <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{socialError}</Text>
            ) : null}
            <AppCard padding="none" style={styles.preferencesCard}>
              <PreferenceRow
                description="Blendet den gesamten sozialen Statistikvergleich auf diesem Gerät ein oder aus."
                label="Freundesvergleiche"
                onValueChange={setFriendComparisonsEnabled}
                value={privacy.friendComparisonsEnabled}
              />
              {preferenceRows.map((row) => (
                <PreferenceRow
                  description={row.description}
                  key={row.key}
                  label={row.label}
                  onValueChange={(value) => setPrivacyPreference(row.key, value)}
                  disabled={socialLoading || sharingPreferences === null || syncStatus.phase === 'offline'}
                  value={privacy[row.key]}
                />
              ))}
            </AppCard>
          </>
        ) : (
          <AppCard variant="subtle">
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Freigaben für Freunde werden erst mit einem Online-Konto angeboten. Im lokalen Modus verlässt keine Statistik dieses Gerät.
            </Text>
          </AppCard>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader description="Für persönliche Statistiken zählen beide Quellen; im sozialen Vergleich bleiben sie getrennt." title="Nachvollziehbare Lernzeit" />
        <AppCard
          style={[
            styles.sourcesCard,
            {
              backgroundColor: theme.colors.accentTurquoiseMuted,
              borderLeftColor: theme.colors.accentTurquoise,
              borderLeftWidth: 4,
            },
          ]}
          variant="subtle">
          <View style={styles.sourceRow}>
            <SourceBadge source="timer" />
            <Text style={[theme.typography.body, styles.sourceText, { color: theme.colors.textMuted }]}>Automatisch gemessen und für faire Vergleiche eindeutig ausgewiesen.</Text>
          </View>
          <View style={styles.sourceRow}>
            <SourceBadge source="manual" />
            <Text style={[theme.typography.body, styles.sourceText, { color: theme.colors.textMuted }]}>Nachträglich eingetragen und dauerhaft separat erkennbar.</Text>
          </View>
        </AppCard>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description={auth.activeMode === 'supabase'
            ? 'Cloud-Daten bleiben erhalten; der Gerätecache kann jederzeit neu aufgebaut werden.'
            : 'Das Löschen lokaler Daten lässt sich nicht rückgängig machen.'}
          title="Konto & lokale Daten"
        />

        {auth.activeMode === 'supabase' ? (
          <AppCard style={styles.confirmCard} variant="subtle">
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Gerätecache neu laden</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Die Cloud-Daten und ausstehenden Offline-Änderungen bleiben erhalten. Ein aktiver Timer bleibt auf diesem Gerät bestehen.</Text>
            <AppButton fullWidth label="Gerätecache neu laden" onPress={clearAllData} variant="outline" />
          </AppCard>
        ) : confirmation === 'data' ? (
          <AppCard style={styles.confirmCard} variant="outlined">
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Alle lokalen Lerndaten löschen?</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Sessions, Ziele, Fächer, Freunde, Challenges und ein laufender Timer werden entfernt. {isGuest ? 'Du kannst die App danach weiter ohne Anmeldung nutzen.' : 'Dein Profil bleibt bestehen.'}</Text>
            <AppButton
              fullWidth
              label="Lerndaten endgültig löschen"
              onPress={() => { clearAllData(); setConfirmation(null); }}
              variant="danger"
            />
            <AppButton fullWidth label="Abbrechen" onPress={() => setConfirmation(null)} variant="ghost" />
          </AppCard>
        ) : (
          <AppButton fullWidth label="Alle lokalen Lerndaten löschen" onPress={() => setConfirmation('data')} variant="outline" />
        )}

        {auth.activeMode === 'supabase' ? (
          <AppButton fullWidth label="Abmelden" loading={auth.pendingAction === 'sign-out'} onPress={() => void signOut()} variant="outline" />
        ) : auth.activeMode === 'local' && confirmation === 'local-profile' ? (
          <AppCard style={styles.confirmCard} variant="outlined">
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Lokales Profil und alle Daten löschen?</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Das Profil und sämtliche Lerninhalte auf diesem Gerät werden endgültig entfernt.</Text>
            <AppButton fullWidth label="Profil und Daten löschen" onPress={() => void removeLocalProfileAndData()} variant="danger" />
            <AppButton fullWidth label="Abbrechen" onPress={() => setConfirmation(null)} variant="ghost" />
          </AppCard>
        ) : auth.activeMode === 'local' ? (
          <AppButton fullWidth label="Lokales Profil und Daten löschen" onPress={() => setConfirmation('local-profile')} variant="danger" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 30 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  modePill: { minHeight: 28, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7, paddingHorizontal: 10, borderRadius: 999 },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  section: { gap: 14 },
  accountActions: { gap: 10 },
  reviewCard: { gap: 12 },
  preferencesCard: { overflow: 'hidden' },
  preferenceRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  preferenceCopy: { flex: 1, minWidth: 0, gap: 2 },
  sourcesCard: { gap: 18 },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  sourceText: { flex: 1 },
  confirmCard: { gap: 12 },
});
