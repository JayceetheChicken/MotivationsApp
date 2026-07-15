import { StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useCurrentDate } from '@/hooks/use-current-date';
import { formatMinutes } from '@/lib/format';
import { getCurrentStreak, getWeekStats } from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { StudyChallenge } from '@/types/study';

function challengeProgress(challenge: StudyChallenge) {
  const participants = challenge.participants.filter((participant) => participant.status === 'accepted');
  const multiplier = challenge.target.mode === 'per_participant' ? Math.max(1, participants.length) : 1;
  if (challenge.target.type === 'duration') {
    const value = participants.reduce((sum, participant) => sum + participant.contributionMinutes, 0);
    const max = challenge.target.targetMinutes * multiplier;
    return { value, max, label: `${formatMinutes(value, true)} von ${formatMinutes(max, true)}` };
  }
  const value = participants.reduce((sum, participant) => sum + participant.timerSessionCount, 0);
  const max = challenge.target.targetSessions * multiplier;
  return { value, max, label: `${value} von ${max} Sessions` };
}

export default function FriendsScreen() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data, privacy, setFriendComparisonsEnabled } = useStudyStore();
  const now = useCurrentDate();
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const acceptedFriends = data.friends.filter((friend) => friend.status === 'accepted');
  const activeChallenges = data.challenges.filter((challenge) => challenge.status === 'active');
  const week = getWeekStats(data.sessions, now);
  const streak = getCurrentStreak(data.sessions, now);

  return (
    <Screen>
      <SectionHeader
        description="Private Vergleiche mit bestätigten Freunden – freiwillig und ohne öffentliche Rangliste."
        eyebrow="Gemeinsam motiviert"
        title="Freunde"
      />

      <AppCard padding="lg" variant="subtle">
        <View style={styles.privacyRow}>
          <View style={styles.privacyCopy}>
            <Text accessibilityRole="header" style={[theme.typography.subheading, { color: theme.colors.text }]}>
              Freundesvergleich anzeigen
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Du kannst den gesamten sozialen Vergleich jederzeit ausblenden. Deine eigenen Statistiken bleiben erhalten.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Freundesvergleich anzeigen"
            ios_backgroundColor={theme.colors.track}
            onValueChange={setFriendComparisonsEnabled}
            thumbColor={privacy.friendComparisonsEnabled ? theme.colors.primary : theme.colors.textSubtle}
            trackColor={{ false: theme.colors.track, true: theme.colors.primaryMuted }}
            value={privacy.friendComparisonsEnabled}
          />
        </View>
      </AppCard>

      <View style={[styles.columns, isTablet ? styles.columnsTablet : undefined]}>
        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.wideColumn : undefined]}>
          <View style={styles.sectionIntro}>
            <SectionHeader
              description="Timer-Minuten, Zielstatus und Streak – nur soweit freigegeben."
              title="Diese Woche"
            />
            <SourceBadge label="Vergleichbare Timer-Zeit" source="timer" />
          </View>

          {!privacy.friendComparisonsEnabled ? (
            <EmptyState
              compact
              message="Aktiviere den Schalter oben, wenn ein gemeinsamer Blick auf die Woche gerade hilfreich ist."
              symbol="◌"
              title="Vergleich ausgeblendet"
            />
          ) : acceptedFriends.length === 0 ? (
            <EmptyState
              compact
              message="Bestätigte Freundschaften erscheinen hier. Bis dahin bleibt dein Fortschritt vollständig privat."
              symbol="＋"
              title="Noch keine Freunde verbunden"
            />
          ) : (
            <View style={styles.peopleList}>
              <View style={styles.personRow}>
                <Avatar name={data.currentUser?.displayName ?? 'Du'} size="md" />
                <View style={styles.personCopy}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Du</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                    {streak} {streak === 1 ? 'Tag' : 'Tage'} Serie
                  </Text>
                </View>
                <View style={styles.metricCopy}>
                  <Text style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>
                    {formatMinutes(week.timerMinutes, true)}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>automatisch</Text>
                </View>
              </View>
              {acceptedFriends.map((friend) => (
                <View key={friend.id} style={[styles.personRow, { borderTopColor: theme.colors.divider, borderTopWidth: 1 }]}>
                  <Avatar name={friend.user.displayName} size="md" />
                  <View style={styles.personCopy}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{friend.user.displayName}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      {friend.canSeeTheirStats && friend.stats
                        ? `${friend.stats.streakDays} ${friend.stats.streakDays === 1 ? 'Tag' : 'Tage'} Serie`
                        : 'Statistik nicht freigegeben'}
                    </Text>
                  </View>
                  {friend.canSeeTheirStats && friend.stats ? (
                    <View style={styles.metricCopy}>
                      <Text style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>
                        {formatMinutes(friend.stats.automaticMinutes, true)}
                      </Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>automatisch</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </AppCard>

        <AppCard padding="lg" style={[styles.sectionCard, isTablet ? styles.narrowColumn : undefined]}>
          <SectionHeader
            description="Gemeinsame Ziele zeigen Fortschritt ohne Platzierungsdruck."
            title="Lern-Challenges"
          />
          {activeChallenges.length === 0 ? (
            <EmptyState
              compact
              message={acceptedFriends.length === 0
                ? 'Sobald Freunde verbunden sind, könnt ihr gemeinsam Lernziele verfolgen.'
                : 'Es läuft gerade keine gemeinsame Challenge.'}
              symbol="◎"
              title="Keine aktive Challenge"
            />
          ) : (
            <View style={styles.challengeList}>
              {activeChallenges.map((challenge) => {
                const progress = challengeProgress(challenge);
                return (
                  <View key={challenge.id} style={styles.challengeItem}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{challenge.title}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{challenge.description}</Text>
                    <ProgressBar
                      formatValue={() => progress.label}
                      max={Math.max(1, progress.max)}
                      showValue
                      value={progress.value}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </AppCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  privacyRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
  privacyCopy: { flex: 1, minWidth: 0, gap: 4 },
  columns: { width: '100%', gap: 20 },
  columnsTablet: { flexDirection: 'row', alignItems: 'flex-start' },
  wideColumn: { flex: 1.15 },
  narrowColumn: { flex: 0.85 },
  sectionCard: { width: '100%', gap: 20 },
  sectionIntro: { gap: 12 },
  peopleList: { width: '100%' },
  personRow: { minHeight: 72, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personCopy: { flex: 1, minWidth: 0, gap: 2 },
  metricCopy: { alignItems: 'flex-end', gap: 2 },
  challengeList: { gap: 20 },
  challengeItem: { gap: 10 },
  numeric: { fontVariant: ['tabular-nums'] },
});
