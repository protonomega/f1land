/* Queue of decided settlements waiting to be celebrated (win) or acknowledged (loss). */
import { create } from 'zustand';
import { rankFor } from '@/demo/leaderboard';
import { useWallet } from '@/store/wallet';
import { useLive } from '@/store/live';

export interface SettlementMoment {
  state: 'WON' | 'LOST';
  payout: number;
  stake: number;
  mult: number;
  /** Question text of the pool. */
  title: string;
  /** The user's outcome label. */
  pick: string;
  /** Winning outcome label (null when unknown). */
  winner: string | null;
  entryId: string;
  /** Season rank before this settlement was credited (null = don't show movement). */
  rankBefore: number | null;
  xp: number;
}

export interface QueuedMoment extends SettlementMoment {
  id: number;
  at: number;
}

interface CelebrateState {
  queue: QueuedMoment[];
  push: (m: SettlementMoment) => void;
  /** Removes the head of the queue (the moment currently shown). */
  shift: () => void;
  clear: () => void;
}

let seq = 0;
/** Bursts of settlements (end of a race) collapse to the most recent few. */
const MAX_QUEUED = 4;

export const useCelebrate = create<CelebrateState>((set) => ({
  queue: [],
  push: (m) => set((s) => ({ queue: [...s.queue, { ...m, id: ++seq, at: Date.now() }].slice(-MAX_QUEUED) })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
  clear: () => set({ queue: [] }),
}));

export function queueSettlement(m: SettlementMoment): void {
  useCelebrate.getState().push(m);
}

/** Season standing of the local player right now (cheap: one leaderboard pass). */
export function currentSeasonStanding(): { rank: number; of: number } {
  const w = useWallet.getState();
  const now = useLive.getState().runner?.nowMs ?? Date.now();
  return rankFor('season', w.entries, w.xp, now);
}

export function currentSeasonRank(): number {
  return currentSeasonStanding().rank;
}
