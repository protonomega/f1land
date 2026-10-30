import { describe, expect, it } from 'vitest';
import { cycleDay, streakTrack } from './streak';

const row = (count: number, checkedToday: boolean) => streakTrack({ count, checkedToday, nextDay: count + 1 }).days.map((d) => d[0]).join('');

describe('streak track', () => {
  it('wraps days into the 7-day cycle', () => {
    expect([1, 7, 8, 14, 15].map(cycleDay)).toEqual([1, 7, 1, 7, 1]);
  });

  it('starts a broken streak at day 1', () => {
    expect(row(0, false)).toBe('tnnnnnn');
  });

  it('marks yesterday as done and offers today before the check-in', () => {
    expect(row(3, false)).toBe('dddtnnn');
  });

  it('marks today as done after the check-in', () => {
    expect(row(3, true)).toBe('dddnnnn');
    expect(streakTrack({ count: 3, checkedToday: true, nextDay: 4 }).today).toBe(3);
  });

  it('fills the whole row on day 7 and starts a clean row the day after', () => {
    expect(row(7, true)).toBe('ddddddd');
    expect(row(7, false)).toBe('tnnnnnn');
  });

  it('keeps counting through later cycles', () => {
    expect(row(9, true)).toBe('ddnnnnn');
    expect(row(9, false)).toBe('ddtnnnn');
  });
});
