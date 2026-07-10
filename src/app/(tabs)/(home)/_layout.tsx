import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';

export default function HomeStackLayout() {
  const theme = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerLargeStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
      }}>
      <Stack.Screen name="index" options={{ title: 'Übersicht' }} />
    </Stack>
  );
}

