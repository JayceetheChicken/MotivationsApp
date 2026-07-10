import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';

export const unstable_settings = { anchor: 'stats' };

export default function StatsStackLayout() {
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
      <Stack.Screen name="stats" options={{ title: 'Statistik' }} />
    </Stack>
  );
}
