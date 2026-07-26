import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import ManualEntryScreen from '@/app/manual-entry';
import SessionScreen from '@/app/session';
import { layout } from '@/theme';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockStartTimer = jest.fn();
const mockAddManualEntry = jest.fn();
const mockGetSharedStudySessionDetails = jest.fn();
const mockUpdateSharedStudySessionParticipant = jest.fn();
let mockSessionParams: Record<string, string | undefined> = {};

const mockStudyStore = {
  data: {
    activeTimer: null,
    currentUser: null,
    challenges: [],
    goals: [],
    sessions: [],
    subjects: [{
      id: 'subject-mathematik',
      name: 'Mathematik',
      color: '#B44D2B',
      icon: 'book',
    }],
  },
  sharedStudySessions: [],
  addManualEntry: mockAddManualEntry,
  addSubject: jest.fn(),
  discardTimer: jest.fn(),
  finishTimer: jest.fn(),
  pauseTimer: jest.fn(),
  resumeTimer: jest.fn(),
  startTimer: mockStartTimer,
  getSharedStudySessionDetails: mockGetSharedStudySessionDetails,
  updateSharedStudySessionParticipant: mockUpdateSharedStudySessionParticipant,
};

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => true,
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockSessionParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/hooks/use-current-date', () => ({
  useCurrentDate: () => new Date('2026-07-18T12:00:00.000Z'),
}));

jest.mock('@/hooks/use-timer-elapsed', () => ({
  useTimerElapsed: () => 0,
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: () => mockStudyStore,
}));

function setWindowWidth(width: number) {
  const dimensions = {
    width,
    height: width >= layout.tabletBreakpoint ? 1366 : 844,
    scale: 1,
    fontScale: 1,
  };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

function ancestorStyle(
  instance: TestInstance,
  predicate: (style: Record<string, unknown>) => boolean,
) {
  let current = instance.parent;
  while (current) {
    const style = StyleSheet.flatten(current.props.style) as Record<string, unknown> | undefined;
    if (style && predicate(style)) return style;
    current = current.parent;
  }
  throw new Error('Expected ancestor style was not found');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionParams = {};
  (mockStudyStore.data as typeof mockStudyStore.data & { currentUser: null }).currentUser = null;
  mockStudyStore.sharedStudySessions = [];
  mockGetSharedStudySessionDetails.mockResolvedValue(null);
  mockUpdateSharedStudySessionParticipant.mockResolvedValue(null);
  mockStartTimer.mockReturnValue({ id: 'timer-new' });
  mockAddManualEntry.mockReturnValue({ id: 'manual-new' });
});

it('starts no private timer for a forged or expired shared-session link', async () => {
  mockSessionParams = { sharedSessionId: 'shared-session-forged' };
  const rendered = await render(<SessionScreen />);

  await fireEvent.press(rendered.getByRole('button', { name: 'Gemeinsame Session starten' }));

  await waitFor(() => {
    expect(mockGetSharedStudySessionDetails).toHaveBeenCalledWith('shared-session-forged');
    expect(rendered.getByText('Diese gemeinsame Session ist nicht mehr aktiv oder du nimmst nicht daran teil.')).toBeTruthy();
  });
  expect(mockUpdateSharedStudySessionParticipant).not.toHaveBeenCalled();
  expect(mockStartTimer).not.toHaveBeenCalled();
  await rendered.unmount();
});

describe.each([
  ['Smartphone', 390, 560],
  ['Tablet', 1024, 760],
] as const)('Session-Start auf %s (%ipx)', (_device, width, expectedMaxWidth) => {
  it('enthält kein Notizfeld und startet weiterhin mit den übrigen Angaben', async () => {
    setWindowWidth(width);
    const rendered = await render(<SessionScreen />);

    expect(rendered.queryByLabelText('Notiz zur Lern-Session')).toBeNull();
    expect(rendered.queryByPlaceholderText('Was möchtest du schaffen?')).toBeNull();
    expect(ancestorStyle(
      rendered.getByRole('header', { name: 'Woran möchtest du jetzt arbeiten?' }),
      (style) => style.maxWidth === expectedMaxWidth,
    ).maxWidth).toBe(expectedMaxWidth);

    await fireEvent.press(rendered.getByLabelText('Session starten'));

    expect(mockStartTimer).toHaveBeenCalledWith({
      subjectId: 'subject-mathematik',
      goalId: null,
      plannedDurationMinutes: undefined,
    });
    expect(mockStartTimer.mock.calls[0][0]).not.toHaveProperty('note');

    await rendered.unmount();
  });
});

describe.each([
  ['Smartphone', 390, layout.phoneGutter],
  ['Tablet', 1024, layout.desktopGutter],
] as const)('Manueller Eintrag auf %s (%ipx)', (_device, width, expectedGutter) => {
  it('enthält kein Notizfeld und lässt sich weiterhin speichern', async () => {
    setWindowWidth(width);
    const rendered = await render(<ManualEntryScreen />);

    expect(rendered.queryByLabelText('Notiz zum Lerneintrag')).toBeNull();
    expect(rendered.queryByPlaceholderText('Was hast du geschafft?')).toBeNull();
    expect(ancestorStyle(
      rendered.getByText('Transparent erfasst'),
      (style) => style.maxWidth === 720,
    ).paddingHorizontal).toBe(expectedGutter);

    await fireEvent.press(rendered.getByLabelText('Lernzeit speichern'));

    expect(mockAddManualEntry).toHaveBeenCalledWith({
      subjectId: 'subject-mathematik',
      goalId: null,
      durationMinutes: 30,
      studiedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(mockAddManualEntry.mock.calls[0][0]).not.toHaveProperty('note');
    expect(mockBack).toHaveBeenCalledTimes(1);

    await rendered.unmount();
  });
});
