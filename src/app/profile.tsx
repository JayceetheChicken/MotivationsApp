import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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

function avatarActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export default function ProfileScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const saveLocalProfile = auth.saveLocalProfile;
  const {
    data,
    lastSyncError = null,
    pendingMutationCount = 0,
    retrySync = async () => undefined,
    updateAccountProfile,
    replaceAccountAvatar,
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
  const persistedAvatarUrl = isGuest
    ? undefined
    : isLocal
      ? auth.localProfile?.avatarUri
      : data.currentUser?.avatarUrl;
  const modeLabel = {
    none: 'Ohne Konto',
    local: 'Lokales Profil',
    supabase: 'Online-Konto',
  }[auth.activeMode];

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; username?: string }>({});
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [avatarPreviewBase, setAvatarPreviewBase] = useState(persistedAvatarUrl);
  const avatarActionInFlightRef = useRef(false);
  const pendingRecoveryModeRef = useRef<string | null>(null);
  const accountProfileRef = useRef(accountProfile);
  const localProfileRef = useRef(auth.localProfile);
  useEffect(() => {
    accountProfileRef.current = accountProfile;
    localProfileRef.current = auth.localProfile;
  }, [accountProfile, auth.localProfile]);
  const avatarUrl = avatarPreviewUri ?? persistedAvatarUrl;
  if (avatarPreviewBase !== persistedAvatarUrl) {
    setAvatarPreviewBase(persistedAvatarUrl);
    setAvatarPreviewUri(null);
  }
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
    } catch (saveError) {
      setProfileError(avatarActionError(saveError, 'Das Profil konnte nicht gespeichert werden.'));
    } finally {
      setProfileSaving(false);
    }
  };

  const persistPickedAvatar = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setAvatarPreviewUri(asset.uri);
    setAvatarUploading(true);
    try {
      if (isLocal) {
        const localProfile = localProfileRef.current;
        if (!localProfile) {
          throw new Error('Das lokale Profil konnte nicht geladen werden.');
        }

        const result = await saveLocalProfile({
          displayName: localProfile.displayName,
          username: localProfile.username,
          avatarUri: asset.uri,
        });
        if (!result.ok) {
          throw new Error(result.message || 'Das Profilbild konnte nicht lokal gespeichert werden.');
        }

        setProfileError(null);
        setProfileNotice('Dein neues Profilbild wurde lokal gespeichert.');
        return;
      }

      const latestAccountProfile = accountProfileRef.current;
      if (!isAccount || !latestAccountProfile) {
        throw new Error('Das Online-Profil konnte nicht geladen werden. Bitte versuche es gleich erneut.');
      }

      const updated = await replaceAccountAvatar({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
      });
      if (!updated) {
        throw new Error('Das Profilbild konnte nicht hochgeladen werden. Bitte versuche es erneut.');
      }

      setAvatarPreviewUri(updated.avatarUrl ?? null);
      setProfileError(null);
      setProfileNotice('Dein neues Profilbild wurde gespeichert.');
    } catch (error) {
      setAvatarPreviewUri(null);
      throw error;
    } finally {
      setAvatarUploading(false);
    }
  }, [isAccount, isLocal, replaceAccountAvatar, saveLocalProfile]);

  const showAvatarActionError = useCallback((error: unknown) => {
    setAvatarPreviewUri(null);
    setAvatarError(avatarActionError(
      error,
      isLocal
        ? 'Das Profilbild konnte nicht lokal gespeichert werden.'
        : 'Das Profilbild konnte nicht hochgeladen werden.',
    ));
  }, [isLocal]);
  const persistPickedAvatarRef = useRef(persistPickedAvatar);
  const showAvatarActionErrorRef = useRef(showAvatarActionError);
  useEffect(() => {
    persistPickedAvatarRef.current = persistPickedAvatar;
    showAvatarActionErrorRef.current = showAvatarActionError;
  }, [persistPickedAvatar, showAvatarActionError]);
  const pendingAvatarRecoveryMode = Platform.OS === 'android'
    && (isLocal || (isAccount && Boolean(accountProfile)))
    ? auth.activeMode
    : null;

  const pickAndSaveAvatar = async () => {
    if (avatarActionInFlightRef.current) return;
    avatarActionInFlightRef.current = true;
    setAvatarError(null);
    try {
      // Android's system photo picker grants access to the selected file and
      // does not need a broad media-library permission. Asking for it first
      // can incorrectly block the picker on real devices.
      if (Platform.OS === 'ios') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Erlaube den Zugriff auf deine Fotos, um ein Profilbild auszuwählen.');
        }
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) {
        throw new Error('Das ausgewählte Bild konnte nicht übernommen werden.');
      }

      await persistPickedAvatar(asset);
    } catch (error) {
      showAvatarActionError(error);
    } finally {
      avatarActionInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!pendingAvatarRecoveryMode
      || pendingRecoveryModeRef.current === pendingAvatarRecoveryMode) return undefined;
    pendingRecoveryModeRef.current = pendingAvatarRecoveryMode;

    let active = true;
    void ImagePicker.getPendingResultAsync()
      .then(async (pendingResult) => {
        if (!active || !pendingResult || avatarActionInFlightRef.current) return;
        if ('code' in pendingResult) {
          throw new Error(pendingResult.message || 'Die Fotoauswahl konnte nicht abgeschlossen werden.');
        }
        if (pendingResult.canceled) return;

        const asset = pendingResult.assets[0];
        if (!asset) {
          throw new Error('Das ausgewählte Bild konnte nicht übernommen werden.');
        }

        avatarActionInFlightRef.current = true;
        setAvatarError(null);
        try {
          await persistPickedAvatarRef.current(asset);
        } finally {
          avatarActionInFlightRef.current = false;
        }
      })
      .catch((error: unknown) => {
        if (active) showAvatarActionErrorRef.current(error);
      });

    return () => {
      active = false;
    };
  }, [pendingAvatarRecoveryMode]);

  const signOut = async () => {
    const result = await auth.signOut();
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
          {canEditProfile ? (
            <Pressable
              accessibilityHint="Öffnet die Fotoauswahl für ein neues Profilbild"
              accessibilityLabel="Profilbild antippen zum Ändern"
              accessibilityRole="button"
              disabled={avatarUploading || (isAccount && !accountProfile)}
              onPress={() => void pickAndSaveAvatar()}
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
        {canEditProfile ? (
          <View style={styles.avatarActionRow}>
            <AppButton
              disabled={avatarUploading || (isAccount && !accountProfile)}
              label={avatarUploading
                ? isLocal
                  ? 'Bild wird gespeichert…'
                  : 'Bild wird hochgeladen…'
                : 'Profilbild ändern'}
              loading={avatarUploading}
              onPress={() => void pickAndSaveAvatar()}
              size="compact"
              variant="outline"
            />
          </View>
        ) : null}
        {canEditProfile && avatarError ? (
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
        {isAccount ? (
          <AppButton fullWidth label="Abmelden" loading={auth.pendingAction === 'sign-out'} onPress={() => void signOut()} variant="outline" />
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
});
