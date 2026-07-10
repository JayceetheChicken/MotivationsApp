import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme';

export type AppCardVariant = 'default' | 'subtle' | 'outlined' | 'highlight';
export type AppCardPadding = 'none' | 'sm' | 'md' | 'lg';

export type AppCardProps = Omit<ViewProps, 'children' | 'style'> & {
  children: ReactNode;
  variant?: AppCardVariant;
  padding?: AppCardPadding;
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppCard({
  children,
  variant = 'default',
  padding = 'md',
  onPress,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  ...viewProps
}: AppCardProps) {
  const theme = useAppTheme();

  const paddingValue = {
    none: 0,
    sm: theme.spacing.sm,
    md: theme.spacing.lg,
    lg: theme.spacing.xl,
  }[padding];

  const variantStyle: ViewStyle = {
    default: {
      backgroundColor: theme.colors.surfaceElevated,
      borderColor: theme.colors.border,
      boxShadow: `0 10px 30px ${theme.colors.shadow}`,
    },
    subtle: {
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: 'transparent',
    },
    outlined: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.borderStrong,
    },
    highlight: {
      backgroundColor: theme.colors.primaryMuted,
      borderColor: theme.colors.primaryMuted,
    },
  }[variant];

  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    variantStyle,
    { padding: paddingValue },
    onPress ? styles.interactive : undefined,
    disabled ? styles.disabled : undefined,
    style,
  ];

  if (!onPress) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        style={cardStyle}
        {...viewProps}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        cardStyle,
        pressed && !disabled ? styles.pressed : undefined,
      ]}
      {...viewProps}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  interactive: {
    minHeight: 48,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
