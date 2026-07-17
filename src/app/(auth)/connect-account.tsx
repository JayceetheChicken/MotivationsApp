import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AuthDivider,
  AuthNotice,
  AuthScaffold,
  AuthTextLink,
} from '@/auth/auth-ui';
import { AppButton } from '@/components/ui/app-button';
import { useAuthStore } from '@/state/auth-store';

export default function ConnectAccountScreen() {
  const router = useRouter();
  const { configuration, localProfile } = useAuthStore();

  return (
    <AuthScaffold
      subtitle="Ein Konto ist freiwillig. Du kannst Lernzeit jederzeit weiter nur auf diesem Gerät nutzen."
      title="Konto verbinden">
      <AuthNotice title="Deine Daten bleiben erhalten" tone="success">
        Beim Verbinden werden vorhandene lokale Fächer, Lernzeiten, Noten und Ziele
        automatisch und ohne Duplikate in deinen Konto-Bereich übernommen.
      </AuthNotice>

      {!configuration.isConfigured ? (
        <AuthNotice title="Cloud-Konto nicht konfiguriert">
          {configuration.message} Der lokale Modus bleibt vollständig verfügbar.
        </AuthNotice>
      ) : null}

      <View style={styles.actions}>
        <AppButton
          disabled={!configuration.isConfigured}
          fullWidth
          label="Mit Cloud-Konto anmelden"
          onPress={() => router.push('/login')}
          size="large"
        />
        <AppButton
          disabled={!configuration.isConfigured}
          fullWidth
          label="Cloud-Konto erstellen"
          onPress={() => router.push('/register')}
          variant="outline"
        />
        <AuthDivider label="oder nur auf diesem Gerät" />
        <AppButton
          fullWidth
          label={localProfile ? 'Lokales Profil bearbeiten' : 'Lokales Profil erstellen'}
          onPress={() => router.push('/local-profile')}
          variant="outline"
        />
      </View>

      <AuthTextLink label="Ohne Konto zurück zur App" onPress={() => router.replace('/')} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    width: '100%',
    gap: 12,
  },
});
