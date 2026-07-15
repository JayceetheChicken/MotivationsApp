import type { StudyData } from '@/types/study';

/** Central, restrained colour rotation for user-created subjects. */
export const subjectColorPalette = [
  '#4F6BED',
  '#3B82C4',
  '#5B5FC7',
  '#3976B8',
  '#68769C',
] as const;

export const fallbackSubjectColor = subjectColorPalette[subjectColorPalette.length - 1];

/** Returns a fresh value so reducers can never mutate a shared fixture. */
export function createInitialData(): StudyData {
  return {
    currentUser: null,
    subjects: [],
    sessions: [],
    goals: [],
    friends: [],
    challenges: [],
    activeTimer: null,
  };
}

export const createEmptyStudyData = createInitialData;

/** Read-only convenience snapshot for tests and non-mutating consumers. */
export const initialData: Readonly<StudyData> = createInitialData();
