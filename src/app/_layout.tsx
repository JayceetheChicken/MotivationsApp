import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { router, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { type PropsWithChildren, useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import 'react-native-reanimated';

import {
  getStudyStorageConfiguration,
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
  const { activeMode, localProfile } = useAuthStore();
  const { data, hydrated, updateLocalProfile } = useStudyStore();

  useEffect(() => {
    // Supabase profiles are loaded by StudyRepository from public.profiles.
    // Mutable auth metadata is never projected into the domain store.
    if (!hydrated || activeMode !== 'local') return;

    const displayName = localProfile?.displayName;
    const username = localProfile?.username;
    const avatarUrl = localProfile?.avatarUri;

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
      displayName,
      username,
      avatarUrl,
    });
  }, [activeMode, data.currentUser, hydrated, localProfile, updateLocalProfile]);

  return null;
}

function ScopedStudyStore({ children }: PropsWithChildren) {
  const { activeMode, session, user } = useAuthStore();
  const storage = getStudyStorageConfiguration(activeMode, user?.id);

  return (
    <StudyStoreProvider
      accountAccessToken={session?.access_token}
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
  const onPasswordUpdateRoute = segments.some((segment) => segment === 'update-password');
  const onLocalImportRoute = segments.some((segment) => segment === 'import-local-data');

  // Einzige automatische Weiterleitung: ein echter Passwort-Recovery-Link.
  useEffect(() => {
    if (study.hydrated && auth.passwordRecoveryPending && !onPasswordUpdateRoute) {
      router.replace('/update-password');
    }
  }, [auth.passwordRecoveryPending, onPasswordUpdateRoute, study.hydrated]);

  useEffect(() => {
    if (study.hydrated) console.log('[BOOT] App navigation ready');
  }, [study.hydrated]);

  useEffect(() => {
    if (
      study.hydrated &&
      auth.activeMode === 'supabase' &&
      study.localImportPreview &&
      !onLocalImportRoute &&
      !auth.passwordRecoveryPending
    ) {
      router.push('/import-local-data');
    }
  }, [
    auth.activeMode,
    auth.passwordRecoveryPending,
    onLocalImportRoute,
    study.hydrated,
    study.localImportPreview,
  ]);

  // Nur die synchron hydrierenden lokalen Lerndaten gaten den Start. Der Stack
  // mountet sofort danach – Segmente dürfen nie Voraussetzung sein, weil sie
  // auf Native erst durch den gemounteten Stack aufgelöst werden.
  if (!study.hydrated) {
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
        <Stack.Screen
          name="import-local-data"
          options={{
            presentation: 'modal',
            title: 'Lokale Daten übertragen',
            gestureEnabled: false,
            headerBackVisible: false,
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
