import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';

export default function AuthStackLayout() {
  const theme = useAppTheme();

  return (
    <Stack
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: theme.colors.background },
        headerShown: false,
      }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="update-password" />
      <Stack.Screen name="local-profile" />
    </Stack>
  );
}
