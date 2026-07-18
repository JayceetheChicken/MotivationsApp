import { Dimensions } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import CreateGoalScreen from '@/app/create-goal';
import { useStudyStore } from '@/state/study-store';
import type { StudyData, StudyGoal } from '@/types/study';

const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockReplace = jest.fn();
const mockSearchParams = jest.fn((): { goalId?: string } => ({}));

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockSearchParams(),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseStudyStore = jest.mocked(useStudyStore);
const createGoal = jest.fn();
const updateGoal = jest.fn();

const subject = {
  id: 'math',
  name: 'Mathematik',
  color: '#B44D2B',
  icon: 'book',
} as const;

function makeData(goals: readonly StudyGoal[] = []): StudyData {
  return {
    currentUser: null,
    subjects: [subject],
    sessions: [],
    grades: [],
    goals,
    friends: [],
    challenges: [],
    activeTimer: null,
  };
}

function setViewport(width: number, height: number) {
  const dimensions = { width, height, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

function setStore(data: StudyData) {
  mockedUseStudyStore.mockReturnValue({
    data,
    addSubject: jest.fn(),
    createGoal,
    updateGoal,
  } as unknown as ReturnType<typeof useStudyStore>);
}

describe('CreateGoalScreen without date inputs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.mockReturnValue({});
    setStore(makeData());
  });

  it.each([
    ['smartphone', 390, 844],
    ['tablet', 820, 1180],
  ])('renders the complete date-free form on %s', async (_device, width, height) => {
    setViewport(width, height);
    const rendered = await render(<CreateGoalScreen />);

    expect(rendered.getByLabelText('Zieltitel')).toBeTruthy();
    expect(rendered.getByLabelText('Zieltyp')).toBeTruthy();
    expect(rendered.getByText('Zeitraum')).toBeTruthy();
    expect(rendered.getByLabelText('Fach suchen oder eigenes Fach eingeben')).toBeTruthy();
    expect(rendered.getByLabelText('Zielwert in Minuten')).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Ziel erstellen' })).toBeTruthy();
    expect(rendered.queryByText('Optionaler Start und Abschluss')).toBeNull();
    expect(rendered.queryByText('Startdatum')).toBeNull();
    expect(rendered.queryByText('Enddatum')).toBeNull();
    expect(rendered.queryByPlaceholderText('JJJJ-MM-TT')).toBeNull();
    expect(rendered.queryByText('Eigener Zeitraum')).toBeNull();

    await rendered.unmount();
  });

  it('keeps legacy custom boundaries untouched when editing and saving', async () => {
    const legacyGoal: StudyGoal = {
      id: 'goal-custom',
      userId: 'local-user',
      title: 'Altes Prüfungsziel',
      type: 'duration',
      targetMinutes: 120,
      period: 'custom',
      sourcePolicy: 'all',
      subjectId: subject.id,
      subjectIds: [subject.id],
      status: 'active',
      createdAt: '2026-07-01T08:00:00.000Z',
      startsAt: '2026-07-02T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.999Z',
    };
    mockSearchParams.mockReturnValue({ goalId: legacyGoal.id });
    setStore(makeData([legacyGoal]));
    setViewport(390, 844);
    const rendered = await render(<CreateGoalScreen />);

    expect(rendered.getByText('Eigener Zeitraum')).toBeTruthy();
    expect(rendered.queryByText('Startdatum')).toBeNull();
    expect(rendered.queryByText('Enddatum')).toBeNull();
    await fireEvent.press(rendered.getByRole('button', { name: 'Änderungen speichern' }));

    expect(updateGoal).toHaveBeenCalledTimes(1);
    const update = updateGoal.mock.calls[0][1];
    expect(update).not.toHaveProperty('startsAt');
    expect(update).not.toHaveProperty('endsAt');
    expect(update).toMatchObject({ period: 'custom' });

    await rendered.unmount();
  });

  it('creates a goal without passing date fields to the store', async () => {
    setViewport(390, 844);
    const rendered = await render(<CreateGoalScreen />);

    await fireEvent.changeText(rendered.getByLabelText('Zieltitel'), 'Mathe-Routine');
    await fireEvent.press(rendered.getByLabelText('Fach Mathematik'));
    await fireEvent.changeText(rendered.getByLabelText('Zielwert in Minuten'), '90');
    await fireEvent.press(rendered.getByRole('button', { name: 'Ziel erstellen' }));

    expect(createGoal).toHaveBeenCalledTimes(1);
    const input = createGoal.mock.calls[0][0];
    expect(input).not.toHaveProperty('startsAt');
    expect(input).not.toHaveProperty('endsAt');
    expect(input).toMatchObject({
      title: 'Mathe-Routine',
      subjectId: subject.id,
      target: 90,
      period: 'week',
    });

    await rendered.unmount();
  });
});
