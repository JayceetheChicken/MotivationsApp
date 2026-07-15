import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Screen } from '@/components/ui/screen';
import { useAppTheme } from '@/theme';

export function AuthScaffold({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 840;

  return (
    <Screen
      centered
      contentContainerStyle={styles.screenContent}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maxWidth={1_040}>
      <View style={[styles.shell, isWide ? styles.shellWide : undefined]}>
        <View style={[styles.brand, isWide ? styles.brandWide : undefined]}>
          <View style={[styles.logo, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.logoText, { color: theme.colors.onPrimary }]}>L</Text>
          </View>
          <View style={styles.brandCopy}>
            <Text style={[theme.typography.subheading, { color: theme.colors.text }]}>Lernzeit</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>DEIN LERNFORTSCHRITT</Text>
          </View>
          {isWide ? (
            <View style={styles.widePitch}>
              <Text style={[theme.typography.title, { color: theme.colors.text }]}>Lernen, das sichtbar wird.</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Setze klare Ziele, erfasse deine echte Lernzeit und bleibe in deinem eigenen Rhythmus.</Text>
            </View>
          ) : null}
        </View>

        <AppCard padding="lg" style={[styles.card, isWide ? styles.cardWide : undefined]}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[theme.typography.heading, { color: theme.colors.text }]}>{title}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>{subtitle}</Text>
          </View>
          {children}
        </AppCard>
      </View>
    </Screen>
  );
}

type AuthFieldProps = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  label: string;
  error?: string;
  hint?: string;
  isPassword?: boolean;
};

export function AuthField({
  label,
  error,
  hint,
  isPassword = false,
  ...inputProps
}: AuthFieldProps) {
  const theme = useAppTheme();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const showPasswordAction = isPassword && Boolean(inputProps.value);

  return (
    <View style={styles.field}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{label}</Text>
      <View
        style={[
          styles.inputFrame,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
            borderRadius: theme.radii.md,
          },
        ]}>
        <TextInput
          {...inputProps}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          placeholderTextColor={theme.colors.textSubtle}
          secureTextEntry={isPassword && !passwordVisible}
          selectionColor={theme.colors.primary}
          style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
        />
        {showPasswordAction ? (
          <Pressable
            accessibilityLabel={passwordVisible ? 'Passwort ausblenden' : 'Passwort anzeigen'}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setPasswordVisible((current) => !current)}
            style={({ pressed }) => [styles.revealButton, pressed ? styles.pressed : undefined]}>
            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>{passwordVisible ? 'Ausblenden' : 'Anzeigen'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function AuthNotice({
  title,
  children,
  tone = 'info',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'info' | 'danger' | 'success';
}) {
  const theme = useAppTheme();
  const colors = {
    info: { background: theme.colors.primaryMuted, foreground: theme.colors.onPrimaryMuted },
    danger: { background: theme.colors.dangerMuted, foreground: theme.colors.danger },
    success: { background: theme.colors.successMuted, foreground: theme.colors.success },
  }[tone];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: colors.background, borderRadius: theme.radii.md }]}>
      {title ? <Text style={[theme.typography.label, { color: colors.foreground }]}>{title}</Text> : null}
      <Text style={[theme.typography.caption, { color: colors.foreground }]}>{children}</Text>
    </View>
  );
}

export function AuthTextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useAppTheme();

  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.textLink, pressed ? styles.pressed : undefined]}>
      <Text style={[theme.typography.label, { color: theme.colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

export function AuthDivider({ label = 'oder' }: { label?: string }) {
  const theme = useAppTheme();

  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.dividerRow}>
      <View style={[styles.dividerLine, { backgroundColor: theme.colors.divider }]} />
      <Text style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: theme.colors.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    justifyContent: 'center',
  },
  shell: {
    width: '100%',
    gap: 24,
  },
  shellWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 64,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandWide: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    alignContent: 'flex-start',
    flexWrap: 'wrap',
  },
  logo: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  logoText: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '800',
  },
  brandCopy: {
    gap: 1,
  },
  widePitch: {
    width: '100%',
    gap: 14,
    marginTop: 80,
  },
  card: {
    width: '100%',
    alignSelf: 'center',
    gap: 24,
  },
  cardWide: {
    flex: 1,
    maxWidth: 480,
  },
  heading: {
    gap: 6,
  },
  field: {
    width: '100%',
    gap: 7,
  },
  inputFrame: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  input: {
    minWidth: 0,
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  revealButton: {
    minWidth: 74,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  notice: {
    width: '100%',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pressed: {
    opacity: 0.62,
  },
  dividerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    height: StyleSheet.hairlineWidth,
    flex: 1,
  },
});
