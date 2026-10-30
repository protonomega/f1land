/** A suspended page wakes up with a huge gap; never credit more than this much of it. */
export const MAX_STEP_MS = 2000;

/** Foreground play-time counter behind the responsible-play reminder. */
export class ActiveClock {
  /** Active time since the app opened. */
  played = 0;
  /** Active time since the last reminder (or interval change). */
  since = 0;
  private last: number;

  constructor(now: number) {
    this.last = now;
  }

  /** Credits the wall-clock gap since the previous tick; ticks in the background count nothing. */
  tick(now: number, visible: boolean): void {
    const step = Math.max(0, Math.min(now - this.last, MAX_STEP_MS));
    this.last = now;
    if (!visible) return;
    this.played += step;
    this.since += step;
  }

  due(limitMs: number): boolean {
    return limitMs > 0 && this.since >= limitMs;
  }

  reset(): void {
    this.since = 0;
  }
}
