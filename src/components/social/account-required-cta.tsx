import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { useAppTheme } from '@/theme';

export type AccountRequiredCtaProps = {
  onSignIn: () => void;
  onRegister?: () => void;
  title?: string;
  message?: string;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AccountRequiredCta({
  onSignIn,
  onRegister,
  title = 'Online-Konto erforderlich',
  message = 'Freundschaften und gemeinsame Lernziele sind mit einem sicheren Online-Konto verfügbar. Dein Gastbereich bleibt vollständig lokal.',
  loading = false,
  style,
}: AccountRequiredCtaProps) {
  const theme = useAppTheme();

  return (
    <AppCard
      accessibilityLabel={`${title}. ${message}`}
      padding="lg"
      style={[styles.card, style]}
      variant="highlight">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.symbol,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.accentPeach,
            borderRadius: theme.radii.lg,
          },
        ]}>
        <Text style={[theme.typography.heading, { color: theme.colors.primaryText }]}>@</Text>
      </View>
      <View style={styles.copy}>
        <Text
          accessibilityRole="header"
          selectable
          style={[theme.typography.subheading, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          {message}
        </Text>
      </View>
      <View style={styles.actions}>
        <AppButton
          fullWidth
          label="Online-Konto anmelden"
          loading={loading}
          onPress={onSignIn}
        />
        {onRegister ? (
          <AppButton
            disabled={loading}
            fullWidth
            label="Online-Konto erstellen"
            onPress={onRegister}
            variant="outline"
          />
        ) : null}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'flex-start',
    gap: 18,
  },
  symbol: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  copy: {
    width: '100%',
    gap: 6,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
});
