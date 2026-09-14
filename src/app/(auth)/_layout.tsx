import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme';
import { ONLINE_BACKEND_REQUIRED } from '@/auth/backend-policy';

export default function AuthStackLayout() {
  const theme = useAppTheme();

  return (
    <Stack
      initialRouteName="login"
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: theme.colors.background },
        headerShown: false,
      }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="update-password" />
      <Stack.Protected guard={!ONLINE_BACKEND_REQUIRED}>
        <Stack.Screen name="local-profile" />
      </Stack.Protected>
    </Stack>
  );
}
