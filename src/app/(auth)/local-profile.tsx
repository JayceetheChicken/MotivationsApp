import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AuthField,
  AuthNotice,
  AuthScaffold,
  AuthTextLink,
} from '@/auth/auth-ui';
import {
  avatarUriError,
  displayNameError,
  usernameError,
} from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { Avatar } from '@/components/ui/avatar';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { AccountStudyUser } from '@/types/study';

type LocalProfileField = 'displayName' | 'username' | 'avatarUri';
type LocalProfileErrors = Partial<Record<LocalProfileField, string>>;

function onlineAvatarUrlError(value: string): string | undefined {
  const url = value.trim();
  if (!url) return undefined;

  try {
    if (new URL(url).protocol !== 'https:') {
      return 'Für Online-Profile ist nur ein sicherer Bildlink mit https:// erlaubt.';
    }
  } catch {
    return 'Bitte gib einen gültigen Bildlink ein.';
  }

  return undefined;
}

export default function LocalProfileScreen() {
  const router = useRouter();
  const auth = useAuthStore();
  const {
    error,
    localProfile,
    notice,
    pendingAction,
    saveLocalProfile,
    clearFeedback,
  } = auth;
  const {
    data,
    socialError,
    socialLoading,
    updateAccountProfile,
  } = useStudyStore();
  const isOnlineProfile = auth.activeMode === 'supabase';
  const accountProfile = isOnlineProfile
    ? data.currentUser as AccountStudyUser | null
    : null;
  const [displayName, setDisplayName] = useState(
    accountProfile?.displayName ?? localProfile?.displayName ?? '',
  );
  const [username, setUsername] = useState(
    accountProfile?.username ?? localProfile?.username ?? '',
  );
  const [avatarUri, setAvatarUri] = useState(
    accountProfile?.avatarUrl ?? localProfile?.avatarUri ?? '',
  );
  const [accountRevision, setAccountRevision] = useState(accountProfile?.revision ?? null);
  const [errors, setErrors] = useState<LocalProfileErrors>({});

  useEffect(() => {
    if (!isOnlineProfile || !accountProfile || accountRevision === accountProfile.revision) return;
    setAccountRevision(accountProfile.revision);
    setDisplayName(accountProfile.displayName);
    setUsername(accountProfile.username);
    setAvatarUri(accountProfile.avatarUrl ?? '');
  }, [accountProfile, accountRevision, isOnlineProfile]);

  const updateField = (
    field: LocalProfileField,
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (error || notice) clearFeedback();
  };

  const submit = async () => {
    const nextErrors: LocalProfileErrors = {
      displayName: displayNameError(displayName),
      username: usernameError(username),
      avatarUri: isOnlineProfile
        ? onlineAvatarUrlError(avatarUri)
        : avatarUriError(avatarUri),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    if (isOnlineProfile) {
      const updated = await updateAccountProfile({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        avatarUrl: avatarUri.trim() || undefined,
      });
      if (updated) router.replace('/profile');
      return;
    }

    const result = await saveLocalProfile({ displayName, username, avatarUri });
    if (result.ok) router.replace('/');
  };

  const currentAvatarError = isOnlineProfile
    ? onlineAvatarUrlError(avatarUri)
    : avatarUriError(avatarUri);
  const previewUri = avatarUri && !currentAvatarError ? avatarUri.trim() : undefined;

  return (
    <AuthScaffold
      subtitle={isOnlineProfile
        ? 'Name, eindeutiger Benutzername und Profilbild gelten für dein verbundenes Konto.'
        : 'Beginne ohne Online-Konto. Dieses Profil bleibt ausschließlich auf diesem Gerät.'}
      title={isOnlineProfile
        ? accountProfile?.usernameNeedsReview
          ? 'Benutzernamen bestätigen'
          : 'Online-Profil bearbeiten'
        : localProfile
          ? 'Lokales Profil bearbeiten'
          : 'Lokal beginnen'}>
      {isOnlineProfile ? (
        <AuthNotice title="Dein Online-Profil">
          Der Benutzername wird für die exakte Freundessuche verwendet. Die Angaben werden in deinem Konto gespeichert und auf deinen Geräten synchronisiert.
        </AuthNotice>
      ) : (
        <AuthNotice title="Nur auf diesem Gerät">
          Es wird kein Konto erstellt. Synchronisation, Wiederherstellung und soziale Funktionen sind im lokalen Modus nicht verfügbar.
        </AuthNotice>
      )}
      {!isOnlineProfile && error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
      {!isOnlineProfile && notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}
      {isOnlineProfile && !accountProfile ? (
        <AuthNotice>Das Online-Profil wird geladen. Bitte versuche es gleich erneut.</AuthNotice>
      ) : null}
      {isOnlineProfile && socialError ? <AuthNotice tone="danger">{socialError}</AuthNotice> : null}

      <View style={styles.preview}>
        <Avatar
          name={displayName.trim() || 'Lokales Profil'}
          size="xl"
          source={previewUri ? { uri: previewUri } : undefined}
        />
      </View>

      <View style={styles.form}>
        <AuthField
          autoCapitalize="words"
          autoComplete="name"
          error={errors.displayName}
          label="Anzeigename"
          onChangeText={(value) => updateField('displayName', setDisplayName, value)}
          placeholder="Wie sollen wir dich nennen?"
          value={displayName}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="username-new"
          error={errors.username}
          hint="3–30 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich."
          label="Benutzername"
          onChangeText={(value) => updateField('username', setUsername, value.toLowerCase())}
          placeholder="dein.name"
          value={username}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="url"
          error={errors.avatarUri}
          hint={isOnlineProfile
            ? 'Optional: sicherer, vollständiger Link mit https://.'
            : 'Optional: vollständiger Link zu einem Bild.'}
          keyboardType="url"
          label="Profilbild-Link"
          onChangeText={(value) => updateField('avatarUri', setAvatarUri, value)}
          onSubmitEditing={() => void submit()}
          placeholder="https://…"
          returnKeyType="done"
          value={avatarUri}
        />

        <AppButton
          disabled={isOnlineProfile ? socialLoading || !accountProfile : pendingAction !== null}
          fullWidth
          label={isOnlineProfile
            ? 'Online-Profil speichern'
            : localProfile
              ? 'Profil speichern'
              : 'Lokal fortfahren'}
          loading={isOnlineProfile ? socialLoading : pendingAction === 'save-local-profile'}
          onPress={() => void submit()}
          size="large"
        />
      </View>

      <AuthTextLink
        label={isOnlineProfile ? 'Zurück zum Profil' : 'Ohne Profil zurück zur App'}
        onPress={() => router.replace(isOnlineProfile ? '/profile' : '/')}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  preview: {
    alignItems: 'center',
  },
  form: {
    width: '100%',
    gap: 16,
  },
});
