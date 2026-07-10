import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { ActiveTimer } from '@/types/study';

function calculateElapsedSeconds(timer: ActiveTimer | null, now: number): number {
  if (!timer) return 0;
  const milliseconds = timer.segments.reduce((total, segment) => {
    const start = new Date(segment.startedAt).getTime();
    const end = segment.endedAt ? new Date(segment.endedAt).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total;
    return total + (end - start);
  }, 0);
  return Math.floor(milliseconds / 1000);
}

export function useTimerElapsed(timer: ActiveTimer | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [timer]);

  return calculateElapsedSeconds(timer, now);
}
