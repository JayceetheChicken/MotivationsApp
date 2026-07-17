import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubjectSelector } from '@/components/subject-selector';
import { AppButton } from '@/components/ui/app-button';
import { useCurrentDate } from '@/hooks/use-current-date';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import { formatClock, formatMinutes } from '@/lib/format';
import { evaluateGoal, getGoalSubjectId, getGoalTitle } from '@/lib/goals';
import { getTimerRecoveryDecision, MINIMUM_SESSION_SECONDS } from '@/lib/timer';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

export default function SessionScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { goalId: requestedGoalId } = useLocalSearchParams<{ goalId?: string }>();
  const {
    data,
    addSubject,
    startTimer,
    pauseTimer,
    resumeTimer,
    finishTimer,
    discardTimer,
  } = useStudyStore();
  const now = useCurrentDate();
  const availableSubjects = data.subjects.filter((subject) => !subject.archived);
  const requestedGoal = data.goals.find((goal) => goal.id === requestedGoalId && goal.status === 'active');
  const requestedGoalSubject = requestedGoal ? getGoalSubjectId(requestedGoal) : null;
  const requestedGoalSubjectId = requestedGoalSubject
    && availableSubjects.some((subject) => subject.id === requestedGoalSubject)
    ? requestedGoalSubject
    : undefined;
  const [selectedSubjectId, setSelectedSubjectId] = useState(
    () => data.activeTimer?.subjectId ?? requestedGoalSubjectId ?? availableSubjects[0]?.id ?? '',
  );
  const [plannedDuration, setPlannedDuration] = useState('');
  const [note, setNote] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [reviewingRecovery, setReviewingRecovery] = useState(
    () => Boolean(data.activeTimer && getTimerRecoveryDecision(data.activeTimer) === 'review_unusually_long_session'),
  );
  const elapsedSeconds = useTimerElapsed(data.activeTimer);
  const effectiveSelectedSubjectId = requestedGoalSubjectId ?? selectedSubjectId;
  const activeSubject = data.subjects.find(
    (subject) => subject.id === (data.activeTimer?.subjectId ?? effectiveSelectedSubjectId),
  );
  const activeGoal = data.goals.find((goal) => goal.id === data.activeTimer?.goalId);
  const goalProgress = useMemo(
    () => activeGoal ? evaluateGoal(activeGoal, data.sessions, now) : null,
    [activeGoal, data.sessions, now],
  );
  const background = theme.colors.focusBackground;
  const foreground = theme.colors.focusText;
  const foregroundMuted = theme.colors.focusTextMuted;
  const isTablet = width >= theme.layout.tabletBreakpoint;
  const isShort = elapsedSeconds < MINIMUM_SESSION_SECONDS;
  const parsedPlannedDuration = Number(plannedDuration.replace(',', '.'));
  const plannedDurationIsValid = !plannedDuration.trim()
    || (Number.isFinite(parsedPlannedDuration) && parsedPlannedDuration >= 1 && parsedPlannedDuration <= 720);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const saveSession = (allowShortSession = false) => {
    const saved = finishTimer(allowShortSession ? { allowShortSession: true } : undefined);
    if (saved) close();
  };

  const discardAndClose = () => {
    discardTimer();
    close();
  };

  const correctRecoveredSession = () => {
    discardTimer();
    router.replace('/manual-entry');
  };

  const beginSession = () => {
    if (!effectiveSelectedSubjectId) {
      setStartError('Bitte wähle zuerst ein Fach aus.');
      return;
    }
    if (!plannedDurationIsValid) {
      setStartError('Die geplante Dauer muss zwischen 1 und 720 Minuten liegen.');
      return;
    }
    const started = startTimer({
      subjectId: effectiveSelectedSubjectId,
      goalId: requestedGoalSubjectId ? requestedGoal?.id : null,
      plannedDurationMinutes: plannedDuration.trim() ? parsedPlannedDuration : undefined,
      note,
    });
    if (!started) {
      setStartError('Die Session konnte nicht gestartet werden. Prüfe bitte Ziel und Fach.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, backgroundColor: background },
      ]}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: background }}>
      <View style={[styles.header, { maxWidth: isTablet ? 840 : undefined }]}>
        <Pressable
          accessibilityLabel="Session-Ansicht schließen"
          accessibilityRole="button"
          onPress={close}
          style={({ pressed }) => [
            styles.closeButton,
            { backgroundColor: theme.colors.focusSurfaceStrong },
            pressed ? styles.pressed : undefined,
          ]}>
          <Text style={[styles.closeText, { color: foreground }]}>×</Text>
        </Pressable>
        <View style={[styles.headerLabel, { backgroundColor: theme.colors.focusSurface }]}>
          <View style={[styles.liveDot, { backgroundColor: theme.colors.primary }]} />
          <Text style={[styles.headerLabelText, { color: foregroundMuted }]}>
            {data.activeTimer ? 'FOKUSZEIT' : 'NEUE SESSION'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {data.activeTimer ? (
        <View style={[styles.timerContent, { maxWidth: isTablet ? 720 : 520 }]}>
          <View style={[styles.subjectPill, { backgroundColor: theme.colors.focusSurfaceStrong }]}>
            <View style={[styles.subjectDot, { backgroundColor: activeSubject?.color ?? theme.colors.primary }]} />
            <Text style={[styles.subjectPillText, { color: foreground }]}>
              {activeSubject?.name ?? data.activeTimer.subjectNameSnapshot ?? 'Lern-Session'}
            </Text>
          </View>

          {reviewingRecovery ? (
            <View accessibilityLiveRegion="assertive" style={[styles.noticeCard, { backgroundColor: theme.colors.focusSurfaceStrong, borderColor: theme.colors.focusAccent }]}>
              <Text accessibilityRole="header" style={[styles.noticeTitle, { color: foreground }]}>Ungewöhnlich lange Session erkannt</Text>
              <Text style={[styles.noticeText, { color: foregroundMuted }]}>
                Der Timer läuft seit {formatMinutes(elapsedSeconds / 60, true)}. Prüfe kurz, ob diese Zeit vollständig Lernzeit war.
              </Text>
              <AppButton
                fullWidth
                label="Pausieren und prüfen"
                onPress={() => { pauseTimer(); setReviewingRecovery(false); }}
                style={[styles.lightButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
                textStyle={{ color: theme.colors.onPrimary }}
              />
              <AppButton fullWidth label="Weiterlaufen lassen" onPress={() => setReviewingRecovery(false)} variant="ghost" textStyle={{ color: foreground }} />
              <AppButton fullWidth label="Jetzt beenden und speichern" onPress={() => saveSession()} variant="outline" style={[styles.endButton, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorderStrong }]} textStyle={{ color: foreground }} />
              <AppButton fullWidth label="Zeit korrigieren" onPress={correctRecoveredSession} variant="outline" style={[styles.endButton, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorderStrong }]} textStyle={{ color: foreground }} />
              <AppButton fullWidth label="Timer verwerfen" onPress={discardAndClose} variant="danger" />
            </View>
          ) : (
            <>
              <View
                accessible
                accessibilityLabel={`Verstrichene Lernzeit ${formatMinutes(elapsedSeconds / 60)}`}
                style={[
                  styles.timerRing,
                  {
                    width: isTablet ? 330 : 274,
                    height: isTablet ? 330 : 274,
                    borderColor: theme.colors.primary,
                    backgroundColor: theme.colors.focusSurface,
                    boxShadow: `0 20px 70px ${theme.colors.focusShadow}`,
                  },
                ]}>
                <View style={[styles.timerRingInner, { borderColor: theme.colors.focusAccent }]}>
                  <Text selectable style={[styles.timerText, isTablet ? styles.timerTextTablet : undefined, { color: foreground }]}>
                    {formatClock(elapsedSeconds)}
                  </Text>
                  <Text style={[styles.timerState, { color: foregroundMuted }]}>
                    {data.activeTimer.status === 'running' ? 'Du bist im Fokus' : 'Session pausiert'}
                  </Text>
                </View>
              </View>

              <View style={[styles.motivationCard, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorder }]}>
                <Text style={[styles.motivationEyebrow, { color: theme.colors.focusAccent }]}>
                  {activeGoal
                    ? getGoalTitle(activeGoal, data.subjects).toUpperCase()
                    : data.activeTimer.goalTitleSnapshot?.toUpperCase() ?? 'DEIN EIGENER RHYTHMUS'}
                </Text>
                <Text style={[styles.motivationText, { color: foreground }]}>
                  {activeGoal && goalProgress
                    ? goalProgress.achieved
                      ? 'Ziel erreicht. Alles Weitere ist ein Bonus.'
                      : activeGoal.type === 'duration'
                        ? `Noch ${formatMinutes(goalProgress.remaining, true)} bis zu deinem Ziel.`
                        : `Noch ${goalProgress.remaining} ${goalProgress.remaining === 1 ? 'Session' : 'Sessions'} bis zu deinem Ziel.`
                    : data.activeTimer.goalId
                      ? 'Diese Session bleibt diesem Ziel eindeutig zugeordnet und zählt nach dem Speichern.'
                      : 'Diese Session zählt als freie Lernzeit zu deinem persönlichen Fortschritt.'}
                </Text>
                {data.activeTimer.plannedDurationMinutes ? (
                  <Text style={[styles.motivationMeta, { color: foregroundMuted }]}>Geplant: {formatMinutes(data.activeTimer.plannedDurationMinutes, true)}</Text>
                ) : null}
                {data.activeTimer.note ? (
                  <Text numberOfLines={2} style={[styles.motivationMeta, { color: foregroundMuted }]}>Notiz: {data.activeTimer.note}</Text>
                ) : null}
              </View>

              {confirmingEnd ? (
                <View accessibilityLiveRegion="polite" style={[styles.confirmationCard, { backgroundColor: theme.colors.focusSurfaceStrong, borderColor: theme.colors.focusBorderStrong }]}>
                  <View style={styles.confirmationCopy}>
                    <Text accessibilityRole="header" style={[styles.confirmationTitle, { color: foreground }]}>
                      {isShort ? 'Kurze Session beenden?' : 'Session beenden?'}
                    </Text>
                    <Text style={[styles.confirmationText, { color: foregroundMuted }]}>
                      {isShort
                        ? 'Die Session ist kürzer als eine Minute. Du kannst sie bewusst speichern oder ohne Eintrag verwerfen.'
                        : `${formatMinutes(elapsedSeconds / 60, true)} werden als automatisch gemessene Lernzeit gespeichert.`}
                    </Text>
                  </View>
                  <AppButton
                    fullWidth
                    label={isShort ? 'Kurze Session speichern' : 'Beenden & speichern'}
                    onPress={() => saveSession(isShort)}
                    size="large"
                    style={[styles.lightButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
                    textStyle={{ color: theme.colors.onPrimary }}
                  />
                  {isShort ? <AppButton fullWidth label="Ohne Eintrag verwerfen" onPress={discardAndClose} variant="danger" /> : null}
                  <AppButton fullWidth label="Weiterlernen" onPress={() => setConfirmingEnd(false)} variant="ghost" textStyle={{ color: foreground }} />
                </View>
              ) : (
                <View style={styles.timerActions}>
                  <AppButton
                    fullWidth
                    label={data.activeTimer.status === 'running' ? 'Pause' : 'Fortsetzen'}
                    onPress={data.activeTimer.status === 'running' ? pauseTimer : resumeTimer}
                    size="large"
                    style={[styles.lightButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
                    textStyle={{ color: theme.colors.onPrimary }}
                  />
                  <AppButton
                    fullWidth
                    label="Session beenden"
                    onPress={() => setConfirmingEnd(true)}
                    style={[styles.endButton, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorderStrong }]}
                    textStyle={{ color: foreground }}
                    variant="outline"
                  />
                </View>
              )}

              <Text style={[styles.backgroundHint, { color: foregroundMuted }]}>
                Die Zeit wird aus Zeitstempeln berechnet und läuft im Hintergrund zuverlässig weiter.
              </Text>
            </>
          )}
        </View>
      ) : (
        <View style={[styles.setupContent, { maxWidth: isTablet ? 760 : 560 }]}>
          <View style={styles.setupCopy}>
            <Text accessibilityRole="header" style={[styles.setupTitle, isTablet ? styles.setupTitleTablet : undefined, { color: foreground }]}>
              {requestedGoalSubjectId ? 'Bereit für dein Lernziel?' : 'Woran möchtest du jetzt arbeiten?'}
            </Text>
            <Text style={[styles.setupDescription, { color: foregroundMuted }]}>
              {requestedGoalSubjectId
                ? 'Ziel und Fach werden fest mit dieser Session verbunden. Pausen zählen nicht zur Lernzeit.'
                : 'Wähle ein Fach und starte ohne Umwege. Pausen zählen nicht zur Lernzeit.'}
            </Text>
          </View>

          {requestedGoalSubjectId && requestedGoal ? (
            <View style={[styles.goalBindingCard, { backgroundColor: theme.colors.focusSurfaceStrong, borderColor: theme.colors.focusAccent }]}>
              <Text style={[styles.goalBindingEyebrow, { color: theme.colors.focusAccent }]}>AUSGEWÄHLTES LERNZIEL</Text>
              <Text style={[styles.goalBindingTitle, { color: foreground }]}>{getGoalTitle(requestedGoal, data.subjects)}</Text>
              <Text style={[styles.goalBindingMeta, { color: foregroundMuted }]}>
                {availableSubjects.find((subject) => subject.id === requestedGoalSubjectId)?.name} · Wird exakt diesem Ziel angerechnet
              </Text>
            </View>
          ) : requestedGoalId ? (
            <View accessibilityLiveRegion="polite" style={[styles.goalBindingCard, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorderStrong }]}>
              <Text style={[styles.goalBindingTitle, { color: foreground }]}>Ziel nicht verfügbar</Text>
              <Text style={[styles.goalBindingMeta, { color: foregroundMuted }]}>Das Ziel ist nicht mehr aktiv oder besitzt keine eindeutige Fachzuordnung. Du kannst stattdessen eine freie Session starten.</Text>
            </View>
          ) : null}

          {requestedGoalSubjectId ? (
            <View style={[styles.lockedSubjectCard, { backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorder }]}>
              <Text style={[styles.goalBindingEyebrow, { color: foregroundMuted }]}>FACH DURCH ZIEL FESTGELEGT</Text>
              <View style={styles.lockedSubjectRow}>
                <View style={[styles.subjectDot, { backgroundColor: activeSubject?.color ?? theme.colors.primary }]} />
                <Text style={[theme.typography.subheading, { color: foreground }]}>{activeSubject?.name}</Text>
              </View>
            </View>
          ) : (
            <SubjectSelector
              dark
              onCreateSubject={addSubject}
              onSelectSubject={(subject) => { setSelectedSubjectId(subject.id); setStartError(null); }}
              selectedSubjectId={selectedSubjectId}
              subjects={data.subjects}
            />
          )}

          <View style={styles.sessionDetails}>
            <View style={styles.sessionDetailField}>
              <Text style={[styles.detailLabel, { color: foregroundMuted }]}>GEPLANTE DAUER · OPTIONAL</Text>
              <View style={[styles.detailInputShell, { backgroundColor: theme.colors.focusSurface, borderColor: plannedDurationIsValid ? theme.colors.focusBorderStrong : theme.colors.danger }]}>
                <TextInput
                  accessibilityLabel="Geplante Dauer in Minuten"
                  keyboardType="number-pad"
                  maxLength={3}
                  onChangeText={(value) => { setPlannedDuration(value); setStartError(null); }}
                  placeholder="z. B. 45"
                  placeholderTextColor={foregroundMuted}
                  style={[styles.detailInput, theme.typography.body, { color: foreground }]}
                  value={plannedDuration}
                />
                <Text style={[theme.typography.label, { color: foregroundMuted }]}>Minuten</Text>
              </View>
            </View>
            <View style={styles.sessionDetailField}>
              <Text style={[styles.detailLabel, { color: foregroundMuted }]}>NOTIZ · OPTIONAL</Text>
              <TextInput
                accessibilityLabel="Notiz zur Lern-Session"
                maxLength={180}
                multiline
                onChangeText={setNote}
                placeholder="Was möchtest du schaffen?"
                placeholderTextColor={foregroundMuted}
                style={[styles.noteInput, theme.typography.body, { color: foreground, backgroundColor: theme.colors.focusSurface, borderColor: theme.colors.focusBorderStrong }]}
                textAlignVertical="top"
                value={note}
              />
            </View>
          </View>

          <View style={styles.setupFooter}>
            {startError ? <Text accessibilityRole="alert" style={[styles.startError, { color: theme.colors.danger }]}>{startError}</Text> : null}
            <AppButton
              disabled={!effectiveSelectedSubjectId || !plannedDurationIsValid}
              fullWidth
              label={requestedGoalSubjectId ? 'Ziel-Session starten' : 'Session starten'}
              onPress={beginSession}
              size="large"
              style={[styles.lightButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
              textStyle={{ color: theme.colors.onPrimary }}
            />
            <Text style={[styles.setupHint, { color: foregroundMuted }]}>Du kannst jederzeit pausieren oder die App verlassen.</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, gap: 20 },
  header: { width: '100%', minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  closeText: { fontSize: 32, lineHeight: 34, fontWeight: '300' },
  headerLabel: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 18 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  headerLabelText: { fontSize: 11, lineHeight: 16, letterSpacing: 1.3, fontWeight: '800' },
  headerSpacer: { width: 48 },
  timerContent: { width: '100%', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 12 },
  subjectPill: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderRadius: 20 },
  subjectDot: { width: 9, height: 9, borderRadius: 5 },
  subjectPillText: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  timerRing: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 2 },
  timerRingInner: { width: '88%', height: '88%', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1 },
  timerText: { fontSize: 49, lineHeight: 58, fontWeight: '600', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  timerTextTablet: { fontSize: 60, lineHeight: 70 },
  timerState: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  motivationCard: { width: '100%', gap: 5, padding: 18, borderRadius: 14, borderWidth: 1 },
  motivationEyebrow: { fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1 },
  motivationText: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  motivationMeta: { fontSize: 12, lineHeight: 18 },
  timerActions: { width: '100%', gap: 10 },
  confirmationCard: { width: '100%', gap: 10, padding: 18, borderRadius: 14, borderWidth: 1 },
  confirmationCopy: { gap: 4, paddingBottom: 6 },
  confirmationTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  confirmationText: { fontSize: 14, lineHeight: 20 },
  noticeCard: { width: '100%', gap: 12, padding: 20, borderRadius: 14, borderWidth: 1 },
  noticeTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  noticeText: { fontSize: 15, lineHeight: 22 },
  lightButton: {},
  endButton: {},
  backgroundHint: { maxWidth: 440, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  setupContent: { width: '100%', flex: 1, justifyContent: 'space-between', gap: 38, paddingTop: 32, paddingBottom: 8 },
  setupCopy: { gap: 14 },
  setupTitle: { maxWidth: 520, fontSize: 38, lineHeight: 44, fontWeight: '700', letterSpacing: -0.8 },
  setupTitleTablet: { fontSize: 50, lineHeight: 56 },
  setupDescription: { maxWidth: 520, fontSize: 17, lineHeight: 25 },
  goalBindingCard: { width: '100%', gap: 5, padding: 18, borderRadius: 14, borderWidth: 1 },
  goalBindingEyebrow: { fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1 },
  goalBindingTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700' },
  goalBindingMeta: { fontSize: 13, lineHeight: 19 },
  lockedSubjectCard: { width: '100%', gap: 9, padding: 18, borderRadius: 14, borderWidth: 1 },
  lockedSubjectRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sessionDetails: { width: '100%', gap: 18 },
  sessionDetailField: { width: '100%', gap: 7 },
  detailLabel: { fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1 },
  detailInputShell: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10 },
  detailInput: { minHeight: 52, flex: 1, fontVariant: ['tabular-nums'] },
  noteInput: { minHeight: 88, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderRadius: 10 },
  setupFooter: { gap: 12 },
  startError: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  setupHint: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});
