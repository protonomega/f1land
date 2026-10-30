import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export type TimerState = 'run' | 'paused' | 'stopped';

/**
 * Auto-dismiss countdown. It pauses while the app is in the background (so a
 * moment is never silently missed) and stops for good once the user interacts.
 */
export function useDismissTimer(ms: number, onDone: () => void, enabled = true): { state: TimerState; stop: () => void } {
  const [state, setState] = useState<TimerState>('run');
  const done = useRef(onDone);
  const left = useRef(ms);
  const startedAt = useRef(0);
  const handle = useRef(0);
  const stopped = useRef(false);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const stop = useCallback(() => {
    stopped.current = true;
    window.clearTimeout(handle.current);
    handle.current = 0;
    setState('stopped');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const arm = () => {
      window.clearTimeout(handle.current);
      startedAt.current = performance.now();
      handle.current = window.setTimeout(() => done.current(), left.current);
      setState('run');
    };
    const pause = () => {
      if (handle.current) left.current = Math.max(0, left.current - (performance.now() - startedAt.current));
      window.clearTimeout(handle.current);
      handle.current = 0;
      setState('paused');
    };
    const onVisibility = () => {
      if (stopped.current) return;
      if (document.visibilityState === 'hidden') pause();
      else arm();
    };
    if (!stopped.current) {
      if (document.visibilityState === 'hidden') setState('paused');
      else arm();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(handle.current);
      handle.current = 0;
    };
  }, [enabled]);

  return { state, stop };
}

/**
 * Modal focus handling: moves focus into the dialog, loops Tab inside it, hides
 * the rest of the app from assistive tech via `inert`, and restores focus on close.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean): (e: KeyboardEvent) => void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hidden: HTMLElement[] = [];
    for (const el of Array.from(root.parentElement?.children ?? [])) {
      if (el !== root && el instanceof HTMLElement && !el.inert) {
        el.inert = true;
        hidden.push(el);
      }
    }
    root.focus({ preventScroll: true });
    return () => {
      for (const el of hidden) el.inert = false;
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, [ref, active]);

  return useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]'));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [ref],
  );
}
