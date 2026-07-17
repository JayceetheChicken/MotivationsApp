import { useRouter } from 'expo-router';
import { useState } from 'react';
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

type LocalProfileField = 'displayName' | 'username' | 'avatarUri';
type LocalProfileErrors = Partial<Record<LocalProfileField, string>>;

export default function LocalProfileScreen() {
  const router = useRouter();
  const {
    error,
    localProfile,
    notice,
    pendingAction,
    saveLocalProfile,
    clearFeedback,
  } = useAuthStore();
  const [displayName, setDisplayName] = useState(localProfile?.displayName ?? '');
  const [username, setUsername] = useState(localProfile?.username ?? '');
  const [avatarUri, setAvatarUri] = useState(localProfile?.avatarUri ?? '');
  const [errors, setErrors] = useState<LocalProfileErrors>({});

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
      avatarUri: avatarUriError(avatarUri),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    const result = await saveLocalProfile({ displayName, username, avatarUri });
    if (result.ok) router.replace('/');
  };

  const previewUri = avatarUri && !avatarUriError(avatarUri) ? avatarUri.trim() : undefined;

  return (
    <AuthScaffold
      subtitle="Beginne ohne Online-Konto. Dieses Profil bleibt ausschließlich auf diesem Gerät."
      title={localProfile ? 'Lokales Profil bearbeiten' : 'Lokal beginnen'}>
      <AuthNotice title="Nur auf diesem Gerät">
        Es wird kein Konto erstellt. Synchronisation, Wiederherstellung und soziale Funktionen sind im lokalen Modus nicht verfügbar.
      </AuthNotice>
      {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
      {notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}

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
          hint="Optional: vollständiger Link zu einem Bild."
          keyboardType="url"
          label="Profilbild-Link"
          onChangeText={(value) => updateField('avatarUri', setAvatarUri, value)}
          onSubmitEditing={() => void submit()}
          placeholder="https://…"
          returnKeyType="done"
          value={avatarUri}
        />

        <AppButton
          disabled={pendingAction !== null}
          fullWidth
          label={localProfile ? 'Profil speichern' : 'Lokal fortfahren'}
          loading={pendingAction === 'save-local-profile'}
          onPress={() => void submit()}
          size="large"
        />
      </View>

      <AuthTextLink label="Ohne Profil zurück zur App" onPress={() => router.replace('/')} />
      <AuthTextLink label="Zur Kontoauswahl" onPress={() => router.replace('./connect-account')} />
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
