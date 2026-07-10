import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';

export const unstable_settings = { anchor: 'goals' };

export default function GoalsStackLayout() {
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
      <Stack.Screen name="goals" options={{ title: 'Lernziele' }} />
    </Stack>
  );
}
