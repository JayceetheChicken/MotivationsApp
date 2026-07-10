import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import 'react-native-reanimated';

import { StudyStoreProvider, useStudyStore } from '@/state/study-store';
import { darkTheme, lightTheme, type AppTheme } from '@/theme';

export const unstable_settings = { anchor: '(tabs)' };

function ModalBackButton({
  color,
}: {
  color: string;
}) {
  return (
    <Pressable
      accessibilityLabel="Zurück"
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => router.dismiss()}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.55 : 1,
      })}>
      <Text style={{ color, fontSize: 30, lineHeight: 34, fontWeight: '400' }}>‹</Text>
    </Pressable>
  );
}

function HydratedNavigator({ appTheme }: { appTheme: AppTheme }) {
  const { hydrated } = useStudyStore();

  if (!hydrated) {
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
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: appTheme.colors.background },
        headerStyle: { backgroundColor: appTheme.colors.background },
        headerShadowVisible: false,
        headerTintColor: appTheme.colors.text,
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="session"
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="manual-entry"
        options={{
          presentation: 'modal',
          title: 'Lernzeit nachtragen',
          headerBackVisible: false,
          headerLeft: () => <ModalBackButton color={appTheme.colors.text} />,
        }}
      />
      <Stack.Screen
        name="create-goal"
        options={{
          presentation: 'modal',
          title: 'Neues Lernziel',
          headerBackVisible: false,
          headerLeft: () => <ModalBackButton color={appTheme.colors.text} />,
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          presentation: 'modal',
          title: 'Profil & Datenschutz',
          headerBackVisible: false,
          headerLeft: () => <ModalBackButton color={appTheme.colors.text} />,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const appTheme = isDark ? darkTheme : lightTheme;
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: appTheme.colors.primary,
      background: appTheme.colors.background,
      card: appTheme.colors.surface,
      text: appTheme.colors.text,
      border: appTheme.colors.border,
      notification: appTheme.colors.danger,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <StudyStoreProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <HydratedNavigator appTheme={appTheme} />
      </StudyStoreProvider>
    </ThemeProvider>
  );
}
