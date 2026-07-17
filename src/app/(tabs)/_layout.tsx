import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { HOME_NAVIGATION_ANCHOR } from '@/auth/navigation';
import { useAppTheme } from '@/theme';

export const unstable_settings = { anchor: HOME_NAVIGATION_ANCHOR };

export default function TabsLayout() {
  const theme = useAppTheme();

  return (
    <NativeTabs
      backgroundColor={theme.colors.surface}
      iconColor={{ default: theme.colors.accentBrown, selected: theme.colors.primary }}
      indicatorColor={theme.colors.primaryMuted}
      tintColor={theme.colors.primary}
      labelStyle={{
        default: { color: theme.colors.accentBrown },
        selected: { color: theme.colors.primary },
      }}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Übersicht</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(goals)">
        <NativeTabs.Trigger.Icon sf="target" md="track_changes" />
        <NativeTabs.Trigger.Label>Ziele</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(stats)">
        <NativeTabs.Trigger.Icon sf="chart.bar.fill" md="bar_chart" />
        <NativeTabs.Trigger.Label>Statistik</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(friends)">
        <NativeTabs.Trigger.Icon sf="person.2.fill" md="group" />
        <NativeTabs.Trigger.Label>Freunde</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
