import type {
  DemoData,
  Friend,
  ManualStudySession,
  StudyChallenge,
  StudyGoal,
  StudySession,
  StudyUser,
  Subject,
  TimerStudySession,
} from '../types/study';

const MINUTE_MS = 60_000;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

function atDayOffset(
  referenceDate: Date,
  daysFromToday: number,
  hour: number,
  minute = 0,
): Date {
  const result = new Date(referenceDate);
  result.setDate(result.getDate() + daysFromToday);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function timerSession(
  id: string,
  userId: string,
  subjectId: string,
  startedAt: Date,
  durationMinutes: number,
  note?: string,
): TimerStudySession {
  const hasPause = durationMinutes >= 45;
  const firstPartMinutes = hasPause ? Math.ceil(durationMinutes * 0.58) : durationMinutes;
  const firstPartEndsAt = addMinutes(startedAt, firstPartMinutes);
  const secondPartStartsAt = addMinutes(firstPartEndsAt, hasPause ? 5 : 0);
  const endedAt = hasPause
    ? addMinutes(secondPartStartsAt, durationMinutes - firstPartMinutes)
    : firstPartEndsAt;

  return {
    id,
    userId,
    subjectId,
    source: 'timer',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMinutes,
    note,
    segments: hasPause
      ? [
          {
            startedAt: startedAt.toISOString(),
            endedAt: firstPartEndsAt.toISOString(),
          },
          {
            startedAt: secondPartStartsAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
        ]
      : [
          {
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
        ],
    createdAt: addMinutes(endedAt, 1).toISOString(),
  };
}

function manualSession(
  id: string,
  userId: string,
  subjectId: string,
  startedAt: Date,
  durationMinutes: number,
  enteredAt: Date,
  note?: string,
): ManualStudySession {
  return {
    id,
    userId,
    subjectId,
    source: 'manual',
    startedAt: startedAt.toISOString(),
    endedAt: addMinutes(startedAt, durationMinutes).toISOString(),
    durationMinutes,
    enteredAt: enteredAt.toISOString(),
    note,
    createdAt: enteredAt.toISOString(),
  };
}

function completedTimerForToday(
  referenceDate: Date,
  userId: string,
  subjectId: string,
): TimerStudySession | null {
  const dayStart = new Date(referenceDate);
  dayStart.setHours(0, 0, 0, 0);
  const availableWholeMinutes = Math.floor(
    (referenceDate.getTime() - dayStart.getTime()) / MINUTE_MS,
  );

  if (availableWholeMinutes < 2) {
    return null;
  }

  const durationMinutes = Math.min(52, availableWholeMinutes - 1);
  const endedAt = addMinutes(referenceDate, -1);
  const startedAt = addMinutes(endedAt, -durationMinutes);

  return timerSession(
    'session-today',
    userId,
    subjectId,
    startedAt,
    durationMinutes,
    'Analysis wiederholen',
  );
}

/**
 * Creates deterministic demo content anchored to the supplied date. Calling the
 * factory on another day moves sessions, streaks and challenge periods with it.
 */
export function createDemoData(referenceDate: Date = new Date()): DemoData {
  const now = new Date(referenceDate);
  const currentUser: StudyUser = {
    id: 'user-lea',
    username: 'lea.lernt',
    displayName: 'Lea Schneider',
    avatarInitials: 'LS',
    avatarColor: '#6C63FF',
  };

  const subjects: readonly Subject[] = [
    { id: 'subject-mathe', name: 'Mathematik', color: '#6C63FF', icon: 'function' },
    { id: 'subject-info', name: 'Informatik', color: '#23A6A6', icon: 'code' },
    { id: 'subject-englisch', name: 'Englisch', color: '#EE8A5A', icon: 'translate' },
    { id: 'subject-geschichte', name: 'Geschichte', color: '#E05E84', icon: 'history' },
  ];

  const todaySession = completedTimerForToday(now, currentUser.id, 'subject-mathe');
  const sessions: StudySession[] = [
    ...(todaySession ? [todaySession] : []),
    timerSession('session-1', currentUser.id, 'subject-info', atDayOffset(now, -1, 17, 20), 63, 'TypeScript-Übungen'),
    timerSession('session-2', currentUser.id, 'subject-englisch', atDayOffset(now, -2, 18, 5), 38, 'Vokabeln und Hörverstehen'),
    timerSession('session-3', currentUser.id, 'subject-mathe', atDayOffset(now, -3, 16, 30), 71, 'Lineare Algebra'),
    timerSession('session-4', currentUser.id, 'subject-geschichte', atDayOffset(now, -4, 19, 0), 32, 'Zusammenfassung Weimarer Republik'),
    manualSession('session-5', currentUser.id, 'subject-englisch', atDayOffset(now, -5, 15, 30), 28, atDayOffset(now, -5, 19, 10), 'Lernen in der Bahn'),
    timerSession('session-6', currentUser.id, 'subject-info', atDayOffset(now, -6, 10, 0), 46, 'Algorithmen'),
    timerSession('session-7', currentUser.id, 'subject-mathe', atDayOffset(now, -7, 18, 20), 36, 'Übungsblatt'),
    timerSession('session-8', currentUser.id, 'subject-info', atDayOffset(now, -8, 17, 0), 44, 'Datenstrukturen'),
    manualSession('session-9', currentUser.id, 'subject-geschichte', atDayOffset(now, -9, 14, 0), 25, atDayOffset(now, -9, 20, 0), 'Bibliothek'),
    timerSession('session-10', currentUser.id, 'subject-englisch', atDayOffset(now, -10, 18, 30), 34, 'Essay-Entwurf'),
    timerSession('session-11', currentUser.id, 'subject-mathe', atDayOffset(now, -11, 16, 15), 58, 'Stochastik'),
    timerSession('session-12', currentUser.id, 'subject-info', atDayOffset(now, -13, 11, 0), 41, 'Datenbanken'),
    manualSession('session-13', currentUser.id, 'subject-englisch', atDayOffset(now, -20, 13, 0), 30, atDayOffset(now, -20, 18, 0)),
    timerSession('session-14', currentUser.id, 'subject-mathe', atDayOffset(now, -32, 9, 30), 82, 'Probeklausur'),
    timerSession('session-15', currentUser.id, 'subject-geschichte', atDayOffset(now, -60, 17, 45), 39),
  ];

  const goals: readonly StudyGoal[] = [
    {
      id: 'goal-weekly-time',
      userId: currentUser.id,
      type: 'duration',
      title: '5 Stunden pro Woche',
      period: 'week',
      targetMinutes: 300,
      sourcePolicy: 'all',
      status: 'active',
      createdAt: atDayOffset(now, -75, 12).toISOString(),
    },
    {
      id: 'goal-weekly-sessions',
      userId: currentUser.id,
      type: 'sessions',
      title: '4 konzentrierte Sessions',
      period: 'week',
      targetSessions: 4,
      minimumSessionMinutes: 25,
      sourcePolicy: 'timer_only',
      status: 'active',
      createdAt: atDayOffset(now, -45, 12).toISOString(),
    },
    {
      id: 'goal-monthly-mathe',
      userId: currentUser.id,
      type: 'duration',
      title: 'Mathe im Fokus',
      period: 'month',
      targetMinutes: 720,
      sourcePolicy: 'all',
      subjectIds: ['subject-mathe'],
      status: 'active',
      createdAt: atDayOffset(now, -40, 12).toISOString(),
    },
  ];

  const friendUsers: readonly StudyUser[] = [
    {
      id: 'user-jonas',
      username: 'jonas.codes',
      displayName: 'Jonas Weber',
      avatarInitials: 'JW',
      avatarColor: '#23A6A6',
    },
    {
      id: 'user-aylin',
      username: 'aylin.study',
      displayName: 'Aylin Kaya',
      avatarInitials: 'AK',
      avatarColor: '#EE8A5A',
    },
    {
      id: 'user-noah',
      username: 'noah_fokus',
      displayName: 'Noah Fischer',
      avatarInitials: 'NF',
      avatarColor: '#E05E84',
    },
  ];

  const friends: readonly Friend[] = [
    {
      id: 'friend-jonas',
      user: friendUsers[0],
      status: 'accepted',
      canSeeMyStats: true,
      canSeeTheirStats: true,
      stats: {
        weekMinutes: 286,
        automaticMinutes: 256,
        manualMinutes: 30,
        timerSessionCount: 5,
        weeklyGoalMinutes: 300,
        streakDays: 9,
        changeFromPreviousWeekPercent: 18,
      },
    },
    {
      id: 'friend-aylin',
      user: friendUsers[1],
      status: 'accepted',
      canSeeMyStats: true,
      canSeeTheirStats: true,
      stats: {
        weekMinutes: 342,
        automaticMinutes: 342,
        manualMinutes: 0,
        timerSessionCount: 6,
        weeklyGoalMinutes: 300,
        streakDays: 6,
        changeFromPreviousWeekPercent: 27,
      },
    },
    {
      id: 'friend-noah',
      user: friendUsers[2],
      status: 'accepted',
      canSeeMyStats: false,
      canSeeTheirStats: true,
      stats: {
        weekMinutes: 174,
        automaticMinutes: 149,
        manualMinutes: 25,
        timerSessionCount: 3,
        weeklyGoalMinutes: 240,
        streakDays: 3,
        changeFromPreviousWeekPercent: -8,
      },
    },
  ];

  const challengeStartsAt = atDayOffset(now, -2, 0);
  const challengeEndsAt = new Date(atDayOffset(now, 4, 23, 59).getTime() + 59_000);
  const upcomingStartsAt = atDayOffset(now, 7, 0);
  const upcomingEndsAt = new Date(atDayOffset(now, 13, 23, 59).getTime() + 59_000);

  const challenges: readonly StudyChallenge[] = [
    {
      id: 'challenge-sommer-fokus',
      creatorId: 'user-aylin',
      title: 'Sommer-Fokuswoche',
      description: 'Gemeinsam sammeln wir zehn konzentrierte Lernstunden.',
      target: { type: 'duration', mode: 'shared', targetMinutes: 600 },
      sourcePolicy: 'timer_only',
      startsAt: challengeStartsAt.toISOString(),
      endsAt: challengeEndsAt.toISOString(),
      status: 'active',
      participants: [
        { userId: currentUser.id, status: 'accepted', contributionMinutes: 153, timerSessionCount: 3 },
        { userId: 'user-jonas', status: 'accepted', contributionMinutes: 128, timerSessionCount: 2 },
        { userId: 'user-aylin', status: 'accepted', contributionMinutes: 184, timerSessionCount: 3 },
      ],
    },
    {
      id: 'challenge-drei-sessions',
      creatorId: currentUser.id,
      title: 'Drei gute Sessions',
      description: 'Nächste Woche schafft jede Person drei Sessions mit mindestens 25 Minuten.',
      target: {
        type: 'sessions',
        mode: 'per_participant',
        targetSessions: 3,
        minimumSessionMinutes: 25,
      },
      sourcePolicy: 'timer_only',
      startsAt: upcomingStartsAt.toISOString(),
      endsAt: upcomingEndsAt.toISOString(),
      status: 'upcoming',
      participants: [
        { userId: currentUser.id, status: 'accepted', contributionMinutes: 0, timerSessionCount: 0 },
        { userId: 'user-noah', status: 'invited', contributionMinutes: 0, timerSessionCount: 0 },
      ],
    },
  ];

  return {
    currentUser,
    subjects,
    sessions,
    goals,
    friends,
    challenges,
    activeTimer: null,
  };
}

/** A convenient snapshot for screens that do not need to inject a reference date. */
export const demoData = createDemoData();
