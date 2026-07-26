import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { useAppTheme } from '@/theme';

import { formatSharedSessionDate } from './planned-session-card';
import type { StudyGroupViewModel } from './types';

export type StudyGroupCardProps = {
  group: StudyGroupViewModel;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function StudyGroupCard({ group, onPress, style }: StudyGroupCardProps) {
  const theme = useAppTheme();
  const memberCount = Math.max(0, Math.round(group.memberCount));
  const activeGoalCount = Math.max(0, Math.round(group.activeGoalCount));
  const nextSessionLabel = group.nextSessionAt
    ? formatSharedSessionDate(group.nextSessionAt)
    : 'Noch keine Session geplant';

  return (
    <AppCard
      accessibilityLabel={`${group.name}, ${memberCount} ${memberCount === 1 ? 'Mitglied' : 'Mitglieder'}, ${activeGoalCount} ${activeGoalCount === 1 ? 'aktives Ziel' : 'aktive Ziele'}, nächste Session: ${nextSessionLabel}`}
      onPress={onPress}
      padding="lg"
      style={[styles.card, style]}
      testID={`study-group-${group.id}`}>
      <View style={styles.header}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.visual,
            {
              backgroundColor: theme.colors.accentTurquoiseMuted,
              borderColor: theme.colors.accentTurquoise,
              borderRadius: theme.radii.lg,
            },
          ]}>
          {group.imageUrl ? (
            <Image contentFit="cover" source={{ uri: group.imageUrl }} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={[theme.typography.heading, { color: theme.colors.accentTurquoise }]}>
              {group.icon.trim() || '◎'}
            </Text>
          )}
        </View>
        <View style={styles.titleCopy}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            selectable
            style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {group.name}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {memberCount} {memberCount === 1 ? 'Mitglied' : 'Mitglieder'}
          </Text>
        </View>
      </View>

      <View style={[styles.facts, { borderTopColor: theme.colors.divider }]}>
        <View style={styles.fact}>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Aktive Ziele
          </Text>
          <Text
            selectable
            style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.accentOlive }]}>
            {activeGoalCount}
          </Text>
        </View>
        <View style={[styles.fact, styles.nextSession]}>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Nächste Session
          </Text>
          <Text
            numberOfLines={2}
            selectable
            style={[theme.typography.label, styles.numeric, { color: theme.colors.text }]}>
            {nextSessionLabel}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 16,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  visual: {
    width: 56,
    height: 56,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  titleCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  facts: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fact: {
    minWidth: 112,
    flex: 1,
    gap: 2,
  },
  nextSession: {
    minWidth: 190,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
