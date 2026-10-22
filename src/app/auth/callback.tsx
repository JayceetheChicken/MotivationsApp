import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { AuthScaffold } from '@/auth/auth-ui';
import { useAuthStore } from '@/state/auth-store';

export default function EmailCallbackScreen() {
  const auth = useAuthStore();
  if (!auth.hydrated || auth.emailCallbackPending) {
    return <AuthScaffold title="E-Mail bestätigen" subtitle="Deine Anmeldung wird geprüft.">
      <ActivityIndicator accessibilityLabel="E-Mail-Bestätigung wird geprüft" />
    </AuthScaffold>;
  }
  return <Redirect href={auth.session ? '/' : '/login'} />;
}
