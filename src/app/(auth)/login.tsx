import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AuthDivider,
  AuthField,
  AuthNotice,
  AuthScaffold,
  AuthTextLink,
} from '@/auth/auth-ui';
import { emailError, passwordError } from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { useAuthStore } from '@/state/auth-store';

type LoginErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginScreen() {
  const router = useRouter();
  const {
    configuration,
    error,
    notice,
    pendingAction,
    signIn,
    clearFeedback,
  } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<LoginErrors>({});

  const submit = async () => {
    const nextErrors: LoginErrors = {
      email: emailError(email),
      password: passwordError(password),
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    const result = await signIn(email, password);
    if (result.ok) router.replace('/');
  };

  return (
    <AuthScaffold
      subtitle="Melde dich an, um deine Lernzeit geräteübergreifend vorzubereiten."
      title="Willkommen zurück">
      <View style={styles.form}>
        {!configuration.isConfigured ? (
          <AuthNotice title="Lokaler Entwicklungsmodus">
            {configuration.message} Es wird keine Anmeldung simuliert.
          </AuthNotice>
        ) : null}
        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
        {notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}

        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          error={errors.email}
          keyboardType="email-address"
          label="E-Mail-Adresse"
          onChangeText={(value) => {
            setEmail(value);
            if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
            if (error || notice) clearFeedback();
          }}
          placeholder="name@beispiel.de"
          returnKeyType="next"
          value={email}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="current-password"
          error={errors.password}
          isPassword
          label="Passwort"
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
            if (error || notice) clearFeedback();
          }}
          onSubmitEditing={() => void submit()}
          placeholder="Dein Passwort"
          returnKeyType="done"
          value={password}
        />

        <View style={styles.forgotLink}>
          <AuthTextLink label="Passwort vergessen?" onPress={() => router.push('./forgot-password')} />
        </View>

        <AppButton
          disabled={!configuration.isConfigured || pendingAction !== null}
          fullWidth
          label="Anmelden"
          loading={pendingAction === 'sign-in'}
          onPress={() => void submit()}
          size="large"
        />
      </View>

      <View style={styles.secondaryActions}>
        <AuthTextLink label="Noch kein Konto? Registrieren" onPress={() => router.push('./register')} />
        <AuthDivider />
        <AppButton
          fullWidth
          label="Lokales Profil anlegen"
          onPress={() => router.push('./local-profile')}
          variant="outline"
        />
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  form: {
    width: '100%',
    gap: 16,
  },
  forgotLink: {
    alignItems: 'flex-end',
    marginTop: -8,
  },
  secondaryActions: {
    width: '100%',
    gap: 12,
  },
});
