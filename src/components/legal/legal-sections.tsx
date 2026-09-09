import { StyleSheet, Text, View } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import type { LegalSection } from '@/legal/privacy-content';
import { useAppTheme } from '@/theme';

export function LegalSections({ sections }: { sections: readonly LegalSection[] }) {
  const theme = useAppTheme();
  return sections.map((section) => (
    <AppCard key={section.title} style={styles.card} variant="subtle">
      <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>{section.title}</Text>
      {section.paragraphs?.map((paragraph) => (
        <Text key={paragraph} selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>{paragraph}</Text>
      ))}
      {section.bullets?.map((bullet) => (
        <View key={bullet} style={styles.bulletRow}>
          <Text selectable style={[theme.typography.body, { color: theme.colors.primary }]}>•</Text>
          <Text selectable style={[theme.typography.body, styles.bulletText, { color: theme.colors.textMuted }]}>{bullet}</Text>
        </View>
      ))}
    </AppCard>
  ));
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  bulletRow: { flexDirection: 'row', gap: 10 },
  bulletText: { flex: 1 },
});
