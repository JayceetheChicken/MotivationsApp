import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { useAppTheme } from '@/theme';

export type SocialPrivacyNoteProps = {
  title?: string;
  message?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SocialPrivacyNote({
  title = 'Privat bleibt privat',
  message = 'Private Ziele, Fächer, Aufgaben und Notizen werden nicht angezeigt. Sichtbar sind nur allgemeine Lernstände und gemeinsam erstellte Inhalte.',
  compact = false,
  style,
}: SocialPrivacyNoteProps) {
  const theme = useAppTheme();

  return (
    <AppCard
      accessibilityLabel={`${title}. ${message}`}
      padding={compact ? 'sm' : 'md'}
      style={[styles.card, style]}
      variant="subtle">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.symbol,
          {
            width: compact ? 36 : 44,
            height: compact ? 36 : 44,
            backgroundColor: theme.colors.successMuted,
            borderColor: theme.colors.success,
            borderRadius: theme.radii.md,
          },
        ]}>
        <Text style={[theme.typography.label, { color: theme.colors.success }]}>✓</Text>
      </View>
      <View style={styles.copy}>
        <Text
          accessibilityRole="header"
          selectable
          style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          {message}
        </Text>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  symbol: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
});
