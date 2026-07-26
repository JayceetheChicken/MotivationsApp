import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
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

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl' | number;

export type AvatarProps = {
  name: string;
  source?: ImageProps['source'];
  size?: AvatarSize;
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return '?';
  }

  const selectedWords = words.length === 1 ? words : [words[0], words.at(-1) ?? ''];
  return selectedWords
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase('de-DE');
}

function imageSourceKey(source: ImageProps['source']): string | null {
  if (!source) return null;
  if (typeof source === 'string' || typeof source === 'number') return String(source);
  if (Array.isArray(source)) return source.map(imageSourceKey).join('|');
  if ('uri' in source && typeof source.uri === 'string') return source.uri;
  try {
    return JSON.stringify(source);
  } catch {
    return String(source);
  }
}

export function Avatar({
  name,
  source,
  size = 'md',
  onPress,
  accessibilityLabel,
  style,
}: AvatarProps) {
  const theme = useAppTheme();
  const sourceKey = imageSourceKey(source);
  const [failedSourceKey, setFailedSourceKey] = useState<string | null>(null);
  const showImage = Boolean(source && sourceKey !== failedSourceKey);
  const resolvedSize =
    typeof size === 'number'
      ? Math.max(24, size)
      : { sm: 32, md: 44, lg: 56, xl: 72 }[size];
  const avatarLabel = accessibilityLabel ?? `Profilbild von ${name}`;

  const avatar = (
    <View
      accessible={!onPress}
      accessibilityLabel={!onPress ? avatarLabel : undefined}
      accessibilityRole={!onPress ? 'image' : undefined}
      style={[
        styles.avatar,
        {
          width: resolvedSize,
          height: resolvedSize,
          borderRadius: resolvedSize / 2,
          backgroundColor: theme.colors.primaryMuted,
          borderColor: theme.colors.border,
        },
        style,
      ]}>
      {showImage ? (
        <Image
          accessible={false}
          contentFit="cover"
          onError={() => setFailedSourceKey(sourceKey)}
          source={source}
          style={StyleSheet.absoluteFill}
          testID="avatar-image"
        />
      ) : (
        <Text
          style={{
            color: theme.colors.onPrimaryMuted,
            fontSize: Math.max(12, Math.round(resolvedSize * 0.34)),
            lineHeight: Math.max(16, Math.round(resolvedSize * 0.42)),
            fontWeight: '700',
          }}>
          {getInitials(name)}
        </Text>
      )}
    </View>
  );

  if (!onPress) {
    return avatar;
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? `Profil von ${name} öffnen`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressable,
        {
          minWidth: theme.layout.minTouchTarget,
          minHeight: theme.layout.minTouchTarget,
        },
        pressed ? styles.pressed : undefined,
      ]}>
      {avatar}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  pressed: {
    opacity: 0.82,
  },
});
