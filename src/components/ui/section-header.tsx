import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme';

export type SectionHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actionLabel?: string;
  onActionPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({
  title,
  description,
  eyebrow,
  actionLabel,
  onActionPress,
  accessibilityLabel,
  style,
}: SectionHeaderProps) {
  const theme = useAppTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? (
          <Text
            selectable
            style={[
              theme.typography.caption,
              styles.eyebrow,
              { color: theme.colors.primary },
            ]}>
            {eyebrow}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          selectable
          style={[theme.typography.subheading, { color: theme.colors.text }]}>
          {title}
        </Text>
        {description ? (
          <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityLabel={accessibilityLabel ?? actionLabel}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.action,
            { borderRadius: theme.radii.sm },
            pressed ? { backgroundColor: theme.colors.surfacePressed } : undefined,
          ]}>
          <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  action: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
