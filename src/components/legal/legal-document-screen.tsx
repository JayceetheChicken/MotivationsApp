import { Stack } from 'expo-router/stack';
import { StyleSheet, Text } from 'react-native';

import { LegalSections } from '@/components/legal/legal-sections';
import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import type { LegalSection } from '@/legal/privacy-content';
import { useAppTheme } from '@/theme';

export function LegalDocumentScreen({
  title,
  notice,
  sections,
}: {
  title: string;
  notice: string;
  sections: readonly LegalSection[];
}) {
  const theme = useAppTheme();
  return (
    <Screen contentContainerStyle={styles.content} maxWidth={860}>
      <Stack.Title>{title}</Stack.Title>
      <AppCard style={styles.introduction} variant="outlined">
        <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>{title}</Text>
        <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.warning }]}>{notice}</Text>
      </AppCard>
      <LegalSections sections={sections} />
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { gap: 18 }, introduction: { gap: 12 } });
