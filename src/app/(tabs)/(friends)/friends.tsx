import { StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import { getCurrentStreak, getWeekStats } from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type {
  ChallengeParticipant,
  Friend,
  StudyChallenge,
  StudyUser,
} from '@/types/study';

type ComparisonPerson = Readonly<{
  id: string;
  name: string;
  isCurrentUser: boolean;
  automaticMinutes: number;
  weekMinutes: number;
  weeklyGoalMinutes: number;
  streakDays: number;
  available: boolean;
}>;

function challengeProgress(challenge: StudyChallenge) {
  const accepted = challenge.participants.filter((participant) => participant.status === 'accepted');
  const multiplier = challenge.target.mode === 'per_participant' ? Math.max(1, accepted.length) : 1;

  if (challenge.target.type === 'duration') {
    const value = accepted.reduce(
      (sum, participant) => sum + participant.contributionMinutes,
      0,
    );
    const max = challenge.target.targetMinutes * multiplier;
    return {
      accepted,
      value,
      max,
      label: `${formatMinutes(value, true)} / ${formatMinutes(max, true)}`,
    };
  }

  const value = accepted.reduce((sum, participant) => sum + participant.timerSessionCount, 0);
  const max = challenge.target.targetSessions * multiplier;
  return {
    accepted,
    value,
    max,
    label: `${value} / ${max} Sessions`,
  };
}

function participantProgress(
  challenge: StudyChallenge,
  participant: ChallengeParticipant,
): { value: number; max: number; label: string } {
  if (challenge.target.type === 'duration') {
    return {
      value: participant.contributionMinutes,
      max: challenge.target.targetMinutes,
      label: formatMinutes(participant.contributionMinutes, true),
    };
  }

  return {
    value: participant.timerSessionCount,
    max: challenge.target.targetSessions,
    label: `${participant.timerSessionCount} ${participant.timerSessionCount === 1 ? 'Session' : 'Sessions'}`,
  };
}

function getRemainingDays(endsAt: string, now: Date): string {
  const difference = new Date(endsAt).getTime() - now.getTime();
  const days = Math.max(0, Math.ceil(difference / 86_400_000));
  if (days === 0) return 'Endet heute';
  return `Noch ${days} ${days === 1 ? 'Tag' : 'Tage'}`;
}

function personFromFriend(friend: Friend): ComparisonPerson {
  return {
    id: friend.user.id,
    name: friend.user.displayName,
    isCurrentUser: false,
    automaticMinutes: friend.stats?.automaticMinutes ?? 0,
    weekMinutes: friend.stats?.weekMinutes ?? 0,
    weeklyGoalMinutes: friend.stats?.weeklyGoalMinutes ?? 0,
    streakDays: friend.stats?.streakDays ?? 0,
    available: friend.canSeeTheirStats && Boolean(friend.stats),
  };
}

export default function FriendsRoute() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data, privacy, setFriendComparisonsEnabled } = useStudyStore();
  const now = new Date();
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const weekStats = getWeekStats(data.sessions, now);
  const currentStreak = getCurrentStreak(data.sessions, now);
  const weeklyDurationGoal = data.goals.find(
    (goal) => goal.status === 'active' && goal.period === 'week' && goal.type === 'duration',
  );
  const currentGoalTarget =
    weeklyDurationGoal?.type === 'duration' ? weeklyDurationGoal.targetMinutes : 0;
  const comparisonPeople: ComparisonPerson[] = [
    {
      id: data.currentUser.id,
      name: 'Du',
      isCurrentUser: true,
      automaticMinutes: weekStats.timerMinutes,
      weekMinutes: weekStats.totalMinutes,
      weeklyGoalMinutes: currentGoalTarget,
      streakDays: currentStreak,
      available: true,
    },
    ...data.friends
      .filter((friend) => friend.status === 'accepted')
      .map(personFromFriend),
  ];
  const activeChallenge = data.challenges.find((challenge) => challenge.status === 'active');
  const challengeSummary = activeChallenge ? challengeProgress(activeChallenge) : null;
  const usersById = new Map<string, StudyUser>([
    [data.currentUser.id, data.currentUser],
    ...data.friends.map((friend) => [friend.user.id, friend.user] as const),
  ]);

  return (
    <Screen>
      <AppCard padding="lg" variant="subtle">
        <View style={styles.privacyRow}>
          <View style={styles.privacyCopy}>
            <Text
              accessibilityRole="header"
              selectable
              style={[theme.typography.subheading, { color: theme.colors.text }]}>
              Freundesvergleich
            </Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Du entscheidest, ob du den Wochenvergleich sehen möchtest. Es gibt keine Rangliste.
            </Text>
          </View>
          <Switch
            accessibilityHint="Blendet den privaten Wochenvergleich ein oder aus"
            accessibilityLabel="Freundesvergleich anzeigen"
            ios_backgroundColor={theme.colors.track}
            onValueChange={setFriendComparisonsEnabled}
            thumbColor={
              privacy.friendComparisonsEnabled
                ? theme.colors.onPrimary
                : theme.colors.textSubtle
            }
            trackColor={{ false: theme.colors.track, true: theme.colors.primary }}
            value={privacy.friendComparisonsEnabled}
          />
        </View>
      </AppCard>

      <View style={[styles.grid, isTablet ? styles.gridTablet : undefined]}>
        <View style={[styles.column, isTablet ? styles.comparisonColumnTablet : undefined]}>
          {privacy.friendComparisonsEnabled ? (
            <AppCard padding="lg" style={styles.cardSection}>
              <View style={styles.sectionIntro}>
                <SectionHeader
                  description="Automatisch gemessene Minuten, bewusst ohne Platzierungen"
                  title="Gemeinsam durch die Woche"
                />
                <SourceBadge label="Nur Timer-Zeit im Vergleich" source="timer" />
              </View>
              <View style={styles.peopleList}>
                {comparisonPeople.map((person, index) => {
                  const goalReached =
                    person.weeklyGoalMinutes > 0 &&
                    person.weekMinutes >= person.weeklyGoalMinutes;
                  const goalLabel =
                    person.weeklyGoalMinutes === 0
                      ? 'Kein Wochenziel'
                      : goalReached
                        ? 'Wochenziel erreicht'
                        : 'Wochenziel in Arbeit';

                  return (
                    <View
                      key={person.id}
                      style={[
                        styles.personRow,
                        index > 0
                          ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 }
                          : undefined,
                      ]}>
                      <View style={styles.personMain}>
                        <Avatar
                          name={
                            person.isCurrentUser
                              ? data.currentUser.displayName
                              : person.name
                          }
                          size="md"
                        />
                        <View style={styles.personCopy}>
                          <View style={styles.nameRow}>
                            <Text
                              selectable
                              style={[
                                theme.typography.bodyMedium,
                                { color: theme.colors.text },
                              ]}>
                              {person.name}
                            </Text>
                            {person.isCurrentUser ? (
                              <Text
                                style={[
                                  theme.typography.caption,
                                  styles.youBadge,
                                  {
                                    color: theme.colors.onPrimaryMuted,
                                    backgroundColor: theme.colors.primaryMuted,
                                  },
                                ]}>
                                DEIN FORTSCHRITT
                              </Text>
                            ) : null}
                          </View>
                          {person.available ? (
                            <Text
                              selectable
                              style={[
                                theme.typography.caption,
                                { color: theme.colors.textMuted },
                              ]}>
                              {person.streakDays} {person.streakDays === 1 ? 'Tag' : 'Tage'} Streak · {goalLabel}
                            </Text>
                          ) : (
                            <Text
                              selectable
                              style={[
                                theme.typography.caption,
                                { color: theme.colors.textMuted },
                              ]}>
                              Statistik nicht freigegeben
                            </Text>
                          )}
                        </View>
                        {person.available ? (
                          <View style={styles.personMetric}>
                            <Text
                              selectable
                              style={[
                                theme.typography.bodyMedium,
                                styles.numeric,
                                { color: theme.colors.text },
                              ]}>
                              {formatMinutes(person.automaticMinutes, true)}
                            </Text>
                            <Text
                              style={[
                                theme.typography.caption,
                                { color: theme.colors.textMuted },
                              ]}>
                              automatisch
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {person.available && person.weeklyGoalMinutes > 0 ? (
                        <ProgressBar
                          accessibilityLabel={`Wochenziel von ${person.name}`}
                          max={person.weeklyGoalMinutes}
                          size="sm"
                          tone={goalReached ? 'success' : 'primary'}
                          value={person.weekMinutes}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </AppCard>
          ) : (
            <AppCard padding="lg" style={styles.cardSection}>
              <SectionHeader
                description="Deine eigenen Statistiken bleiben in den anderen Bereichen vollständig sichtbar."
                eyebrow="Privater Modus"
                title="Der Wochenvergleich ist ausgeblendet"
              />
              <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                Aktiviere den Schalter oben, wenn gemeinsames Lernen gerade motivierend für dich ist.
              </Text>
            </AppCard>
          )}
        </View>

        <View style={[styles.column, isTablet ? styles.challengeColumnTablet : undefined]}>
          {activeChallenge && challengeSummary ? (
            <AppCard padding="lg" style={styles.cardSection} variant="highlight">
              <View style={styles.sectionIntro}>
                <SectionHeader
                  description={activeChallenge.description}
                  eyebrow={getRemainingDays(activeChallenge.endsAt, now)}
                  title={activeChallenge.title}
                />
                <SourceBadge
                  label={
                    activeChallenge.sourcePolicy === 'timer_only'
                      ? 'Nur Timer-Zeit zählt'
                      : 'Timer und manuelle Zeit zählen'
                  }
                  source={activeChallenge.sourcePolicy === 'timer_only' ? 'timer' : 'manual'}
                />
              </View>
              <ProgressBar
                accessibilityLabel={`Gesamtfortschritt bei ${activeChallenge.title}`}
                formatValue={() => challengeSummary.label}
                max={challengeSummary.max}
                showValue
                size="lg"
                tone="success"
                value={challengeSummary.value}
              />
              <View style={styles.participants}>
                {challengeSummary.accepted.map((participant, index) => {
                  const user = usersById.get(participant.userId);
                  const progress = participantProgress(activeChallenge, participant);
                  const displayName =
                    participant.userId === data.currentUser.id
                      ? 'Du'
                      : user?.displayName ?? 'Teilnehmende Person';

                  return (
                    <View
                      key={participant.userId}
                      style={[
                        styles.participantRow,
                        index > 0
                          ? { borderTopColor: theme.colors.border, borderTopWidth: 1 }
                          : undefined,
                      ]}>
                      <View style={styles.participantHeader}>
                        <Avatar name={user?.displayName ?? displayName} size="sm" />
                        <Text
                          selectable
                          style={[
                            theme.typography.label,
                            styles.participantName,
                            { color: theme.colors.onPrimaryMuted },
                          ]}>
                          {displayName}
                        </Text>
                        <Text
                          selectable
                          style={[
                            theme.typography.label,
                            styles.numeric,
                            { color: theme.colors.onPrimaryMuted },
                          ]}>
                          {progress.label}
                        </Text>
                      </View>
                      <ProgressBar
                        accessibilityLabel={`Beitrag von ${displayName}`}
                        max={progress.max}
                        size="sm"
                        value={progress.value}
                      />
                    </View>
                  );
                })}
              </View>
              <Text
                selectable
                style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                Beiträge werden ohne Rangfolge gezeigt. Entscheidend ist euer gemeinsamer Fortschritt.
              </Text>
            </AppCard>
          ) : (
            <AppCard padding="lg" style={styles.cardSection}>
              <SectionHeader
                description="Wenn ihr eine Challenge startet, erscheint der gemeinsame Fortschritt hier."
                title="Keine aktive Challenge"
              />
            </AppCard>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  privacyRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  privacyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  grid: {
    width: '100%',
    gap: 20,
  },
  gridTablet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    width: '100%',
  },
  comparisonColumnTablet: {
    width: undefined,
    flex: 1.15,
  },
  challengeColumnTablet: {
    width: undefined,
    flex: 0.85,
  },
  cardSection: {
    width: '100%',
    gap: 20,
  },
  sectionIntro: {
    gap: 12,
  },
  peopleList: {
    width: '100%',
  },
  personRow: {
    paddingVertical: 16,
    gap: 12,
  },
  personMain: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  youBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  personMetric: {
    alignItems: 'flex-end',
    gap: 1,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  participants: {
    width: '100%',
  },
  participantRow: {
    paddingVertical: 14,
    gap: 10,
  },
  participantHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  participantName: {
    flex: 1,
    minWidth: 0,
  },
});
