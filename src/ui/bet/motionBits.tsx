/* Small motion primitives for the betting UI: odds ticker, count-up numbers, spark bursts. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fmtNumber, fmtOdds } from '@/i18n/core';
import { prefersReducedMotion, useSettings } from '@/store/settings';

function useReduced(): boolean {
  const motion = useSettings((s) => s.motion);
  return prefersReducedMotion(motion);
}

/* ------------------------------------------------------------------ */
/* Odds ticker                                                         */
/* ------------------------------------------------------------------ */

type Tick = { dir: 'up' | 'down'; key: number } | null;

/**
 * Multiplier with a short green/red flash and arrow when the live pool book
 * moves it. Changes smaller than the displayed precision are ignored so the
 * board never flickers without a visible reason.
 */
export function OddsTicker({ odds, className = '' }: { odds: number | null; className?: string }) {
  const prev = useRef<number | null>(odds);
  const timer = useRef(0);
  const [tick, setTick] = useState<Tick>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const before = prev.current;
    prev.current = odds;
    if (before === null || odds === null) return;
    if (fmtOdds(before) === fmtOdds(odds)) return;
    setTick((t) => ({ dir: odds > before ? 'up' : 'down', key: (t?.key ?? 0) + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTick(null), 1000);
  }, [odds]);

  return (
    <span key={tick?.key ?? 0} className={`odds-tk num ${className} ${tick ? `odds-tk--${tick.dir}` : ''}`}>
      {odds === null ? '—' : `${fmtOdds(odds)}x`}
      {tick && (
        <i className="odds-tk__arr" aria-hidden="true">
          {tick.dir === 'up' ? '▲' : '▼'}
        </i>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Count-up number                                                     */
/* ------------------------------------------------------------------ */

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** Rolls from the previous value to the new one (instant under reduced motion). */
export function CountUp({ value, className, duration = 650, format = (n: number) => fmtNumber(n) }: { value: number; className?: string; duration?: number; format?: (n: number) => string }) {
  const reduced = useReduced();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current;
    const b = value;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const v = a + (b - a) * easeOut(k);
      from.current = v;
      setShown(k >= 1 ? b : v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return <span className={className}>{format(Math.round(shown))}</span>;
}

/* ------------------------------------------------------------------ */
/* Spark burst                                                         */
/* ------------------------------------------------------------------ */

const SPARK_COLORS = ['#c6ff3d', '#e6ff9a', '#2fe6ff', '#ffffff', '#ffd12e'];

/** Radial burst re-fired whenever `fire` changes to a new truthy value. */
export function Sparks({ fire, count = 16, spread = 90, className = '' }: { fire: number; count?: number; spread?: number; className?: string }) {
  const reduced = useReduced();
  const [burst, setBurst] = useState(0);
  const last = useRef(fire);

  useEffect(() => {
    if (fire && fire !== last.current) setBurst((b) => b + 1);
    if (!fire) setBurst(0);
    last.current = fire;
  }, [fire]);

  if (!burst || reduced) return null;
  const parts = Array.from({ length: count }, (_, i) => {
    // Deterministic jitter per particle keeps renders pure.
    const j = Math.sin((i + 1) * 12.9898 + burst * 78.233) * 43758.5453;
    const r = j - Math.floor(j);
    const ang = (i / count) * Math.PI * 2 + r * 0.6;
    const dist = spread * (0.45 + r * 0.55);
    const style = {
      '--dx': `${Math.cos(ang) * dist}px`,
      '--dy': `${Math.sin(ang) * dist}px`,
      '--s': `${3 + Math.round(r * 4)}px`,
      '--c': SPARK_COLORS[i % SPARK_COLORS.length],
      animationDelay: `${Math.round(r * 90)}ms`,
    } as CSSProperties;
    return <i key={i} style={style} />;
  });
  return (
    <span key={burst} className={`sparks ${className}`} aria-hidden="true">
      {parts}
    </span>
  );
}
