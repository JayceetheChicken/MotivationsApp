import { act, renderHook } from '@testing-library/react-native';

import { useCurrentDate } from '@/hooks/use-current-date';

describe('useCurrentDate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes the current time at the requested interval within the same minute', async () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-07-26T10:00:00.000Z');
    jest.setSystemTime(startedAt);

    const rendered = await renderHook(() => useCurrentDate(15_000));
    expect(rendered.result.current.getTime()).toBe(startedAt.getTime());

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    expect(rendered.result.current.getTime()).toBe(startedAt.getTime() + 15_000);
    await rendered.unmount();
  });
});
