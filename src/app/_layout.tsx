import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Redirect, router, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import 'react-native-reanimated';

import {
  getRequiredAuthRoute,
  getStartupRoute,
  getStudyStorageConfiguration,
  HOME_NAVIGATION_ANCHOR,
  ROOT_NAVIGATION_ANCHOR,
} from '@/auth/navigation';
import { AuthStoreProvider, useAuthStore } from '@/state/auth-store';
import { StudyStoreProvider, useStudyStore } from '@/state/study-store';
import { appTheme, type AppTheme } from '@/theme';

export const unstable_settings = { anchor: ROOT_NAVIGATION_ANCHOR };

function ModalBackButton({ color, surface, border }: { color: string; surface: string; border: string }) {
  return (
    <Pressable
      accessibilityLabel="Zurück"
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => router.dismiss()}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surface,
        borderColor: border,
        borderWidth: 1,
        borderRadius: 21,
        opacity: pressed ? 0.55 : 1,
      })}>
      <Text style={{ color, fontSize: 30, lineHeight: 34, fontWeight: '400' }}>‹</Text>
    </Pressable>
  );
}

function AccountStudyBridge() {
  const { activeMode, localProfile, user } = useAuthStore();
  const { data, hydrated, updateLocalProfile } = useStudyStore();

  useEffect(() => {
    if (!hydrated || activeMode === 'none') return;

    const metadata = user?.user_metadata as Record<string, unknown> | undefined;
    const emailFallback = user?.email?.split('@')[0] || 'lernprofil';
    const displayName = activeMode === 'local'
      ? localProfile?.displayName
      : typeof metadata?.display_name === 'string'
        ? metadata.display_name
        : emailFallback;
    const username = activeMode === 'local'
      ? localProfile?.username
      : typeof metadata?.username === 'string'
        ? metadata.username
        : emailFallback;
    const avatarUrl = activeMode === 'local'
      ? localProfile?.avatarUri
      : typeof metadata?.avatar_url === 'string'
        ? metadata.avatar_url
        : undefined;

    if (!displayName || !username) return;
    const current = data.currentUser;
    if (
      current?.displayName === displayName &&
      current.username === username &&
      current.avatarUrl === avatarUrl
    ) {
      return;
    }
    updateLocalProfile({
      userId: activeMode === 'supabase' ? user?.id : undefined,
      displayName,
      username,
      avatarUrl,
    });
  }, [activeMode, data.currentUser, hydrated, localProfile, updateLocalProfile, user]);

  return null;
}

function ScopedStudyStore({ children }: PropsWithChildren) {
  const { activeMode, user } = useAuthStore();
  const storage = getStudyStorageConfiguration(activeMode, user?.id);

  return (
    <StudyStoreProvider
      accountUserId={storage.accountUserId}
      importStorageScope={storage.importStorageScope}
      key={storage.storageScope}
      storageScope={storage.storageScope}>
      {children}
    </StudyStoreProvider>
  );
}

function HydratedNavigator({ appTheme }: { appTheme: AppTheme }) {
  const segments = useSegments();
  const auth = useAuthStore();
  const study = useStudyStore();
  const [startupHandled, setStartupHandled] = useState(false);
  const ready = auth.hydrated && study.hydrated;
  const hasResolvedRoute = segments.length > 0;
  const onHomeRoute = segments.some((segment) => segment === ROOT_NAVIGATION_ANCHOR)
    && segments.some((segment) => segment === HOME_NAVIGATION_ANCHOR);
  const onPasswordUpdateRoute = segments.some((segment) => segment === 'update-password');
  const startupRoute = getStartupRoute({
    hasResolvedRoute,
    onHomeRoute,
    onPasswordUpdateRoute,
    passwordRecoveryPending: auth.passwordRecoveryPending,
    ready,
  });

  useEffect(() => {
    if (
      startupHandled
      || !ready
      || !hasResolvedRoute
      || startupRoute !== null
    ) {
      return;
    }
    const completion = setTimeout(() => setStartupHandled(true), 0);
    return () => clearTimeout(completion);
  }, [hasResolvedRoute, ready, startupHandled, startupRoute]);

  useEffect(() => {
    if (!startupHandled) return;
    const requiredRoute = getRequiredAuthRoute({
      onPasswordUpdateRoute,
      passwordRecoveryPending: auth.passwordRecoveryPending,
      ready,
    });
    if (requiredRoute) router.replace(requiredRoute);
  }, [auth.passwordRecoveryPending, onPasswordUpdateRoute, ready, startupHandled]);

  if (!ready || !hasResolvedRoute || (!startupHandled && startupRoute === null)) {
    return (
      <View
        accessibilityLabel="Lerndaten werden geladen"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: appTheme.colors.background,
        }}>
        <ActivityIndicator color={appTheme.colors.primary} size="large" />
      </View>
    );
  }

  if (!startupHandled && startupRoute) {
    return <Redirect href={startupRoute} />;
  }

  return (
    <>
      <AccountStudyBridge />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: appTheme.colors.background },
          headerStyle: { backgroundColor: appTheme.colors.surface },
          headerShadowVisible: false,
          headerTintColor: appTheme.colors.text,
          headerTitleStyle: { color: appTheme.colors.text, fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="session" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Stack.Screen
          name="manual-entry"
          options={{
            presentation: 'modal',
            title: 'Lernzeit nachtragen',
            headerBackVisible: false,
            headerLeft: () => (
              <ModalBackButton
                border={appTheme.colors.accentBrownMuted}
                color={appTheme.colors.primary}
                surface={appTheme.colors.accentPeachMuted}
              />
            ),
          }}
        />
        <Stack.Screen
          name="create-goal"
          options={{
            presentation: 'modal',
            title: 'Lernziel',
            headerBackVisible: false,
            headerLeft: () => (
              <ModalBackButton
                border={appTheme.colors.accentBrownMuted}
                color={appTheme.colors.primary}
                surface={appTheme.colors.accentPeachMuted}
              />
            ),
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            presentation: 'modal',
            title: 'Konto & Einstellungen',
            headerBackVisible: false,
            headerLeft: () => (
              <ModalBackButton
                border={appTheme.colors.accentBrownMuted}
                color={appTheme.colors.primary}
                surface={appTheme.colors.accentPeachMuted}
              />
            ),
          }}
        />
      </Stack>
    </>
  );
}

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: appTheme.colors.primary,
    background: appTheme.colors.background,
    card: appTheme.colors.surface,
    text: appTheme.colors.text,
    border: appTheme.colors.border,
    notification: appTheme.colors.danger,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <AuthStoreProvider>
        <ScopedStudyStore>
          <StatusBar style="dark" />
          <HydratedNavigator appTheme={appTheme} />
        </ScopedStudyStore>
      </AuthStoreProvider>
    </ThemeProvider>
  );
}
