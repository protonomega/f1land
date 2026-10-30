import { describe, expect, it } from 'vitest';
import { ActiveClock, MAX_STEP_MS } from './activeTime';

describe('ActiveClock', () => {
  it('counts foreground ticks', () => {
    const c = new ActiveClock(0);
    for (let t = 1000; t <= 5000; t += 1000) c.tick(t, true);
    expect(c.played).toBe(5000);
    expect(c.since).toBe(5000);
  });

  it('ignores background ticks without losing its place', () => {
    const c = new ActiveClock(0);
    c.tick(1000, true);
    c.tick(2000, false);
    c.tick(3000, true);
    expect(c.played).toBe(2000);
  });

  it('caps the gap left by a suspended page', () => {
    const c = new ActiveClock(0);
    c.tick(3_600_000, true);
    expect(c.played).toBe(MAX_STEP_MS);
  });

  it('is due only for a positive limit that has been reached', () => {
    const c = new ActiveClock(0);
    for (let t = 1000; t <= 60_000; t += 1000) c.tick(t, true);
    expect(c.due(60_000)).toBe(true);
    expect(c.due(61_000)).toBe(false);
    expect(c.due(0)).toBe(false);
  });

  it('restarts the interval on reset but keeps the session total', () => {
    const c = new ActiveClock(0);
    for (let t = 1000; t <= 10_000; t += 1000) c.tick(t, true);
    c.reset();
    c.tick(11_000, true);
    expect(c.since).toBe(1000);
    expect(c.played).toBe(11_000);
  });

  it('never goes backwards if the clock does', () => {
    const c = new ActiveClock(10_000);
    c.tick(5000, true);
    expect(c.played).toBe(0);
  });
});
