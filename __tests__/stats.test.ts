import { getPeriodStats } from '@/lib/stats';

describe('empty statistics', () => {
  it('returns truthful zero values without inventing an average', () => {
    expect(getPeriodStats([])).toEqual({
      totalMinutes: 0,
      timerMinutes: 0,
      manualMinutes: 0,
      timerSessionCount: 0,
      manualEntryCount: 0,
      averageTimerSessionMinutes: null,
    });
  });
});
