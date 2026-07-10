import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';

import { createDemoData } from '@/data/demo-data';
import '@/lib/local-storage';
import type {
  ActiveTimer,
  DemoData,
  ManualStudySession,
  StudyGoal,
  TimerStudySession,
} from '@/types/study';

const STORAGE_KEY = 'lernzeit.study-state.v1';

export interface PrivacyPreferences {
  friendComparisonsEnabled: boolean;
  shareAutomaticMinutes: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
}

interface StudyState {
  data: DemoData;
  privacy: PrivacyPreferences;
}

interface PersistedStudyState extends StudyState {
  schemaVersion: 1;
}

export interface NewManualEntry {
  subjectId: string;
  durationMinutes: number;
  studiedOn: string;
  note?: string;
}

export interface NewGoal {
  title: string;
  type: 'duration' | 'sessions';
  target: number;
  subjectId?: string;
  sourcePolicy: 'all' | 'timer_only';
}

interface StudyStoreValue extends StudyState {
  hydrated: boolean;
  startTimer: (subjectId: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  finishTimer: () => TimerStudySession | null;
  addManualEntry: (entry: NewManualEntry) => void;
  addGoal: (goal: NewGoal) => void;
  setFriendComparisonsEnabled: (enabled: boolean) => void;
  setPrivacyPreference: (
    key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>,
    enabled: boolean,
  ) => void;
  resetDemo: () => void;
}

type Action =
  | { type: 'hydrate'; payload: StudyState }
  | { type: 'set-active-timer'; payload: ActiveTimer | null }
  | { type: 'finish-timer'; payload: TimerStudySession }
  | { type: 'add-manual-entry'; payload: ManualStudySession }
  | { type: 'add-goal'; payload: StudyGoal }
  | { type: 'set-friend-comparisons'; payload: boolean }
  | {
      type: 'set-privacy-preference';
      key: Exclude<keyof PrivacyPreferences, 'friendComparisonsEnabled'>;
      payload: boolean;
    }
  | { type: 'reset' };

const defaultPrivacy: PrivacyPreferences = {
  friendComparisonsEnabled: true,
  shareAutomaticMinutes: true,
  shareGoalProgress: true,
  shareStreak: true,
};

function initialState(): StudyState {
  return { data: createDemoData(), privacy: defaultPrivacy };
}

function reducer(state: StudyState, action: Action): StudyState {
  switch (action.type) {
    case 'hydrate':
      return action.payload;
    case 'set-active-timer':
      if (
        action.payload &&
        state.data.activeTimer &&
        action.payload.id !== state.data.activeTimer.id
      ) {
        return state;
      }
      return { ...state, data: { ...state.data, activeTimer: action.payload } };
    case 'finish-timer':
      if (state.data.activeTimer?.id !== action.payload.id) return state;
      return {
        ...state,
        data: {
          ...state.data,
          activeTimer: null,
          sessions: [action.payload, ...state.data.sessions],
        },
      };
    case 'add-manual-entry':
      return {
        ...state,
        data: { ...state.data, sessions: [action.payload, ...state.data.sessions] },
      };
    case 'add-goal':
      return {
        ...state,
        data: { ...state.data, goals: [action.payload, ...state.data.goals] },
      };
    case 'set-friend-comparisons':
      return {
        ...state,
        privacy: { ...state.privacy, friendComparisonsEnabled: action.payload },
      };
    case 'set-privacy-preference':
      return {
        ...state,
        privacy: { ...state.privacy, [action.key]: action.payload },
      };
    case 'reset':
      return initialState();
    default:
      return state;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function closeOpenSegment(timer: ActiveTimer, endedAt: string): ActiveTimer {
  const segments = timer.segments.map((segment, index) =>
    index === timer.segments.length - 1 && segment.endedAt === null
      ? { ...segment, endedAt }
      : segment,
  );

  return { ...timer, status: 'paused', segments, updatedAt: endedAt };
}

function elapsedMilliseconds(timer: ActiveTimer, now: Date): number {
  return timer.segments.reduce((total, segment) => {
    const start = new Date(segment.startedAt).getTime();
    const end = segment.endedAt ? new Date(segment.endedAt).getTime() : now.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total;
    return total + (end - start);
  }, 0);
}

function isPersistedStudyState(value: unknown): value is PersistedStudyState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedStudyState>;
  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.data) &&
    Array.isArray(candidate.data?.sessions) &&
    Array.isArray(candidate.data?.subjects) &&
    Boolean(candidate.privacy)
  );
}

const StudyStoreContext = createContext<StudyStoreValue | null>(null);

export function StudyStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isPersistedStudyState(parsed)) {
          dispatch({ type: 'hydrate', payload: { data: parsed.data, privacy: parsed.privacy } });
        }
      }
    } catch {
      // A corrupt local payload should never prevent the app from starting.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedStudyState = { schemaVersion: 1, ...state };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // The in-memory state remains usable if the device is temporarily out of storage.
    }
  }, [hydrated, state]);

  const value = useMemo<StudyStoreValue>(() => {
    const startTimer = (subjectId: string) => {
      if (state.data.activeTimer) return;
      const now = new Date().toISOString();
      dispatch({
        type: 'set-active-timer',
        payload: {
          schemaVersion: 1,
          id: makeId('timer'),
          userId: state.data.currentUser.id,
          subjectId,
          status: 'running',
          startedAt: now,
          segments: [{ startedAt: now, endedAt: null }],
          updatedAt: now,
        },
      });
    };

    const pauseTimer = () => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'running') return;
      dispatch({
        type: 'set-active-timer',
        payload: closeOpenSegment(timer, new Date().toISOString()),
      });
    };

    const resumeTimer = () => {
      const timer = state.data.activeTimer;
      if (!timer || timer.status !== 'paused') return;
      const now = new Date().toISOString();
      dispatch({
        type: 'set-active-timer',
        payload: {
          ...timer,
          status: 'running',
          segments: [...timer.segments, { startedAt: now, endedAt: null }],
          updatedAt: now,
        },
      });
    };

    const finishTimer = (): TimerStudySession | null => {
      const active = state.data.activeTimer;
      if (!active) return null;
      const now = new Date();
      const closed = active.status === 'running'
        ? closeOpenSegment(active, now.toISOString())
        : active;
      const durationMinutes = elapsedMilliseconds(closed, now) / 60_000;
      const session: TimerStudySession = {
        id: active.id,
        userId: active.userId,
        subjectId: active.subjectId,
        source: 'timer',
        startedAt: active.startedAt,
        endedAt: now.toISOString(),
        durationMinutes,
        createdAt: now.toISOString(),
        note: active.note,
        segments: closed.segments
          .filter((segment): segment is { startedAt: string; endedAt: string } => segment.endedAt !== null)
          .map((segment) => ({ startedAt: segment.startedAt, endedAt: segment.endedAt })),
      };
      dispatch({ type: 'finish-timer', payload: session });
      return session;
    };

    const addManualEntry = (entry: NewManualEntry) => {
      const start = new Date(`${entry.studiedOn}T12:00:00`);
      const safeMinutes = Math.max(1, Math.round(entry.durationMinutes));
      const end = new Date(start.getTime() + safeMinutes * 60_000);
      const now = new Date().toISOString();
      dispatch({
        type: 'add-manual-entry',
        payload: {
          id: makeId('manual'),
          userId: state.data.currentUser.id,
          subjectId: entry.subjectId,
          source: 'manual',
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          enteredAt: now,
          createdAt: now,
          durationMinutes: safeMinutes,
          note: entry.note?.trim() || undefined,
        },
      });
    };

    const addGoal = (goal: NewGoal) => {
      const now = new Date().toISOString();
      const common = {
        id: makeId('goal'),
        userId: state.data.currentUser.id,
        title: goal.title.trim(),
        period: 'week' as const,
        sourcePolicy: goal.sourcePolicy,
        subjectIds: goal.subjectId ? [goal.subjectId] : undefined,
        status: 'active' as const,
        createdAt: now,
      };
      const studyGoal: StudyGoal = goal.type === 'duration'
        ? { ...common, type: 'duration', targetMinutes: Math.max(15, goal.target) }
        : {
            ...common,
            type: 'sessions',
            targetSessions: Math.max(1, Math.round(goal.target)),
            minimumSessionMinutes: 10,
            sourcePolicy: 'timer_only',
          };
      dispatch({ type: 'add-goal', payload: studyGoal });
    };

    return {
      ...state,
      hydrated,
      startTimer,
      pauseTimer,
      resumeTimer,
      finishTimer,
      addManualEntry,
      addGoal,
      setFriendComparisonsEnabled: (enabled) =>
        dispatch({ type: 'set-friend-comparisons', payload: enabled }),
      setPrivacyPreference: (key, enabled) =>
        dispatch({ type: 'set-privacy-preference', key, payload: enabled }),
      resetDemo: () => dispatch({ type: 'reset' }),
    };
  }, [hydrated, state]);

  return <StudyStoreContext value={value}>{children}</StudyStoreContext>;
}

export function useStudyStore(): StudyStoreValue {
  const context = use(StudyStoreContext);
  if (!context) throw new Error('useStudyStore must be used inside StudyStoreProvider');
  return context;
}
