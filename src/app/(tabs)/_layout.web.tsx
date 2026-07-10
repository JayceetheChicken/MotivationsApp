import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useAppTheme } from '@/theme';

export const unstable_settings = { anchor: '(home)' };

export default function WebTabsLayout() {
  const theme = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 66,
          paddingTop: 8,
          paddingBottom: 8,
        },
      }}>
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'Übersicht',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⌂</Text>,
        }}
      />
      <Tabs.Screen
        name="(goals)"
        options={{
          title: 'Ziele',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>◎</Text>,
        }}
      />
      <Tabs.Screen
        name="(stats)"
        options={{
          title: 'Statistik',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>▥</Text>,
        }}
      />
      <Tabs.Screen
        name="(friends)"
        options={{
          title: 'Freunde',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>●●</Text>,
        }}
      />
    </Tabs>
  );
}
