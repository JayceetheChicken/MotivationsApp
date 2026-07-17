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
  } = useStudyStore();
  const [confirmation, setConfirmation] = useState<'data' | 'local-profile' | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const isGuest = auth.activeMode === 'none';
  const displayName = isGuest
    ? 'Gast'
    : data.currentUser?.displayName
      ?? auth.localProfile?.displayName
      ?? (typeof auth.user?.user_metadata.display_name === 'string' ? auth.user.user_metadata.display_name : 'Lernprofil');
  const username = data.currentUser?.username
    ?? auth.localProfile?.username
    ?? auth.user?.email?.split('@')[0]
    ?? 'profil';
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

      {auth.activeMode !== 'supabase' ? (
        <View style={styles.section}>
          <SectionHeader
            description={isGuest
              ? 'Die App bleibt ohne Anmeldung vollständig für deine persönlichen Lernzeiten nutzbar.'
              : 'Dein lokales Profil bleibt auf diesem Gerät. Ein Online-Konto ist weiterhin freiwillig.'}
            eyebrow="Optional"
            title="Konto & Profil"
          />
          <AppCard style={styles.accountActions} variant="subtle">
            <AppButton fullWidth label="Anmelden" onPress={() => router.push('/login')} />
            <AppButton fullWidth label="Online-Konto erstellen" onPress={() => router.push('/register')} variant="outline" />
            <AppButton
              fullWidth
              label={isGuest ? 'Lokales Profil einrichten' : 'Lokales Profil bearbeiten'}
              onPress={() => router.push('/local-profile')}
              variant="ghost"
            />
          </AppCard>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          description="Werte werden nur mit bestätigten Freunden und nur nach deiner Freigabe geteilt."
          eyebrow="Du entscheidest"
          title="Privatsphäre"
        />
        <AppCard padding="none" style={styles.preferencesCard}>
          <PreferenceRow
            description="Blendet den gesamten sozialen Statistikvergleich ein oder aus."
            label="Freundesvergleiche"
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
        <SectionHeader description="Diese Aktionen lassen sich nicht rückgängig machen." title="Konto & lokale Daten" />

        {confirmation === 'data' ? (
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
          <>
            <AppButton fullWidth label="Abmelden" loading={auth.pendingAction === 'sign-out'} onPress={() => void signOut()} variant="outline" />
            <AppCard style={styles.accountDeleteCard} variant="subtle">
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Online-Konto löschen</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Die Oberfläche ist vorbereitet. Eine Kontolöschung wird erst aktiviert, wenn die dafür notwendige geschützte Serverfunktion eingerichtet ist.</Text>
              <AppButton
                fullWidth
                label="Löschung noch nicht verfügbar"
                onPress={() => setAccountNotice('Es wurde nichts gelöscht. Richte zuerst die serverseitige Löschfunktion ein.')}
                variant="outline"
              />
              {accountNotice ? <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.warning }]}>{accountNotice}</Text> : null}
            </AppCard>
          </>
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
  preferencesCard: { overflow: 'hidden' },
  preferenceRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  preferenceCopy: { flex: 1, minWidth: 0, gap: 2 },
  sourcesCard: { gap: 18 },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  sourceText: { flex: 1 },
  confirmCard: { gap: 12 },
  accountDeleteCard: { gap: 12 },
});
