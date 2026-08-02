import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthField, AuthNotice, AuthScaffold, AuthTextLink } from '@/auth/auth-ui';
import { passwordError } from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { useAuthStore } from '@/state/auth-store';

type PasswordFields = 'password' | 'confirmation';
type PasswordErrors = Partial<Record<PasswordFields, string>>;

export default function UpdatePasswordScreen() {
  const router = useRouter();
  const {
    configuration,
    error,
    notice,
    pendingAction,
    user,
    passwordRecoveryPending,
    updatePassword,
    clearFeedback,
  } = useAuthStore();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const canUpdate = configuration.isConfigured && Boolean(user);

  const submit = async () => {
    const nextErrors: PasswordErrors = {
      password: passwordError(password, true),
      confirmation: password !== confirmation ? 'Die Passwörter stimmen nicht überein.' : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.password || nextErrors.confirmation) return;

    const result = await updatePassword(password);
    if (result.ok) router.replace('/');
  };

  return (
    <AuthScaffold
      subtitle="Lege nach dem Öffnen des sicheren E-Mail-Links ein neues Passwort fest."
      title="Neues Passwort">
      <View style={styles.form}>
        {!configuration.isConfigured ? (
          <AuthNotice title="Passwort-Reset nicht verfügbar">
            Der Online-Dienst ist momentan nicht eingerichtet.
          </AuthNotice>
        ) : !user || !passwordRecoveryPending ? (
          <AuthNotice title="Reset-Link erforderlich">
            Öffne den aktuellen Link aus deiner Reset-E-Mail auf diesem Gerät. Erst danach kann das Passwort sicher geändert werden.
          </AuthNotice>
        ) : null}
        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
        {notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}

        <AuthField
          autoCapitalize="none"
          autoComplete="new-password"
          error={errors.password}
          hint="Mindestens 10 Zeichen."
          isPassword
          label="Neues Passwort"
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
            if (error || notice) clearFeedback();
          }}
          placeholder="Mindestens 10 Zeichen"
          value={password}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="new-password"
          error={errors.confirmation}
          isPassword
          label="Passwort bestätigen"
          onChangeText={(value) => {
            setConfirmation(value);
            if (errors.confirmation) setErrors((current) => ({ ...current, confirmation: undefined }));
            if (error || notice) clearFeedback();
          }}
          onSubmitEditing={() => void submit()}
          placeholder="Noch einmal eingeben"
          returnKeyType="done"
          value={confirmation}
        />

        <AppButton
          disabled={!canUpdate || pendingAction !== null}
          fullWidth
          label="Neues Passwort speichern"
          loading={pendingAction === 'update-password'}
          onPress={() => void submit()}
          size="large"
        />
      </View>

      <AuthTextLink label="Zurück zur Anmeldung" onPress={() => router.replace('./login')} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  form: {
    width: '100%',
    gap: 16,
  },
});
