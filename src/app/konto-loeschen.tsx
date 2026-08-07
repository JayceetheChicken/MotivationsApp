import { router, type Href } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { OPERATOR } from '@/legal/operator';
import { useAuthStore } from '@/state/auth-store';
import { useAppTheme } from '@/theme';

const deletedData = [
  'Online-Profil, Benutzername und Profilbild',
  'synchronisierte Lernzeiten, Sessionsegmente, Fächer, Noten, persönliche Ziele und Statistiken',
  'Freundschaften, offene Einladungen und die eigenen Mitgliedschaften in Gruppen, gemeinsamen Zielen und gemeinsamen Sessions',
  'Presence-, Synchronisations-, Import-, Mutation-Receipt- und lokale Outbox-Daten',
  'Supabase-Authentifizierungsnutzer und lokale kontobezogene Caches',
] as const;

export default function AccountDeletionInformationScreen() {
  const auth = useAuthStore();
  const theme = useAppTheme();
  const signedIn = auth.activeMode === 'supabase';

  return (
    <Screen contentContainerStyle={styles.content} maxWidth={760}>
      <Stack.Title>Konto löschen</Stack.Title>
      <AppCard style={styles.card} variant="subtle">
        <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>Lernzeit-Konto dauerhaft löschen</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Die sichere Löschung erfolgt nach Anmeldung in Lernzeit unter „Konto & Einstellungen“ im deutlich markierten Bereich „Konto löschen“. Dort sind dein aktuelles Passwort und eine zweite Bestätigung durch Eingabe von LÖSCHEN erforderlich.</Text>
      </AppCard>

      <AppCard style={styles.card} variant="outlined">
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Diese Daten werden gelöscht</Text>
        {deletedData.map((entry) => (
          <View key={entry} style={styles.bulletRow}>
            <Text selectable style={[theme.typography.body, { color: theme.colors.primary }]}>•</Text>
            <Text selectable style={[theme.typography.body, styles.bulletText, { color: theme.colors.textMuted }]}>{entry}</Text>
          </View>
        ))}
      </AppCard>

      <AppCard style={styles.card} variant="outlined">
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Aufbewahrung und gemeinsame Inhalte</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{`Gesetzliche Aufbewahrungspflichten: ${OPERATOR.statutoryRetention} Pflichtdaten werden bis zum Fristende gesperrt und anschließend gelöscht.`}</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Gruppen, gemeinsame Ziele und gemeinsame Sessions mit verbleibenden akzeptierten Teilnehmenden werden vor der Löschung deterministisch auf eine berechtigte Person übertragen. Nur gemeinsame Objekte ohne verbleibende Teilnehmende werden gelöscht.</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Nach der finalen Bestätigung startet die technische Löschung unmittelbar. Die App zeigt Erfolg oder Fehler an und wechselt nach Erfolg in den Gastmodus.</Text>
      </AppCard>

      <AppCard style={styles.card} variant="subtle">
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Sicherer Löschprozess</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{signedIn
          ? 'Du bist angemeldet. Öffne jetzt den geschützten Löschbereich in den Kontoeinstellungen.'
          : 'Melde dich mit dem zu löschenden Online-Konto an. Öffne danach Konto & Einstellungen und den Bereich Konto löschen. Eine frei eingegebene E-Mail-Adresse reicht aus Sicherheitsgründen nicht als Löschfreigabe.'}</Text>
        <AppButton
          fullWidth
          label={signedIn ? 'Sicheren Löschbereich öffnen' : 'Sicher anmelden'}
          onPress={() => router.push(signedIn ? '/profile' : '/login')}
        />
      </AppCard>

      <AppCard style={styles.card} variant="outlined">
        <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Kontakt und Probleme beim Zugriff</Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{`Kontakt für Löschanfragen und Identitätsprüfung: ${OPERATOR.privacyContactEmail}. Keine Löschung wird allein aufgrund einer unbestätigten E-Mail-Eingabe durchgeführt.`}</Text>
      </AppCard>

      <AppButton fullWidth label="Datenschutzerklärung öffnen" onPress={() => router.push('/datenschutz' as Href)} variant="outline" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  card: { gap: 12 },
  bulletRow: { flexDirection: 'row', gap: 10 },
  bulletText: { flex: 1 },
});
