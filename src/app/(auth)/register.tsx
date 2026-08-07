import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

type RegisterField = 'displayName' | 'username' | 'email' | 'password' | 'confirmation' | 'rules';
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
  const [rulesAccepted, setRulesAccepted] = useState(false);
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
      rules: rulesAccepted ? undefined : 'Bitte stimme den Nutzungsbedingungen und Community-Regeln ausdrücklich zu.',
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    const result = await signUp({
      displayName,
      username,
      email,
      password,
      communityRulesAccepted: rulesAccepted,
    });
    if (result.ok && result.sessionCreated) router.replace('/');
  };

  return (
    <AuthScaffold
      subtitle="Deine lokalen Lerndaten bleiben bestehen und werden nach erfolgreicher Anmeldung in den Konto-Bereich übernommen."
      title="Online-Konto erstellen">
      <View style={styles.form}>
        {!configuration.isConfigured ? (
          <AuthNotice title="Registrierung nicht verfügbar">
            Du kannst die App weiterhin vollständig ohne Konto nutzen.
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
          hint="Mindestens 10 Zeichen."
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

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rulesAccepted }}
          onPress={() => {
            setRulesAccepted((current) => !current);
            if (errors.rules) setErrors((current) => ({ ...current, rules: undefined }));
          }}
          style={styles.checkboxRow}>
          <View style={[styles.checkbox, rulesAccepted && styles.checkboxChecked]}>
            <Text style={styles.checkboxMark}>{rulesAccepted ? '✓' : ''}</Text>
          </View>
          <Text style={styles.checkboxText}>
            Ich stimme den Nutzungsbedingungen und Community-Regeln in der Version 02.08.2026 zu.
          </Text>
        </Pressable>
        {errors.rules ? <Text accessibilityRole="alert" style={styles.error}>{errors.rules}</Text> : null}
        <View style={styles.legalLinks}>
          <AuthTextLink label="Nutzungsbedingungen lesen" onPress={() => router.push('/nutzungsbedingungen' as Href)} />
          <AuthTextLink label="Community-Regeln lesen" onPress={() => router.push('/community-regeln' as Href)} />
          <AuthTextLink label="Datenschutzerklärung lesen" onPress={() => router.push('/datenschutz' as Href)} />
        </View>

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
  checkboxRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: '#7A321F', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#7A321F' },
  checkboxMark: { color: '#FFFFFF', fontSize: 16, lineHeight: 20, fontWeight: '700' },
  checkboxText: { flex: 1, color: '#382A21', fontSize: 14, lineHeight: 20 },
  error: { color: '#9F2D20', fontSize: 13, lineHeight: 18 },
  legalLinks: { width: '100%', gap: 8 },
});
