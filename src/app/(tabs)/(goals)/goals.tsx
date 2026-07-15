import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { SegmentedControl } from '@/components/segmented-control';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { SourceBadge } from '@/components/ui/source-badge';
import { useCurrentDate } from '@/hooks/use-current-date';
import { formatMinutes } from '@/lib/format';
import { evaluateGoal, getGoalTitle } from '@/lib/goals';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { StudyGoal } from '@/types/study';

type GoalFilter = 'active' | 'paused' | 'archive';

const FILTERS = [
  { value: 'active', label: 'Aktiv' },
  { value: 'paused', label: 'Pausiert' },
  { value: 'archive', label: 'Archiv' },
] as const;

const PERIOD_LABEL: Record<StudyGoal['period'], string> = {
  week: 'Wöchentlich',
  month: 'Monatlich',
  year: 'Jährlich',
};

function GoalCard({
  goal,
  expanded,
  confirmingDelete,
  onToggle,
  onDeleteRequest,
  onDeleteCancel,
}: {
  goal: StudyGoal;
  expanded: boolean;
  confirmingDelete: boolean;
  onToggle: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
}) {
  const theme = useAppTheme();
  const router = useRouter();
  const now = useCurrentDate();
  const {
    data,
    pauseGoal,
    resumeGoal,
    completeGoal,
    archiveGoal,
    deleteGoal,
  } = useStudyStore();
  const progress = evaluateGoal(goal, data.sessions, now);
  const title = getGoalTitle(goal, data.subjects);
  const subjectNames = goal.subjectIds
    ?.map((id) => data.subjects.find((subject) => subject.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const subjectLabel = subjectNames?.length ? subjectNames.join(', ') : 'Alle Fächer';
  const statusLabel = {
    active: 'Aktiv',
    paused: 'Pausiert',
    completed: 'Erreicht',
    archived: 'Archiviert',
  }[goal.status];

  return (
    <AppCard style={styles.goalCard} variant={progress.achieved ? 'highlight' : 'default'}>
      <View style={styles.goalHeader}>
        <View style={styles.goalHeading}>
          <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>
            {title}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {PERIOD_LABEL[goal.period]} · {subjectLabel} · {statusLabel}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={`Aktionen für ${title}`}
          accessibilityRole="button"
          onPress={onToggle}
          style={({ pressed }) => [
            styles.menuButton,
            { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceMuted },
          ]}>
          <Text style={[theme.typography.heading, styles.menuGlyph, { color: theme.colors.textMuted }]}>···</Text>
        </Pressable>
      </View>

      <View style={styles.badges}>
        <View style={[styles.statusBadge, { backgroundColor: theme.colors.primaryMuted }]}>
          <Text style={[theme.typography.caption, { color: theme.colors.onPrimaryMuted }]}>
            {goal.type === 'duration' ? 'ZEITZIEL' : 'SESSIONZIEL'}
          </Text>
        </View>
        {goal.sourcePolicy === 'timer_only' ? (
          <SourceBadge compact label="Nur Timer" source="timer" />
        ) : (
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Alle Lernzeiten zählen</Text>
        )}
      </View>

      <View style={styles.progressCopy}>
        <Text selectable style={[theme.typography.heading, styles.numeric, { color: theme.colors.text }]}>
          {goal.type === 'duration'
            ? `${formatMinutes(progress.current, true)} von ${formatMinutes(progress.target, true)}`
            : `${progress.current} von ${progress.target} Sessions`}
        </Text>
        {goal.type === 'sessions' ? (
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            Mindestens {formatMinutes(goal.minimumSessionMinutes, true)} je Session
          </Text>
        ) : null}
      </View>

      <ProgressBar
        accessibilityLabel={`Fortschritt für ${title}`}
        formatValue={() => `${Math.round(progress.progressPercent)} %`}
        max={Math.max(1, progress.target)}
        showValue
        size="lg"
        tone={progress.achieved ? 'success' : 'primary'}
        value={progress.current}
      />

      <Text selectable style={[theme.typography.label, { color: progress.achieved ? theme.colors.success : theme.colors.textMuted }]}>
        {progress.achieved
          ? 'Ziel erreicht – alles Weitere ist Bonus.'
          : goal.type === 'duration'
            ? `Noch ${formatMinutes(progress.remaining, true)}`
            : `Noch ${progress.remaining} ${progress.remaining === 1 ? 'Session' : 'Sessions'}`}
      </Text>

      {expanded ? (
        <View style={[styles.actionPanel, { borderTopColor: theme.colors.divider }]}>
          {confirmingDelete ? (
            <>
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Ziel endgültig löschen?</Text>
              <View style={styles.actionRow}>
                <AppButton label="Löschen" onPress={() => deleteGoal(goal.id)} size="compact" variant="danger" />
                <AppButton label="Abbrechen" onPress={onDeleteCancel} size="compact" variant="ghost" />
              </View>
            </>
          ) : (
            <View style={styles.actionRow}>
              {goal.status === 'active' || goal.status === 'paused' ? (
                <AppButton
                  label="Bearbeiten"
                  onPress={() => router.push({ pathname: '/create-goal', params: { goalId: goal.id } })}
                  size="compact"
                  variant="outline"
                />
              ) : null}
              {goal.status === 'active' ? (
                <AppButton label="Pausieren" onPress={() => pauseGoal(goal.id)} size="compact" variant="outline" />
              ) : null}
              {goal.status === 'paused' ? (
                <AppButton label="Fortsetzen" onPress={() => resumeGoal(goal.id)} size="compact" variant="secondary" />
              ) : null}
              {goal.status === 'active' || goal.status === 'paused' ? (
                <AppButton label="Als erreicht markieren" onPress={() => completeGoal(goal.id)} size="compact" variant="outline" />
              ) : null}
              {goal.status !== 'archived' ? (
                <AppButton label="Archivieren" onPress={() => archiveGoal(goal.id)} size="compact" variant="ghost" />
              ) : null}
              <AppButton label="Löschen" onPress={onDeleteRequest} size="compact" variant="ghost" />
            </View>
          )}
        </View>
      ) : null}
    </AppCard>
  );
}

export default function GoalsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { data } = useStudyStore();
  const [filter, setFilter] = useState<GoalFilter>('active');
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const twoColumns = width >= theme.layout.tabletBreakpoint;
  const goals = data.goals.filter((goal) =>
    filter === 'archive'
      ? goal.status === 'completed' || goal.status === 'archived'
      : goal.status === filter,
  );
  const emptyCopy = {
    active: ['Noch kein aktives Ziel', 'Setze ein erreichbares Ziel und baue deinen Lernrhythmus Schritt für Schritt auf.'],
    paused: ['Keine pausierten Ziele', 'Pausierte Ziele kannst du hier später wieder fortsetzen.'],
    archive: ['Dein Archiv ist leer', 'Erreichte und archivierte Ziele bleiben hier nachvollziehbar.'],
  }[filter];

  return (
    <Screen maxWidth={1100}>
      <View style={styles.pageHeader}>
        <SectionHeader
          description="Fortschritt wird aus Zeitraum, Startdatum, Fach und Zeitquelle einheitlich berechnet."
          eyebrow="Dein Plan"
          title="Lernziele"
        />
        <AppButton label="Neues Ziel" onPress={() => router.push('/create-goal')} />
      </View>

      <SegmentedControl
        accessibilityLabel="Ziele nach Status filtern"
        onChange={(value) => {
          setFilter(value);
          setExpandedGoalId(null);
          setDeletingGoalId(null);
        }}
        options={FILTERS}
        style={styles.filters}
        value={filter}
      />

      {goals.length === 0 ? (
        <EmptyState
          actionLabel={filter === 'active' ? 'Erstes Ziel erstellen' : undefined}
          message={emptyCopy[1]}
          onActionPress={filter === 'active' ? () => router.push('/create-goal') : undefined}
          symbol="◎"
          title={emptyCopy[0]}
        />
      ) : (
        <View style={styles.goalGrid}>
          {goals.map((goal) => (
            <View key={goal.id} style={twoColumns ? styles.goalCellTablet : styles.goalCellPhone}>
              <GoalCard
                confirmingDelete={deletingGoalId === goal.id}
                expanded={expandedGoalId === goal.id}
                goal={goal}
                onDeleteCancel={() => setDeletingGoalId(null)}
                onDeleteRequest={() => setDeletingGoalId(goal.id)}
                onToggle={() => {
                  setExpandedGoalId((current) => current === goal.id ? null : goal.id);
                  setDeletingGoalId(null);
                }}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pageHeader: { width: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 18 },
  filters: { maxWidth: 520 },
  goalGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 },
  goalCellPhone: { width: '100%' },
  goalCellTablet: { flexBasis: '47%', flexGrow: 1, maxWidth: '49%' },
  goalCard: { width: '100%', gap: 18 },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  goalHeading: { flex: 1, minWidth: 0, gap: 4 },
  menuButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
  menuGlyph: { marginTop: -10 },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  statusBadge: { minHeight: 26, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 999 },
  progressCopy: { gap: 4 },
  actionPanel: { borderTopWidth: 1, paddingTop: 16, gap: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  numeric: { fontVariant: ['tabular-nums'] },
});
