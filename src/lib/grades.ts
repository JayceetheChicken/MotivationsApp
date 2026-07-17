import type { StudyGrade, StudySession } from '@/types/study';

export type GradePerformanceBand = 'low' | 'medium' | 'high';

export function getGradeDisplayTitle(
  grade: Pick<StudyGrade, 'assessmentType' | 'title'>,
): string {
  return grade.title?.trim() ||
    (grade.assessmentType === 'exam' ? 'Klausur' : 'Sonstiger Leistungsnachweis');
}

export function parseLocalGradeDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

export function isValidGradeDate(value: string): boolean {
  return parseLocalGradeDate(value) !== null;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

/**
 * Standard calculation from § 29(2) GSO: the mean of the exam block and the
 * mean of the other assessments are weighted 1:1. If one block is empty, the
 * available block remains the running average. Special rules for advanced
 * Art/Music and Sport require more categories and are intentionally excluded.
 */
export function calculateBavarianGradeAverage(
  grades: readonly Pick<StudyGrade, 'assessmentType' | 'points'>[],
): number | null {
  const examAverage = mean(
    grades.filter((grade) => grade.assessmentType === 'exam').map((grade) => grade.points),
  );
  const otherAverage = mean(
    grades.filter((grade) => grade.assessmentType === 'other').map((grade) => grade.points),
  );

  if (examAverage === null) return otherAverage;
  if (otherAverage === null) return examAverage;
  return (examAverage + otherAverage) / 2;
}

export function getGradePerformanceBand(points: number): GradePerformanceBand {
  if (points < 5) return 'low';
  if (points < 10) return 'medium';
  return 'high';
}

export function calculateGradeStudyMinutes(
  grade: Pick<StudyGrade, 'additionalStudyMinutes' | 'sessionIds' | 'subjectId' | 'userId'>,
  sessions: readonly StudySession[],
): number {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const seenIds = new Set<string>();
  const linkedMinutes = grade.sessionIds.reduce((sum, sessionId) => {
    if (seenIds.has(sessionId)) return sum;
    seenIds.add(sessionId);
    const session = sessionById.get(sessionId);
    if (
      !session ||
      session.userId !== grade.userId ||
      session.subjectId !== grade.subjectId ||
      (session.status && session.status !== 'completed') ||
      !Number.isFinite(session.durationMinutes) ||
      session.durationMinutes < 0
    ) {
      return sum;
    }
    return sum + session.durationMinutes;
  }, 0);

  const additionalMinutes = Number.isFinite(grade.additionalStudyMinutes)
    ? Math.max(0, grade.additionalStudyMinutes)
    : 0;
  return linkedMinutes + additionalMinutes;
}
