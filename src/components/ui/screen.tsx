import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme';

export type ScreenPadding = 'none' | 'compact' | 'default';

export type ScreenProps = Omit<ScrollViewProps, 'children' | 'contentContainerStyle'> & {
  children: ReactNode;
  maxWidth?: number;
  padding?: ScreenPadding;
  centered?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function Screen({
  children,
  maxWidth,
  padding = 'default',
  centered = false,
  contentContainerStyle,
  contentInsetAdjustmentBehavior = 'automatic',
  showsVerticalScrollIndicator = false,
  style,
  ...scrollViewProps
}: ScreenProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const responsiveGutter =
    width < theme.layout.phoneBreakpoint
      ? theme.layout.phoneGutter
      : width < theme.layout.tabletBreakpoint
        ? theme.layout.tabletGutter
        : theme.layout.desktopGutter;
  const horizontalPadding = {
    none: 0,
    compact: theme.spacing.md,
    default: responsiveGutter,
  }[padding];

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      style={[styles.scrollView, { backgroundColor: theme.colors.background }, style]}
      {...scrollViewProps}>
      <View
        style={[
          styles.content,
          {
            maxWidth: maxWidth ?? theme.layout.maxContentWidth,
            paddingHorizontal: horizontalPadding,
            paddingTop: padding === 'none' ? 0 : theme.spacing.xl,
            paddingBottom: padding === 'none' ? 0 : theme.spacing.giant,
          },
          centered ? styles.centered : undefined,
          contentContainerStyle,
        ]}>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  content: {
    width: '100%',
    flexGrow: 1,
    gap: 24,
  },
  centered: {
    justifyContent: 'center',
  },
});
