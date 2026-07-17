import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { GradeBadge } from '@/components/grade-badge';
import { GradeDetailModal } from '@/components/grade-detail-modal';
import { GradeEntryModal } from '@/components/grade-entry-modal';
import { SegmentedControl } from '@/components/segmented-control';
import { StudyLineChart } from '@/components/study-line-chart';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { useCurrentDate } from '@/hooks/use-current-date';
import {
  buildChartSeries,
  getChartPeriodRange,
  type ChartPeriod,
} from '@/lib/chart-data';
import { formatMinutes } from '@/lib/format';
import { calculateBavarianGradeAverage, getGradeDisplayTitle } from '@/lib/grades';
import { getSubjectBreakdown } from '@/lib/stats';
import { useStudyStore, type NewGrade } from '@/state/study-store';
import { useAppTheme } from '@/theme';
import type { StudyGrade, Subject } from '@/types/study';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
  { value: 'year', label: 'Jahr' },
] as const;

const PERIOD_TITLES: Record<ChartPeriod, string> = {
  week: 'Diese Woche',
  month: 'Dieser Monat',
  year: 'Dieses Jahr',
};

interface SubjectGradeRow {
  subject: Subject;
  grades: readonly StudyGrade[];
  exams: readonly StudyGrade[];
  otherAssessments: readonly StudyGrade[];
  average: number | null;
}

function sortGrades(grades: readonly StudyGrade[]): StudyGrade[] {
  return [...grades].sort((left, right) =>
    (right.assessmentDate ?? '').localeCompare(left.assessmentDate ?? '') ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function createSubjectRows(
  subjects: readonly Subject[],
  grades: readonly StudyGrade[],
): SubjectGradeRow[] {
  const gradesBySubject = new Map<string, StudyGrade[]>();
  for (const grade of grades) {
    const current = gradesBySubject.get(grade.subjectId) ?? [];
    current.push(grade);
    gradesBySubject.set(grade.subjectId, current);
  }

  const visibleSubjects = subjects.filter(
    (subject) => !subject.archived || gradesBySubject.has(subject.id),
  );
  const knownSubjectIds = new Set(visibleSubjects.map((subject) => subject.id));
  const missingSubjects = [...gradesBySubject.entries()].flatMap(([subjectId, subjectGrades]) => {
    if (knownSubjectIds.has(subjectId)) return [];
    return [{
      id: subjectId,
      name: subjectGrades[0]?.subjectNameSnapshot ?? 'Gelöschtes Fach',
      color: '#87593C',
      icon: 'book',
      archived: true,
    } satisfies Subject];
  });

  return [...visibleSubjects, ...missingSubjects]
    .sort((left, right) => left.name.localeCompare(right.name, 'de-DE'))
    .map((subject) => {
      const subjectGrades = sortGrades(gradesBySubject.get(subject.id) ?? []);
      return {
        subject,
        grades: subjectGrades,
        exams: subjectGrades.filter((grade) => grade.assessmentType === 'exam'),
        otherAssessments: subjectGrades.filter((grade) => grade.assessmentType === 'other'),
        average: calculateBavarianGradeAverage(subjectGrades),
      };
    });
}

interface GradeListProps {
  emptyLabel?: string;
  grades: readonly StudyGrade[];
  onSelect: (grade: StudyGrade) => void;
  subjectName: string;
}

function GradeList({
  emptyLabel = '–',
  grades,
  onSelect,
  subjectName,
}: GradeListProps) {
  const theme = useAppTheme();
  if (grades.length === 0) {
    return <Text selectable style={[theme.typography.body, { color: theme.colors.textSubtle }]}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.gradeList}>
      {grades.map((grade) => {
        const title = getGradeDisplayTitle(grade);
        return (
          <Pressable
            accessibilityLabel={`${subjectName}, ${title}, ${grade.points} Punkte, Details öffnen`}
            accessibilityRole="button"
            key={grade.id}
            onPress={() => onSelect(grade)}
            style={({ pressed }) => [
              styles.gradeEntry,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
              },
              pressed ? styles.gradeEntryPressed : undefined,
            ]}>
            <Text
              numberOfLines={2}
              style={[theme.typography.bodyMedium, styles.gradeEntryTitle, { color: theme.colors.text }]}>
              {title}
            </Text>
            <GradeBadge points={grade.points} style={styles.gradeEntryPoints} />
          </Pressable>
        );
      })}
    </View>
  );
}

function WideTableRow({
  index,
  onSelect,
  row,
}: {
  index: number;
  onSelect: (grade: StudyGrade) => void;
  row: SubjectGradeRow;
}) {
  const theme = useAppTheme();
  return (
    <View
      accessibilityLabel={`Noten für ${row.subject.name}`}
      style={[
        styles.wideRow,
        index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
      ]}>
      <View style={[styles.wideCell, styles.subjectColumn]}>
        <View style={[styles.subjectDot, { backgroundColor: row.subject.color }]} />
        <Text selectable style={[theme.typography.bodyMedium, styles.subjectName, { color: theme.colors.text }]}>{row.subject.name}</Text>
      </View>
      <View style={[styles.wideCell, styles.examColumn]}>
        <GradeList grades={row.exams} onSelect={onSelect} subjectName={row.subject.name} />
      </View>
      <View style={[styles.wideCell, styles.otherColumn]}>
        <GradeList grades={row.otherAssessments} onSelect={onSelect} subjectName={row.subject.name} />
      </View>
      <View style={[styles.wideCell, styles.averageColumn]}>
        {row.average === null ? (
          <Text selectable style={[theme.typography.body, { color: theme.colors.textSubtle }]}>–</Text>
        ) : (
          <GradeBadge points={row.average} />
        )}
      </View>
    </View>
  );
}

function CompactTableRow({
  index,
  onSelect,
  row,
}: {
  index: number;
  onSelect: (grade: StudyGrade) => void;
  row: SubjectGradeRow;
}) {
  const theme = useAppTheme();
  return (
    <View
      accessibilityLabel={`Noten für ${row.subject.name}`}
      style={[
        styles.compactRow,
        index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
      ]}>
      <View style={styles.compactSubjectRow}>
        <View style={[styles.subjectDot, { backgroundColor: row.subject.color }]} />
        <Text selectable style={[theme.typography.bodyMedium, styles.subjectName, { color: theme.colors.text }]}>{row.subject.name}</Text>
        {row.average === null ? (
          <Text selectable style={[theme.typography.body, { color: theme.colors.textSubtle }]}>–</Text>
        ) : (
          <GradeBadge points={row.average} />
        )}
      </View>
      <View style={styles.compactCategory}>
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Klausuren</Text>
        <GradeList grades={row.exams} onSelect={onSelect} subjectName={row.subject.name} />
      </View>
      <View style={styles.compactCategory}>
        <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Sonstige Leistungsnachweise</Text>
        <GradeList grades={row.otherAssessments} onSelect={onSelect} subjectName={row.subject.name} />
      </View>
    </View>
  );
}

export default function StatsScreen() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const now = useCurrentDate();
  const { data, addGrade, addSubject, deleteGrade } = useStudyStore();
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const [entryVisible, setEntryVisible] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<StudyGrade | null>(null);
  const userId = data.currentUser?.id ?? 'local-user';
  const userGrades = useMemo(
    () => data.grades.filter((grade) => grade.userId === userId),
    [data.grades, userId],
  );
  const userSessions = useMemo(
    () => data.sessions.filter((session) => session.userId === userId),
    [data.sessions, userId],
  );
  const chart = useMemo(
    () => buildChartSeries(userSessions, period, now),
    [now, period, userSessions],
  );
  const periodRange = useMemo(
    () => getChartPeriodRange(period, now),
    [now, period],
  );
  const subjectBreakdown = useMemo(
    () => getSubjectBreakdown(userSessions, data.subjects, periodRange),
    [data.subjects, periodRange, userSessions],
  );
  const totalPeriodMinutes = subjectBreakdown.reduce(
    (sum, subject) => sum + subject.totalMinutes,
    0,
  );
  const rows = useMemo(
    () => createSubjectRows(data.subjects, userGrades),
    [data.subjects, userGrades],
  );
  const useCompactTable = width < theme.layout.tabletBreakpoint;
  const useStatisticColumns = width >= theme.layout.tabletBreakpoint;

  const saveGrade = (grade: NewGrade): boolean => Boolean(addGrade(grade));
  const removeGrade = (gradeId: string): boolean => {
    const deleted = deleteGrade(gradeId);
    if (deleted) setSelectedGrade(null);
    return deleted;
  };
  const selectedSubject = selectedGrade
    ? data.subjects.find((subject) => subject.id === selectedGrade.subjectId)
    : undefined;

  return (
    <>
      <Screen>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>Notenübersicht</Text>
          <AppButton
            accessibilityHint="Öffnet das Formular für eine neue Note"
            accessibilityLabel="Neue Note eintragen"
            label="+"
            onPress={() => setEntryVisible(true)}
            size="compact"
            style={styles.addButton}
            textStyle={styles.addButtonLabel}
          />
        </View>

        <AppCard padding="none" style={styles.tableCard}>
          {useCompactTable ? (
            <View style={[styles.compactHeader, { backgroundColor: theme.colors.surfaceMuted, borderBottomColor: theme.colors.divider }]}>
              <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Fach und Leistungsnachweise</Text>
              <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>Schnitt</Text>
            </View>
          ) : (
            <View style={[styles.wideHeader, { backgroundColor: theme.colors.surfaceMuted, borderBottomColor: theme.colors.divider }]}>
              <Text selectable style={[theme.typography.label, styles.subjectColumn, { color: theme.colors.textMuted }]}>Fach</Text>
              <Text selectable style={[theme.typography.label, styles.examColumn, { color: theme.colors.textMuted }]}>Klausuren</Text>
              <Text selectable style={[theme.typography.label, styles.otherColumn, { color: theme.colors.textMuted }]}>Sonstige Leistungsnachweise</Text>
              <Text selectable style={[theme.typography.label, styles.averageColumn, { color: theme.colors.textMuted }]}>Schnitt</Text>
            </View>
          )}

          {rows.length === 0 ? (
            <View style={styles.emptyTable}>
              <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Noch keine Fächer vorhanden</Text>
              <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Sobald du ein Fach für ein Lernziel oder eine Session anlegst, erscheint hier eine Tabellenzeile.</Text>
            </View>
          ) : useCompactTable ? (
            rows.map((row, index) => (
              <CompactTableRow index={index} key={row.subject.id} onSelect={setSelectedGrade} row={row} />
            ))
          ) : (
            rows.map((row, index) => (
              <WideTableRow index={index} key={row.subject.id} onSelect={setSelectedGrade} row={row} />
            ))
          )}
        </AppCard>

        <View style={styles.statisticsHeader}>
          <View style={styles.statisticsHeaderCopy}>
            <Text accessibilityRole="header" selectable style={[theme.typography.heading, { color: theme.colors.text }]}>Lernstatistik</Text>
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>Zeitraum für Lernverlauf und Fächerverteilung auswählen.</Text>
          </View>
          <SegmentedControl
            accessibilityLabel="Zeitraum für Lernverlauf und Lernzeit nach Fach"
            onChange={setPeriod}
            options={PERIOD_OPTIONS}
            style={styles.periodControl}
            value={period}
          />
        </View>

        <View style={[styles.statisticsGrid, useStatisticColumns ? styles.statisticsGridWide : undefined]}>
          <AppCard padding="lg" style={[styles.statisticsCard, useStatisticColumns ? styles.statisticsCardWide : undefined]}>
            <SectionHeader
              description={`Lernminuten · ${PERIOD_TITLES[period]}`}
              title="Lernverlauf"
            />
            <StudyLineChart
              dataPoints={chart.map((point) => point.valueMinutes)}
              detailLabels={chart.map((point) => point.dateLabel)}
              emptyMessage={`In diesem Zeitraum gibt es noch keine abgeschlossene Lern-Session.`}
              key={period}
              labels={chart.map((point) => point.label)}
            />
          </AppCard>

          <AppCard padding="lg" style={[styles.statisticsCard, useStatisticColumns ? styles.statisticsCardWide : undefined]}>
            <SectionHeader
              description={`Anteil an ${formatMinutes(totalPeriodMinutes, true)} · ${PERIOD_TITLES[period]}`}
              title="Lernzeit nach Fach"
            />
            {subjectBreakdown.length === 0 ? (
              <EmptyState
                compact
                message="In diesem Zeitraum wurde noch keine Lernzeit erfasst."
                symbol="◫"
                title="Keine Fächerverteilung"
              />
            ) : (
              <View style={styles.subjectTimeList}>
                {subjectBreakdown.map((subject, index) => (
                  <View
                    key={subject.subjectId}
                    style={[
                      styles.subjectTimeRow,
                      index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: 1 } : undefined,
                    ]}>
                    <View style={styles.subjectTimeHeader}>
                      <View style={[styles.subjectDot, { backgroundColor: subject.subjectColor }]} />
                      <Text selectable style={[theme.typography.bodyMedium, styles.subjectName, { color: theme.colors.text }]}>{subject.subjectName}</Text>
                      <Text selectable style={[theme.typography.bodyMedium, styles.numeric, { color: theme.colors.text }]}>{formatMinutes(subject.totalMinutes, true)}</Text>
                    </View>
                    <ProgressBar
                      accessibilityLabel={`${subject.subjectName}: ${formatMinutes(subject.totalMinutes)}, ${Math.round(subject.percentage)} Prozent der Lernzeit`}
                      max={100}
                      value={subject.percentage}
                    />
                    <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{Math.round(subject.percentage)} % der Lernzeit</Text>
                  </View>
                ))}
              </View>
            )}
          </AppCard>
        </View>

      </Screen>

      {entryVisible ? (
        <GradeEntryModal
          onClose={() => setEntryVisible(false)}
          onCreateSubject={addSubject}
          onSave={saveGrade}
          sessions={data.sessions}
          subjects={data.subjects}
          userId={userId}
          visible
        />
      ) : null}
      {selectedGrade ? (
        <GradeDetailModal
          grade={selectedGrade}
          onClose={() => setSelectedGrade(null)}
          onDelete={removeGrade}
          sessions={data.sessions}
          subject={selectedSubject}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  statisticsHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  statisticsHeaderCopy: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  periodControl: {
    width: '100%',
    maxWidth: 430,
  },
  statisticsGrid: {
    width: '100%',
    gap: 20,
  },
  statisticsGridWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statisticsCard: {
    width: '100%',
    minWidth: 0,
    gap: 20,
  },
  statisticsCardWide: {
    flex: 1,
  },
  subjectTimeList: {
    width: '100%',
  },
  subjectTimeRow: {
    gap: 10,
    paddingVertical: 14,
  },
  subjectTimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleRow: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  addButton: {
    width: 52,
    paddingHorizontal: 0,
  },
  addButtonLabel: {
    fontSize: 26,
    lineHeight: 28,
  },
  tableCard: {
    width: '100%',
    overflow: 'hidden',
  },
  wideHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  wideRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  wideCell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  subjectColumn: {
    minWidth: 0,
    flex: 1.05,
  },
  examColumn: {
    minWidth: 0,
    flex: 1.2,
  },
  otherColumn: {
    minWidth: 0,
    flex: 1.55,
  },
  averageColumn: {
    minWidth: 82,
    flex: 0.6,
    justifyContent: 'flex-end',
  },
  compactHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  compactRow: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  compactSubjectRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compactCategory: {
    gap: 8,
  },
  subjectDot: {
    width: 10,
    height: 10,
    flexShrink: 0,
    borderRadius: 5,
  },
  subjectName: {
    minWidth: 0,
    flex: 1,
  },
  gradeList: {
    width: '100%',
    minWidth: 0,
    gap: 7,
  },
  gradeEntry: {
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  gradeEntryTitle: {
    minWidth: 0,
    flex: 1,
  },
  gradeEntryPoints: {
    minHeight: 46,
  },
  gradeEntryPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  emptyTable: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
});
