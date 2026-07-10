import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme';
import type { Subject } from '@/types/study';

interface SubjectChipProps {
  subject: Subject;
  selected: boolean;
  onPress: () => void;
  dark?: boolean;
}

export function SubjectChip({ subject, selected, onPress, dark = false }: SubjectChipProps) {
  const theme = useAppTheme();
  const selectedBackground = dark ? 'rgba(255,255,255,0.16)' : theme.colors.primaryMuted;
  const idleBackground = dark ? 'rgba(255,255,255,0.07)' : theme.colors.surface;
  const borderColor = selected
    ? dark
      ? 'rgba(255,255,255,0.8)'
      : theme.colors.primary
    : dark
      ? 'rgba(255,255,255,0.14)'
      : theme.colors.border;
  const textColor = dark ? '#FFFFFF' : selected ? theme.colors.onPrimaryMuted : theme.colors.text;

  return (
    <Pressable
      accessibilityLabel={`Fach ${subject.name}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? selectedBackground : idleBackground,
          borderColor,
        },
        pressed ? styles.pressed : undefined,
      ]}>
      <View style={[styles.dot, { backgroundColor: subject.color }]} />
      <Text numberOfLines={1} style={[theme.typography.label, { color: textColor }]}>
        {subject.name}
      </Text>
      {selected ? <Text style={[styles.check, { color: textColor }]}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 48,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  check: {
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
});

