import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { displayNameError, usernameError } from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { AccountStudyUser } from '@/types/study';

export default function ProfileScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const {
    data,
    clearAllData,
    lastSyncError = null,
    pendingMutationCount = 0,
    retrySync = async () => undefined,
    updateAccountProfile,
    uploadAvatar,
    socialError = null,
    socialLoading = false,
    syncStatus = {
      phase: 'idle',
      pendingMutationCount: 0,
      lastSyncedAt: null,
      lastError: null,
    },
  } = useStudyStore();

  const isGuest = auth.activeMode === 'none';
  const isAccount = auth.activeMode === 'supabase';
  const isLocal = auth.activeMode === 'local';
  const canEditProfile = isAccount || isLocal;
  const accountProfile = isAccount
    ? (data.currentUser as AccountStudyUser | null)
    : null;

  const initialDisplayName = isGuest
    ? 'Gast'
    : data.currentUser?.displayName
      ?? auth.localProfile?.displayName
      ?? (isAccount ? 'Online-Profil' : 'Lernprofil');
  const initialUsername = data.currentUser?.username
    ?? auth.localProfile?.username
    ?? (isAccount ? 'profil-wird-geladen' : 'profil');
  const avatarUrl = isGuest ? undefined : data.currentUser?.avatarUrl ?? auth.localProfile?.avatarUri;
  const modeLabel = {
    none: 'Ohne Konto',
    local: 'Lokales Profil',
    supabase: 'Online-Konto',
  }[auth.activeMode];

  const [confirmation, setConfirmation] = useState<'data' | 'local-profile' | null>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; username?: string }>({});
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  // Keep the editable fields aligned with the persisted profile (e.g. after a
  // completed background sync) without a syncing effect: React supports
  // adjusting state during render when a derived-from value changes.
  const [syncedDisplayName, setSyncedDisplayName] = useState(initialDisplayName);
  const [syncedUsername, setSyncedUsername] = useState(initialUsername);
  if (initialDisplayName !== syncedDisplayName || initialUsername !== syncedUsername) {
    setSyncedDisplayName(initialDisplayName);
    setSyncedUsername(initialUsername);
    setDisplayName(initialDisplayName);
    setUsername(initialUsername);
  }

  const clearProfileFeedback = () => {
    if (profileError) setProfileError(null);
    if (profileNotice) setProfileNotice(null);
  };

  const saveProfile = async () => {
    const nextErrors = {
      displayName: displayNameError(displayName),
      username: usernameError(username),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.displayName || nextErrors.username) return;

    setProfileSaving(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      if (isAccount) {
        const updated = await updateAccountProfile({
          displayName: displayName.trim(),
          username: username.trim().toLowerCase(),
          avatarUrl: accountProfile?.avatarUrl ?? undefined,
        });
        if (updated) {
          setProfileNotice('Dein Profil wurde gespeichert.');
        } else {
          setProfileError(socialError ?? 'Das Profil konnte nicht gespeichert werden.');
        }
        return;
      }

      const result = await auth.saveLocalProfile({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        avatarUri: auth.localProfile?.avatarUri,
      });
      setProfileNotice(result.ok ? 'Dein Profil wurde gespeichert.' : null);
      setProfileError(result.ok ? null : result.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const pickAndUploadAvatar = async () => {
    setAvatarError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarError('Erlaube den Zugriff auf deine Fotos, um ein Profilbild auszuwählen.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    if (!asset) return;

    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const url = await uploadAvatar({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
      if (!url) {
        setAvatarError(socialError ?? 'Das Profilbild konnte nicht hochgeladen werden. Bitte versuche es erneut.');
        return;
      }
      const updated = await updateAccountProfile({
        displayName: displayName.trim() || initialDisplayName,
        username: (username.trim() || initialUsername).toLowerCase(),
        avatarUrl: url,
      });
      if (updated) {
        setProfileError(null);
        setProfileNotice('Dein neues Profilbild wurde gespeichert.');
      } else {
        setAvatarError('Das Profilbild wurde hochgeladen, aber nicht gespeichert.');
      }
    } finally {
      setAvatarUploading(false);
    }
  };

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
        <View style={styles.identity}>
          {isAccount ? (
            <Pressable
              accessibilityHint="Öffnet die Fotoauswahl für ein neues Profilbild"
              accessibilityLabel="Profilbild antippen zum Ändern"
              accessibilityRole="button"
              disabled={avatarUploading}
              onPress={() => void pickAndUploadAvatar()}
              style={styles.avatarButton}>
              <Avatar name={displayName} size="xl" source={avatarUrl ? { uri: avatarUrl } : undefined} />
              <View style={[styles.avatarBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.accentPeachMuted }]}>
                {avatarUploading ? (
                  <ActivityIndicator color={theme.colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.avatarBadgeIcon, { color: theme.colors.onPrimary }]}>✎</Text>
                )}
              </View>
            </Pressable>
          ) : (
            <Avatar name={displayName} size="xl" source={avatarUrl ? { uri: avatarUrl } : undefined} />
          )}
          <View style={styles.profileCopy}>
            <Text accessibilityRole="header" style={[theme.typography.heading, { color: theme.colors.text }]}>{displayName}</Text>
            {isGuest ? (
              <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Direkt und ohne Anmeldung</Text>
            ) : (
              <View style={[styles.usernamePill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.accentBrownMuted }]}>
                <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.primaryText }]}>@{username}</Text>
              </View>
            )}
            <View style={[styles.modePill, { backgroundColor: theme.colors.accentMustardMuted }]}>
              <View style={[styles.modeDot, { backgroundColor: theme.colors.accentMustard }]} />
              <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{modeLabel}</Text>
            </View>
          </View>
        </View>
        {isAccount ? (
          <View style={styles.avatarActionRow}>
            <AppButton
              label={avatarUploading ? 'Bild wird hochgeladen…' : 'Profilbild ändern'}
              loading={avatarUploading}
              onPress={() => void pickAndUploadAvatar()}
              size="compact"
              variant="outline"
            />
          </View>
        ) : null}
        {isAccount && avatarError ? (
          <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{avatarError}</Text>
        ) : null}
      </AppCard>

      {canEditProfile ? (
        <View style={styles.section}>
          <SectionHeader
            description={isAccount
              ? 'Anzeigename und eindeutiger Benutzername gelten für dein verbundenes Konto und die Freundessuche.'
              : 'Name und Benutzername bleiben ausschließlich auf diesem Gerät.'}
            eyebrow="Dein Profil"
            title="Profil bearbeiten"
          />
          <AppCard style={styles.editCard} variant="subtle">
            {isAccount && accountProfile?.usernameNeedsReview ? (
              <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.warning }]}>
                Bitte bestätige einen eindeutigen Benutzernamen, damit dich andere finden können.
              </Text>
            ) : null}
            <View style={styles.field}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Anzeigename</Text>
              <TextInput
                accessibilityLabel="Anzeigename"
                autoCapitalize="words"
                onChangeText={(value) => {
                  setDisplayName(value);
                  if (fieldErrors.displayName) setFieldErrors((current) => ({ ...current, displayName: undefined }));
                  clearProfileFeedback();
                }}
                placeholder="Wie sollen wir dich nennen?"
                placeholderTextColor={theme.colors.textSubtle}
                style={[styles.input, theme.typography.body, { backgroundColor: theme.colors.surface, borderColor: fieldErrors.displayName ? theme.colors.danger : theme.colors.border, color: theme.colors.text }]}
                value={displayName}
              />
              {fieldErrors.displayName ? (
                <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{fieldErrors.displayName}</Text>
              ) : null}
            </View>
            <View style={styles.field}>
              <Text style={[theme.typography.label, { color: theme.colors.textMuted }]}>Benutzername</Text>
              <TextInput
                accessibilityLabel="Benutzername"
                autoCapitalize="none"
                onChangeText={(value) => {
                  setUsername(value.toLowerCase());
                  if (fieldErrors.username) setFieldErrors((current) => ({ ...current, username: undefined }));
                  clearProfileFeedback();
                }}
                placeholder="dein.name"
                placeholderTextColor={theme.colors.textSubtle}
                style={[styles.input, theme.typography.body, { backgroundColor: theme.colors.surface, borderColor: fieldErrors.username ? theme.colors.danger : theme.colors.border, color: theme.colors.text }]}
                value={username}
              />
              <Text style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>3–30 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich.</Text>
              {fieldErrors.username ? (
                <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{fieldErrors.username}</Text>
              ) : null}
            </View>
            {profileError ? (
              <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{profileError}</Text>
            ) : null}
            {profileNotice ? (
              <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.success }]}>{profileNotice}</Text>
            ) : null}
            <AppButton
              disabled={isAccount ? socialLoading || !accountProfile : auth.pendingAction === 'save-local-profile'}
              fullWidth
              label="Profil speichern"
              loading={profileSaving || (isAccount ? socialLoading : auth.pendingAction === 'save-local-profile')}
              onPress={() => void saveProfile()}
            />
          </AppCard>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          description="Online-Konten und lokale Profile sind freiwillig. Deine vorhandenen Lerndaten bleiben beim Wechsel erhalten."
          eyebrow="Optional"
          title="Konto & Synchronisierung"
        />
        <AppCard style={styles.accountActions} variant="subtle">
          {isAccount ? (
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
            </>
          ) : auth.configuration.isConfigured ? (
            <>
              <AppButton fullWidth label="Online-Konto anmelden" onPress={() => router.push('/login')} />
              <AppButton fullWidth label="Online-Konto erstellen" onPress={() => router.push('/register')} variant="outline" />
            </>
          ) : null}
          {!isAccount && !auth.localProfile ? (
            <AppButton
              fullWidth
              label="Lokales Profil erstellen"
              onPress={() => router.push('/local-profile')}
              variant={auth.configuration.isConfigured ? 'ghost' : 'outline'}
            />
          ) : null}
        </AppCard>
      </View>

      <View style={styles.section}>
        <SectionHeader
          description={isAccount
            ? 'Cloud-Daten bleiben erhalten; der Gerätecache kann jederzeit neu aufgebaut werden.'
            : 'Das Löschen lokaler Daten lässt sich nicht rückgängig machen.'}
          title="Konto & lokale Daten"
        />

        {isAccount ? (
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

        {isAccount ? (
          <AppButton fullWidth label="Abmelden" loading={auth.pendingAction === 'sign-out'} onPress={() => void signOut()} variant="outline" />
        ) : isLocal && confirmation === 'local-profile' ? (
          <AppCard style={styles.confirmCard} variant="outlined">
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Lokales Profil und alle Daten löschen?</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Das Profil und sämtliche Lerninhalte auf diesem Gerät werden endgültig entfernt.</Text>
            <AppButton fullWidth label="Profil und Daten löschen" onPress={() => void removeLocalProfileAndData()} variant="danger" />
            <AppButton fullWidth label="Abbrechen" onPress={() => setConfirmation(null)} variant="ghost" />
          </AppCard>
        ) : isLocal ? (
          <AppButton fullWidth label="Lokales Profil und Daten löschen" onPress={() => setConfirmation('local-profile')} variant="danger" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 30 },
  profileCard: { gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  avatarButton: { position: 'relative' },
  avatarBadge: { position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarBadgeIcon: { fontSize: 15, lineHeight: 18, fontWeight: '700' },
  avatarActionRow: { flexDirection: 'row' },
  profileCopy: { flex: 1, minWidth: 0, gap: 6 },
  usernamePill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  modePill: { minHeight: 28, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 999 },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  section: { gap: 14 },
  editCard: { gap: 16 },
  field: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  accountActions: { gap: 10 },
  confirmCard: { gap: 12 },
});
