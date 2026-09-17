import { type PropsWithChildren } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack } from "expo-router/stack";
import { ONLINE_BACKEND_REQUIRED } from "@/auth/backend-policy";
import { useAuthStore } from "@/state/auth-store";

// Render no StudyStore at all before online authentication. This also prevents
// deep links, an old local profile, or sign-out from opening a local repository.
export function OnlineAccountBoundary({ children }: PropsWithChildren) {
  const auth = useAuthStore();
  if (!ONLINE_BACKEND_REQUIRED) return children;
  if (!auth.configuration.isConfigured) {
    return <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <Text accessibilityRole="alert">Diese App-Version kann keine Verbindung zu ihrem Online-Backend herstellen. Bitte installiere eine korrekt konfigurierte Version.</Text>
    </View>;
  }
  if (!auth.hydrated) {
    return <View style={{ flex: 1, justifyContent: 'center' }}>
      <ActivityIndicator accessibilityLabel="Online-Anmeldung wird geladen" />
    </View>;
  }
  if (auth.session) return children;
  return <Stack initialRouteName="(auth)" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="(auth)" />
    <Stack.Screen name="auth/callback" />
    <Stack.Screen name="datenschutz" />
    <Stack.Screen name="nutzungsbedingungen" />
    <Stack.Screen name="community-regeln" />
    <Stack.Screen name="impressum" />
    <Stack.Protected guard={false}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="session" />
      <Stack.Screen name="manual-entry" />
      <Stack.Screen name="create-goal" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="konto-loeschen" />
      <Stack.Screen name="report-content" />
      <Stack.Screen name="import-local-data" />
    </Stack.Protected>
  </Stack>;
}
