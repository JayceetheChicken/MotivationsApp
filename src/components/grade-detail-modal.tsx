import { StyleSheet, Text, View } from 'react-native';

import { GradeBadge } from '@/components/grade-badge';
import { GradeModalShell } from '@/components/grade-modal-shell';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { SourceBadge } from '@/components/ui/source-badge';
import { formatMinutes } from '@/lib/format';
import {
  calculateGradeStudyMinutes,
  getGradeDisplayTitle,
  parseLocalGradeDate,
} from '@/lib/grades';
import { useAppTheme } from '@/theme';
import type { StudyGrade, StudySession, Subject } from '@/types/study';

interface GradeDetailModalProps {
  grade: StudyGrade | null;
  onClose: () => void;
  onDelete: (gradeId: string) => boolean;
  sessions: readonly StudySession[];
  subject?: Subject;
}

function formatAssessmentDate(value?: string): string {
  if (!value) return 'Kein Datum';
  const date = parseLocalGradeDate(value);
  return date
    ? new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(date)
    : value;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
    : 'Datum unbekannt';
}

export function GradeDetailModal({
  grade,
  onClose,
  onDelete,
  sessions,
  subject,
}: GradeDetailModalProps) {
  const theme = useAppTheme();
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const linkedSessions = grade
    ? grade.sessionIds.flatMap((sessionId) => {
        const session = sessionById.get(sessionId);
        return session ? [session] : [];
      })
    : [];
  const subjectName = subject?.name ?? grade?.subjectNameSnapshot ?? 'Gelöschtes Fach';
  const totalStudyMinutes = grade ? calculateGradeStudyMinutes(grade, sessions) : 0;
  const deleteGrade = () => {
    if (!grade || !onDelete(grade.id)) return;
    onClose();
  };

  return (
    <GradeModalShell onClose={onClose} title="Notendetails" visible={grade !== null}>
      {grade ? (
        <>
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{subjectName}</Text>
              <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>{getGradeDisplayTitle(grade)}</Text>
            </View>
            <GradeBadge points={grade.points} size="large" />
          </View>

          <AppCard padding="lg" variant="subtle" style={styles.summaryCard}>
            <View style={styles.metaRow}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Datum</Text>
              <Text selectable style={[theme.typography.bodyMedium, styles.metaValue, { color: theme.colors.text }]}>{formatAssessmentDate(grade.assessmentDate)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Leistungsart</Text>
              <Text selectable style={[theme.typography.bodyMedium, styles.metaValue, { color: theme.colors.text }]}>{grade.assessmentType === 'exam' ? 'Klausur' : 'Sonstiger Leistungsnachweis'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Gesamte Lernzeit</Text>
              <Text selectable style={[theme.typography.bodyMedium, styles.numeric, styles.metaValue, { color: theme.colors.primaryText }]}>{formatMinutes(totalStudyMinutes, true)}</Text>
            </View>
          </AppCard>

          <View style={styles.sessionSection}>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" selectable style={[theme.typography.subheading, { color: theme.colors.text }]}>Zugeordnete Lern-Sessions</Text>
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{linkedSessions.length}</Text>
            </View>
            {linkedSessions.length === 0 ? (
              <AppCard variant="subtle" style={styles.emptySessions}>
                <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Keine Session zugeordnet</Text>
                <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Zusätzlich erfasste Lernzeit: {formatMinutes(grade.additionalStudyMinutes, true)}</Text>
              </AppCard>
            ) : (
              <AppCard padding="sm" variant="outlined" style={styles.sessionList}>
                {linkedSessions.map((session, index) => (
                  <View
                    key={session.id}
                    style={[
                      styles.sessionRow,
                      index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
                    ]}>
                    <View style={styles.sessionCopy}>
                      <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{session.note?.trim() || 'Lern-Session'}</Text>
                      <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{formatSessionDate(session.startedAt)}</Text>
                    </View>
                    <View style={styles.sessionValue}>
                      <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(session.durationMinutes, true)}</Text>
                      <SourceBadge compact source={session.source} />
                    </View>
                  </View>
                ))}
              </AppCard>
            )}
            {grade.additionalStudyMinutes > 0 ? (
              <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Zusätzlich ohne Session erfasst: {formatMinutes(grade.additionalStudyMinutes, true)}</Text>
            ) : null}
          </View>

          <View style={[styles.deleteSection, { borderTopColor: theme.colors.divider }]}>
            <AppButton fullWidth label="Note löschen" onPress={deleteGrade} variant="danger" />
          </View>
        </>
      ) : null}
    </GradeModalShell>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 18,
  },
  heroCopy: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  summaryCard: {
    gap: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  metaValue: {
    minWidth: 0,
    flex: 1,
    textAlign: 'right',
  },
  sessionSection: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  emptySessions: {
    gap: 4,
  },
  sessionList: {
    gap: 0,
  },
  sessionRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  sessionCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  sessionValue: {
    alignItems: 'flex-end',
    gap: 4,
  },
  deleteSection: {
    gap: 10,
    paddingTop: 18,
    borderTopWidth: 1,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
