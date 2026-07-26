import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useCurrentDate(refreshIntervalMs = 60_000): Date {
  const [currentDate, setCurrentDate] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      setCurrentDate(new Date());
    };
    const interval = setInterval(refresh, Math.max(1_000, refreshIntervalMs));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshIntervalMs]);

  return currentDate;
}
