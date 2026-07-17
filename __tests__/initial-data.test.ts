import { createInitialData, initialData } from '@/data/initial-data';

describe('initial study data', () => {
  it('starts completely empty and contains no demo identity or content', () => {
    expect(initialData).toEqual({
      currentUser: null,
      subjects: [],
      sessions: [],
      grades: [],
      goals: [],
      friends: [],
      challenges: [],
      activeTimer: null,
    });

    expect('streak' in initialData).toBe(false);
    expect(JSON.stringify(initialData)).not.toMatch(/Lea|Demo/i);
  });

  it('returns fresh collections so a new profile cannot inherit old data', () => {
    const first = createInitialData();
    const second = createInitialData();

    expect(first).not.toBe(second);
    expect(first.subjects).not.toBe(second.subjects);
    expect(first.sessions).not.toBe(second.sessions);
    expect(first.grades).not.toBe(second.grades);
    expect(first.goals).not.toBe(second.goals);
    expect(first.friends).not.toBe(second.friends);
    expect(first.challenges).not.toBe(second.challenges);
    expect(second).toEqual(initialData);
  });
});
