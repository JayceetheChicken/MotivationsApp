import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { useAppTheme } from '@/theme';

interface GradeModalShellProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
  visible: boolean;
}

export function GradeModalShell({
  children,
  onClose,
  title,
  visible,
}: GradeModalShellProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View
        accessibilityViewIsModal
        style={[
          styles.overlay,
          {
            backgroundColor: theme.colors.overlay,
            paddingTop: Math.max(theme.spacing.lg, insets.top + theme.spacing.sm),
            paddingBottom: Math.max(theme.spacing.lg, insets.bottom + theme.spacing.sm),
          },
        ]}>
        <Pressable
          accessibilityLabel="Dialog schließen"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
          style={styles.keyboardView}>
          <View
            style={[
              styles.dialog,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.borderStrong,
                borderRadius: theme.radii.xl,
                boxShadow: `0 16px 48px ${theme.colors.focusShadow}`,
              },
            ]}>
            <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
              <Text
                accessibilityRole="header"
                selectable
                style={[theme.typography.heading, styles.headerTitle, { color: theme.colors.text }]}>
                {title}
              </Text>
              <AppButton label="Schließen" onPress={onClose} size="compact" variant="ghost" />
            </View>
            <ScrollView
              contentContainerStyle={styles.content}
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  keyboardView: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '100%',
  },
  dialog: {
    width: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    minWidth: 0,
    flex: 1,
  },
  content: {
    gap: 26,
    padding: 20,
    paddingBottom: 32,
  },
});
