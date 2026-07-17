import type { StudyData } from '@/types/study';

/** Warm retro colour rotation for user-created subjects. */
export const subjectColorPalette = [
  '#B44D2B',
  '#C3922E',
  '#747644',
  '#4F8B83',
  '#87593C',
] as const;

export const fallbackSubjectColor = subjectColorPalette[subjectColorPalette.length - 1];

/** Returns a fresh value so reducers can never mutate a shared fixture. */
export function createInitialData(): StudyData {
  return {
    currentUser: null,
    subjects: [],
    sessions: [],
    grades: [],
    goals: [],
    friends: [],
    challenges: [],
    activeTimer: null,
  };
}

export const createEmptyStudyData = createInitialData;

/** Read-only convenience snapshot for tests and non-mutating consumers. */
export const initialData: Readonly<StudyData> = createInitialData();
