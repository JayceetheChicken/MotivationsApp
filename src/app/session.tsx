import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubjectChip } from '@/components/subject-chip';
import { AppButton } from '@/components/ui/app-button';
import { useTimerElapsed } from '@/hooks/use-timer-elapsed';
import { formatClock, formatMinutes } from '@/lib/format';
import { getWeekStats } from '@/lib/stats';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

export default function SessionScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data, startTimer, pauseTimer, resumeTimer, finishTimer } = useStudyStore();
  const [selectedSubjectId, setSelectedSubjectId] = useState(
    () => data.activeTimer?.subjectId ?? data.subjects[0]?.id ?? '',
  );
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const elapsedSeconds = useTimerElapsed(data.activeTimer);
  const activeSubject = data.subjects.find(
    (subject) => subject.id === (data.activeTimer?.subjectId ?? selectedSubjectId),
  );
  const weeklyStats = useMemo(() => getWeekStats(data.sessions), [data.sessions]);
  const weeklyGoal = data.goals.find(
    (goal) => goal.status === 'active' && goal.type === 'duration' && goal.period === 'week',
  );
  const remainingMinutes = weeklyGoal?.type === 'duration'
    ? Math.max(0, weeklyGoal.targetMinutes - weeklyStats.totalMinutes)
    : 0;
  const brandBackground = theme.isDark ? '#0A2117' : '#163D2C';
  const isTablet = width >= 760;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const completeSession = () => {
    finishTimer();
    close();
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          backgroundColor: brandBackground,
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: brandBackground }}>
      <View style={[styles.header, { maxWidth: isTablet ? 820 : undefined }]}>
        <Pressable
          accessibilityLabel="Session-Ansicht schließen"
          accessibilityRole="button"
          onPress={close}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.pressed : undefined,
          ]}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <View style={styles.headerLabel}>
          <View style={styles.liveDot} />
          <Text style={styles.headerLabelText}>
            {data.activeTimer ? 'FOKUSZEIT' : 'NEUE SESSION'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {data.activeTimer ? (
        <View style={[styles.timerContent, { maxWidth: isTablet ? 720 : 520 }]}>
          <View style={styles.subjectPill}>
            <View style={[styles.subjectDot, { backgroundColor: activeSubject?.color ?? '#A8D5BA' }]} />
            <Text style={styles.subjectPillText}>{activeSubject?.name ?? 'Lern-Session'}</Text>
          </View>

          <View
            accessible
            accessibilityLabel={`Verstrichene Lernzeit ${formatMinutes(elapsedSeconds / 60)}`}
            style={[
              styles.timerRing,
              { width: isTablet ? 330 : 274, height: isTablet ? 330 : 274 },
            ]}>
            <View style={styles.timerRingInner}>
              <Text selectable style={[styles.timerText, isTablet ? styles.timerTextTablet : undefined]}>
                {formatClock(elapsedSeconds)}
              </Text>
              <Text style={styles.timerState}>
                {data.activeTimer.status === 'running' ? 'Du bist im Flow' : 'Session pausiert'}
              </Text>
            </View>
          </View>

          <View style={styles.motivationCard}>
            <Text style={styles.motivationEyebrow}>DEIN WOCHENZIEL</Text>
            <Text style={styles.motivationText}>
              {remainingMinutes > 0
                ? `Noch ${formatMinutes(remainingMinutes, true)} – jede Minute bringt dich näher.`
                : 'Wochenziel erreicht. Alles, was jetzt kommt, ist ein Bonus.'}
            </Text>
          </View>

          {confirmingEnd ? (
            <View accessibilityLiveRegion="polite" style={styles.confirmationCard}>
              <View style={styles.confirmationCopy}>
                <Text accessibilityRole="header" style={styles.confirmationTitle}>Session beenden?</Text>
                <Text style={styles.confirmationText}>
                  {formatMinutes(elapsedSeconds / 60, true)} werden als mit Timer gemessene Lernzeit gespeichert.
                </Text>
              </View>
              <AppButton
                fullWidth
                label="Beenden & speichern"
                onPress={completeSession}
                size="large"
                style={styles.lightButton}
                textStyle={{ color: '#163D2C' }}
              />
              <AppButton
                fullWidth
                label="Weiterlernen"
                onPress={() => setConfirmingEnd(false)}
                variant="ghost"
                textStyle={{ color: '#FFFFFF' }}
              />
            </View>
          ) : (
            <View style={styles.timerActions}>
              <AppButton
                fullWidth
                label={data.activeTimer.status === 'running' ? 'Pause' : 'Fortsetzen'}
                onPress={data.activeTimer.status === 'running' ? pauseTimer : resumeTimer}
                size="large"
                style={styles.lightButton}
                textStyle={{ color: '#163D2C' }}
              />
              <AppButton
                fullWidth
                label="Session beenden"
                onPress={() => setConfirmingEnd(true)}
                size="default"
                variant="outline"
                style={styles.endButton}
                textStyle={{ color: '#FFFFFF' }}
              />
            </View>
          )}

          <Text style={styles.backgroundHint}>
            Die Zeit wird aus sicheren Zeitstempeln berechnet und läuft auch im Hintergrund weiter.
          </Text>
        </View>
      ) : (
        <View style={[styles.setupContent, { maxWidth: isTablet ? 760 : 560 }]}>
          <View style={styles.setupCopy}>
            <Text accessibilityRole="header" style={[styles.setupTitle, isTablet ? styles.setupTitleTablet : undefined]}>
              Woran möchtest du jetzt arbeiten?
            </Text>
            <Text style={styles.setupDescription}>
              Wähle ein Fach und starte ohne Umwege. Pausen zählen selbstverständlich nicht zur Lernzeit.
            </Text>
          </View>

          <View accessibilityRole="radiogroup" style={styles.subjectGrid}>
            {data.subjects.filter((subject) => !subject.archived).map((subject) => (
              <SubjectChip
                dark
                key={subject.id}
                onPress={() => setSelectedSubjectId(subject.id)}
                selected={selectedSubjectId === subject.id}
                subject={subject}
              />
            ))}
          </View>

          <View style={styles.setupFooter}>
            <AppButton
              disabled={!selectedSubjectId}
              fullWidth
              label="Session starten"
              onPress={() => startTimer(selectedSubjectId)}
              size="large"
              style={styles.lightButton}
              textStyle={{ color: '#163D2C' }}
            />
            <Text style={styles.setupHint}>Du kannst jederzeit pausieren oder die App verlassen.</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  closeText: {
    color: '#FFFFFF',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
  },
  headerLabel: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#A8E6C1',
  },
  headerLabelText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.3,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 48,
  },
  timerContent: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 12,
  },
  subjectPill: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  subjectDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  subjectPillText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  timerRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(168,230,193,0.75)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    boxShadow: '0 20px 70px rgba(0,0,0,0.20)',
  },
  timerRingInner: {
    width: '88%',
    height: '88%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 49,
    lineHeight: 58,
    fontWeight: '600',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  timerTextTablet: {
    fontSize: 60,
    lineHeight: 70,
  },
  timerState: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  motivationCard: {
    width: '100%',
    gap: 5,
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  motivationEyebrow: {
    color: '#A8E6C1',
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  motivationText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  timerActions: {
    width: '100%',
    gap: 10,
  },
  confirmationCard: {
    width: '100%',
    gap: 10,
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  confirmationCopy: {
    gap: 4,
    paddingBottom: 6,
  },
  confirmationTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
  },
  confirmationText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    lineHeight: 20,
  },
  lightButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  endButton: {
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  backgroundHint: {
    maxWidth: 440,
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  setupContent: {
    width: '100%',
    flex: 1,
    justifyContent: 'space-between',
    gap: 38,
    paddingTop: 32,
    paddingBottom: 8,
  },
  setupCopy: {
    gap: 14,
  },
  setupTitle: {
    maxWidth: 520,
    color: '#FFFFFF',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  setupTitleTablet: {
    fontSize: 50,
    lineHeight: 56,
  },
  setupDescription: {
    maxWidth: 520,
    color: 'rgba(255,255,255,0.66)',
    fontSize: 17,
    lineHeight: 25,
  },
  subjectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  setupFooter: {
    gap: 12,
  },
  setupHint: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
});
