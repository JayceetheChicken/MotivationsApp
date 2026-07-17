import {
  calculateBavarianGradeAverage,
  calculateGradeStudyMinutes,
  getGradeDisplayTitle,
  getGradePerformanceBand,
  isValidGradeDate,
  parseLocalGradeDate,
} from '@/lib/grades';
import type { StudyGrade, StudySession } from '@/types/study';

function grade(
  assessmentType: StudyGrade['assessmentType'],
  points: number,
): Pick<StudyGrade, 'assessmentType' | 'points'> {
  return { assessmentType, points };
}

function session(
  id: string,
  overrides: Partial<StudySession> = {},
): StudySession {
  return {
    id,
    userId: 'user-current',
    goalId: null,
    subjectId: 'subject-math',
    source: 'timer',
    status: 'completed',
    startedAt: '2026-07-10T08:00:00.000Z',
    endedAt: '2026-07-10T09:00:00.000Z',
    createdAt: '2026-07-10T09:00:00.000Z',
    durationMinutes: 60,
    segments: [{
      startedAt: '2026-07-10T08:00:00.000Z',
      endedAt: '2026-07-10T09:00:00.000Z',
    }],
    ...overrides,
  } as StudySession;
}

describe('Bavarian upper-school grade calculation', () => {
  it('weights the exam block and other-assessment block equally', () => {
    expect(calculateBavarianGradeAverage([
      grade('exam', 15),
      grade('exam', 15),
      grade('other', 3),
      grade('other', 3),
      grade('other', 3),
    ])).toBe(9);
  });

  it('matches the requested 9.3-point example before display rounding', () => {
    expect(calculateBavarianGradeAverage([
      grade('exam', 9),
      grade('other', 11),
      grade('other', 8),
    ])).toBe(9.25);
  });

  it('uses the available block when the other one is empty', () => {
    expect(calculateBavarianGradeAverage([grade('other', 11), grade('other', 7)])).toBe(9);
    expect(calculateBavarianGradeAverage([])).toBeNull();
  });

  it.each([
    [0, 'low'],
    [4, 'low'],
    [5, 'medium'],
    [9, 'medium'],
    [10, 'high'],
    [15, 'high'],
  ] as const)('maps %i points to the %s band', (points, band) => {
    expect(getGradePerformanceBand(points)).toBe(band);
  });
});

describe('grade learning-time and date helpers', () => {
  it('uses an optional custom title and falls back to the assessment type', () => {
    expect(getGradeDisplayTitle({ assessmentType: 'exam', title: '  Analysis  ' })).toBe('Analysis');
    expect(getGradeDisplayTitle({ assessmentType: 'exam' })).toBe('Klausur');
    expect(getGradeDisplayTitle({ assessmentType: 'other', title: '   ' }))
      .toBe('Sonstiger Leistungsnachweis');
  });

  it('adds extra minutes and unique matching sessions only', () => {
    expect(calculateGradeStudyMinutes({
      userId: 'user-current',
      subjectId: 'subject-math',
      additionalStudyMinutes: 30,
      sessionIds: ['matching', 'matching', 'foreign', 'wrong-subject'],
    }, [
      session('matching'),
      session('foreign', { userId: 'user-other' }),
      session('wrong-subject', { subjectId: 'subject-german' }),
    ])).toBe(90);
  });

  it('validates and parses local calendar dates without UTC conversion', () => {
    expect(isValidGradeDate('2026-07-17')).toBe(true);
    expect(parseLocalGradeDate('2026-07-17')).toEqual(new Date(2026, 6, 17));
    expect(isValidGradeDate('2026-02-30')).toBe(false);
    expect(isValidGradeDate('17.07.2026')).toBe(false);
  });
});
