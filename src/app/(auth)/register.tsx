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
  displayNameError,
  emailError,
  passwordError,
  usernameError,
} from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { useAuthStore } from '@/state/auth-store';

type RegisterField = 'displayName' | 'username' | 'email' | 'password' | 'confirmation';
type RegisterErrors = Partial<Record<RegisterField, string>>;

export default function RegisterScreen() {
  const router = useRouter();
  const {
    configuration,
    error,
    notice,
    pendingAction,
    signUp,
    clearFeedback,
  } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<RegisterErrors>({});

  const updateField = (
    field: RegisterField,
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (error || notice) clearFeedback();
  };

  const submit = async () => {
    const nextErrors: RegisterErrors = {
      displayName: displayNameError(displayName),
      username: usernameError(username),
      email: emailError(email),
      password: passwordError(password, true),
      confirmation: confirmation !== password ? 'Die Passwörter stimmen nicht überein.' : undefined,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    const result = await signUp({ displayName, username, email, password });
    if (result.ok && result.sessionCreated) router.replace('/');
  };

  return (
    <AuthScaffold
      subtitle="Deine lokalen Lerndaten bleiben bestehen und werden nach erfolgreicher Anmeldung in den Konto-Bereich übernommen."
      title="Cloud-Konto erstellen">
      <View style={styles.form}>
        {!configuration.isConfigured ? (
          <AuthNotice title="Registrierung nicht verfügbar">
            {configuration.message} Es wird kein Konto vorgetäuscht.
          </AuthNotice>
        ) : null}
        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
        {notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}

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
          autoComplete="email"
          error={errors.email}
          keyboardType="email-address"
          label="E-Mail-Adresse"
          onChangeText={(value) => updateField('email', setEmail, value)}
          placeholder="name@beispiel.de"
          value={email}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="new-password"
          error={errors.password}
          hint="Mindestens 8 Zeichen."
          isPassword
          label="Passwort"
          onChangeText={(value) => updateField('password', setPassword, value)}
          placeholder="Sicheres Passwort"
          value={password}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="new-password"
          error={errors.confirmation}
          isPassword
          label="Passwort wiederholen"
          onChangeText={(value) => updateField('confirmation', setConfirmation, value)}
          onSubmitEditing={() => void submit()}
          placeholder="Passwort erneut eingeben"
          returnKeyType="done"
          value={confirmation}
        />

        <AppButton
          disabled={!configuration.isConfigured || pendingAction !== null}
          fullWidth
          label="Konto erstellen"
          loading={pendingAction === 'sign-up'}
          onPress={() => void submit()}
          size="large"
        />
      </View>

      <View style={styles.secondaryActions}>
        <AuthTextLink label="Ohne Anmeldung zurück zur App" onPress={() => router.replace('/')} />
        <AuthTextLink label="Schon registriert? Anmelden" onPress={() => router.replace('./login')} />
        <AuthTextLink label="Zur Kontoauswahl" onPress={() => router.replace('./connect-account')} />
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  form: {
    width: '100%',
    gap: 16,
  },
  secondaryActions: {
    width: '100%',
    gap: 12,
  },
});
