import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { useAppTheme } from '@/theme';

interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onActionPress?: () => void;
  symbol?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onActionPress,
  symbol = '○',
  compact = false,
  style,
}: EmptyStateProps) {
  const theme = useAppTheme();

  return (
    <AppCard
      accessible
      accessibilityLabel={`${title}. ${message}`}
      padding={compact ? 'md' : 'lg'}
      style={[styles.card, compact ? styles.compactCard : undefined, style]}
      variant="subtle">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.symbol,
          {
            backgroundColor: theme.colors.accentPeachMuted,
            borderColor: theme.colors.accentPeach,
            borderRadius: theme.radii.lg,
          },
        ]}>
        <Text style={{ color: theme.colors.primaryText, fontSize: 24, fontWeight: '600' }}>
          {symbol}
        </Text>
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
      {actionLabel && onActionPress ? (
        <AppButton label={actionLabel} onPress={onActionPress} variant="outline" />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'flex-start',
    gap: 16,
  },
  compactCard: {
    gap: 12,
  },
  symbol: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  copy: {
    width: '100%',
    gap: 5,
  },
});
