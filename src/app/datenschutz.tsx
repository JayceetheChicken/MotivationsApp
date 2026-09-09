import { router, type Href } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StyleSheet, Text } from 'react-native';

import { LegalSections } from '@/components/legal/legal-sections';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { OPERATOR_IS_DEVELOPMENT_ONLY } from '@/legal/operator';
import { privacyIntroduction, privacySections } from '@/legal/privacy-content';
import { useAppTheme } from '@/theme';

export default function PrivacyScreen() {
  const theme = useAppTheme();
  return (
    <Screen contentContainerStyle={styles.content} maxWidth={860}>
      <Stack.Title>Datenschutz</Stack.Title>
      <AppCard style={styles.introduction} variant="outlined">
        <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>Datenschutzerklärung für Lernzeit</Text>
        <Text
          accessibilityRole={OPERATOR_IS_DEVELOPMENT_ONLY ? 'alert' : 'text'}
          selectable
          style={[
            theme.typography.bodyMedium,
            { color: OPERATOR_IS_DEVELOPMENT_ONLY ? theme.colors.warning : theme.colors.textMuted },
          ]}
        >
          {privacyIntroduction}
        </Text>
      </AppCard>
      <LegalSections sections={privacySections} />
      <AppButton fullWidth label="Informationen zur Kontolöschung" onPress={() => router.push('/konto-loeschen' as Href)} variant="outline" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  introduction: { gap: 12 },
});
