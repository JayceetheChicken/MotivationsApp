import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps<T>) {
  const theme = useAppTheme();

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
        },
        style,
      ]}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected ? theme.colors.surface : 'transparent',
                borderColor: selected ? theme.colors.borderStrong : 'transparent',
                borderRadius: theme.radii.sm,
              },
              pressed ? styles.pressed : undefined,
            ]}>
            <Text
              style={[
                theme.typography.label,
                { color: selected ? theme.colors.primary : theme.colors.textMuted },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderWidth: 1,
  },
  segment: {
    minHeight: 40,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.74,
  },
});

