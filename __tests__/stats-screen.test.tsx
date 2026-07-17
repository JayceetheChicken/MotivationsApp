import { Dimensions } from 'react-native';
import { render } from '@testing-library/react-native';

import StatsScreen from '@/app/(tabs)/(stats)/stats';
import { useStudyStore } from '@/state/study-store';
import type { StudyData } from '@/types/study';

jest.mock('@/hooks/use-current-date', () => ({
  useCurrentDate: () => new Date(2026, 6, 17, 12, 0, 0),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseStudyStore = jest.mocked(useStudyStore);

const data: StudyData = {
  currentUser: {
    id: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
  },
  subjects: [{
    id: 'math',
    name: 'Mathematik',
    color: '#B44D2B',
    icon: 'book',
  }],
  sessions: [],
  grades: [{
    id: 'grade-1',
    userId: 'user-1',
    subjectId: 'math',
    subjectNameSnapshot: 'Mathematik',
    assessmentType: 'exam',
    title: 'Analysis',
    assessmentDate: '1999-03-04',
    points: 9,
    additionalStudyMinutes: 0,
    sessionIds: [],
    createdAt: '2026-07-17T08:00:00.000Z',
    updatedAt: '2026-07-17T08:00:00.000Z',
  }],
  goals: [],
  friends: [],
  challenges: [],
  activeTimer: null,
};

function setWindowWidth(width: number) {
  const dimensions = { width, height: 900, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

describe('StatsScreen grade overview', () => {
  beforeEach(() => {
    mockedUseStudyStore.mockReturnValue({
      data,
      addGrade: jest.fn(),
      addSubject: jest.fn(),
      deleteGrade: jest.fn(),
    } as unknown as ReturnType<typeof useStudyStore>);
  });

  it.each([390, 1024])('shows grades before learning statistics at %ipx', async (width) => {
    setWindowWidth(width);
    const rendered = await render(<StatsScreen />);
    const headers = rendered.getAllByRole('header');
    const gradeOverviewIndex = headers.findIndex((header) => header.props.children === 'Notenübersicht');
    const learningStatisticsIndex = headers.findIndex((header) => header.props.children === 'Lernstatistik');

    expect(gradeOverviewIndex).toBeGreaterThanOrEqual(0);
    expect(gradeOverviewIndex).toBeLessThan(learningStatisticsIndex);
    await rendered.unmount();
  });

  it('shows the grade title without rendering its assessment date', async () => {
    setWindowWidth(390);
    const rendered = await render(<StatsScreen />);

    expect(rendered.getByText('Analysis')).toBeTruthy();
    expect(rendered.getByLabelText('Mathematik, Analysis, 9 Punkte, Details öffnen')).toBeTruthy();
    expect(rendered.queryByText('1999-03-04')).toBeNull();
    expect(rendered.queryByText('04.03.1999')).toBeNull();
    await rendered.unmount();
  });
});
