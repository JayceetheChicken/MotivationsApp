import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AuthField,
  AuthNotice,
  AuthScaffold,
  AuthTextLink,
} from '@/auth/auth-ui';
import { emailError } from '@/auth/validation';
import { AppButton } from '@/components/ui/app-button';
import { useAuthStore } from '@/state/auth-store';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const {
    configuration,
    error,
    notice,
    pendingAction,
    sendPasswordReset,
    clearFeedback,
  } = useAuthStore();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  const submit = async () => {
    const nextError = emailError(email);
    setFieldError(nextError);
    if (nextError) return;
    await sendPasswordReset(email);
  };

  return (
    <AuthScaffold
      subtitle="Wir senden dir einen sicheren Link an deine hinterlegte E-Mail-Adresse."
      title="Passwort zurücksetzen">
      <View style={styles.form}>
        {!configuration.isConfigured ? (
          <AuthNotice title="Supabase nicht konfiguriert">
            {configuration.message} Eine Reset-E-Mail wird nicht simuliert.
          </AuthNotice>
        ) : null}
        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
        {notice ? <AuthNotice tone="success">{notice}</AuthNotice> : null}

        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          error={fieldError}
          keyboardType="email-address"
          label="E-Mail-Adresse"
          onChangeText={(value) => {
            setEmail(value);
            if (fieldError) setFieldError(undefined);
            if (error || notice) clearFeedback();
          }}
          onSubmitEditing={() => void submit()}
          placeholder="name@beispiel.de"
          returnKeyType="send"
          value={email}
        />

        <AppButton
          disabled={!configuration.isConfigured || pendingAction !== null}
          fullWidth
          label="Reset-Link senden"
          loading={pendingAction === 'reset-password'}
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
