import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';

export const unstable_settings = { anchor: 'friends' };

export default function FriendsStackLayout() {
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
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="friends" options={{ title: 'Freunde' }} />
      <Stack.Screen
        name="friend/[user-id]"
        options={{ headerLargeTitle: false, title: 'Freundesprofil' }}
      />
      <Stack.Screen
        name="shared-goal/create"
        options={{ headerLargeTitle: false, title: 'Gemeinsames Ziel' }}
      />
      <Stack.Screen
        name="shared-goal/[goal-id]"
        options={{ headerLargeTitle: false, title: 'Gemeinsames Ziel' }}
      />
    </Stack>
  );
}
