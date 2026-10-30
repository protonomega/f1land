import { STREAK_BONUS, type StreakView } from '@/store/rewards';

export type DayState = 'done' | 'today' | 'next';

/** Position of a streak day inside the repeating 7-day bonus cycle (1..7). */
export const cycleDay = (day: number): number => ((Math.max(1, day) - 1) % STREAK_BONUS.length) + 1;

/**
 * State of each bonus pill. Before today's check-in the pills up to yesterday are
 * done and today is claimable; afterwards today is done too. A new cycle starts
 * from a clean row.
 */
export function streakTrack(view: Pick<StreakView, 'count' | 'checkedToday' | 'nextDay'>): { today: number; days: DayState[] } {
  const today = view.checkedToday ? cycleDay(view.count) : cycleDay(view.nextDay);
  const days = STREAK_BONUS.map((_, i): DayState => {
    const n = i + 1;
    if (n < today || (n === today && view.checkedToday)) return 'done';
    return n === today ? 'today' : 'next';
  });
  return { today, days };
}
