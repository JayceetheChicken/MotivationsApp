import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme';

export type AppButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type AppButtonSize = 'compact' | 'default' | 'large';

export type AppButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftAccessory?: ReactNode;
  rightAccessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppButton({
  label,
  variant = 'primary',
  size = 'default',
  loading = false,
  fullWidth = false,
  leftAccessory,
  rightAccessory,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityState,
  ...pressableProps
}: AppButtonProps) {
  const theme = useAppTheme();
  const isDisabled = disabled || loading;

  const variantValues = {
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
      pressedBackgroundColor: theme.colors.primaryPressed,
      textColor: theme.colors.onPrimary,
    },
    secondary: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.accentBrown,
      pressedBackgroundColor: theme.colors.surfacePressed,
      textColor: theme.colors.accentBrown,
    },
    outline: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.borderStrong,
      pressedBackgroundColor: theme.colors.surfacePressed,
      textColor: theme.colors.text,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      pressedBackgroundColor: theme.colors.primaryMuted,
      textColor: theme.colors.primaryText,
    },
    danger: {
      backgroundColor: theme.colors.danger,
      borderColor: theme.colors.danger,
      pressedBackgroundColor: theme.colors.dangerPressed,
      textColor: theme.colors.onDanger,
    },
  }[variant];

  const sizeValues = {
    compact: { minHeight: theme.layout.minTouchTarget, paddingHorizontal: theme.spacing.md },
    default: { minHeight: 48, paddingHorizontal: theme.spacing.lg },
    large: { minHeight: 54, paddingHorizontal: theme.spacing.xl },
  }[size];

  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        sizeValues,
        {
          backgroundColor: variantValues.backgroundColor,
          borderColor: variantValues.borderColor,
          borderRadius: theme.radii.lg,
        },
        fullWidth ? styles.fullWidth : undefined,
        pressed && !isDisabled
          ? { backgroundColor: variantValues.pressedBackgroundColor }
          : undefined,
        pressed && !isDisabled ? styles.pressed : undefined,
        isDisabled ? styles.disabled : undefined,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variantValues.textColor} />
      ) : (
        <>
          {leftAccessory}
          <Text
            numberOfLines={1}
            style={[
              theme.typography.label,
              styles.label,
              { color: variantValues.textColor },
              textStyle,
            ]}>
            {label}
          </Text>
          {rightAccessory}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    textAlign: 'center',
  },
  pressed: {
    transform: [{ scale: 0.995 }],
  },
  disabled: {
    opacity: 0.56,
  },
});
