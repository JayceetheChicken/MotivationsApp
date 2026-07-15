import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function useCurrentDate(): Date {
  const [currentDate, setCurrentDate] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      const next = new Date();
      setCurrentDate((previous) =>
        dateKey(previous) === dateKey(next) && previous.getMinutes() === next.getMinutes()
          ? previous
          : next,
      );
    };
    const interval = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return currentDate;
}

