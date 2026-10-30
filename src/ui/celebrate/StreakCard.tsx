import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STREAK_BONUS, useRewards, useStreak } from '@/store/rewards';
import { useWallet } from '@/store/wallet';
import { useNav } from '@/store/nav';
import { useNow } from '@/ui/kit';
import { CountUp } from '@/ui/bet/motionBits';
import { fmtCountdown, fmtDuration, fmtNumber, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { useReduced } from '@/screens/common';
import { IconCheck, IconCoin, IconFire, IconGift, IconStar, IconTimer, IconTrophy } from '@/ui/icons';
import { streakTrack } from './streak';
import './celebrate.css';

const msToMidnight = (ms: number) => {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime() - ms;
};

/** Wall-clock "now" that refreshes exactly at local midnight and when the app returns from the background. */
function useToday(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), msToMidnight(now) + 60);
    return () => window.clearTimeout(id);
  }, [now]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, []);
  return now;
}

/** Time to the next local midnight; `long` ticks every second as h:mm:ss. */
function NextIn({ long }: { long?: boolean }) {
  const now = useNow(long ? 1000 : 30_000);
  const ms = msToMidnight(now);
  return <span className="num">{long ? fmtCountdown(ms) : fmtDuration(ms)}</span>;
}

/* ------------------------------------------------------------------ */
/* Coin burst                                                          */
/* ------------------------------------------------------------------ */

interface Burst {
  key: number;
  bonus: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** Centre of `el` in the coordinate space of `host`. */
function centre(el: Element | null, host: Element): { x: number; y: number } {
  const h = host.getBoundingClientRect();
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2 - h.left, y: r.top + r.height / 2 - h.top } : { x: h.width / 2, y: h.height / 2 };
}

function Coins({ burst, count }: { burst: Burst; count: number }) {
  const { from, to } = burst;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const spread = (i - (count - 1) / 2) * 0.36;
        const dist = 46 + ((i * 37) % 5) * 9;
        const sx = Math.sin(spread) * dist;
        const sy = -Math.cos(spread) * dist;
        const t = { duration: 0.95, times: [0, 0.4, 1] };
        return (
          <motion.i
            key={i}
            className="stk__coin"
            style={{ left: from.x, top: from.y }}
            initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
            animate={{ x: [0, sx, to.x - from.x], y: [0, sy, to.y - from.y], scale: [0.3, 1, 0.55], opacity: [0, 1, 1, 0] }}
            transition={{
              delay: i * 0.045,
              x: { ...t, ease: ['easeOut', 'easeIn'] },
              y: { ...t, ease: ['easeOut', 'easeIn'] },
              scale: t,
              opacity: { duration: 0.95, times: [0, 0.12, 0.85, 1] },
            }}
          />
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Claim logic shared by both variants                                  */
/* ------------------------------------------------------------------ */

function useClaim(host: RefObject<HTMLElement | null>, origin: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>) {
  const reduced = useReduced();
  const [burst, setBurst] = useState<Burst | null>(null);
  const [bump, setBump] = useState(0);
  const timers = useRef<number[]>([]);
  const held = useRef(false);
  const balance = useWallet((s) => s.balance);
  const [shownBalance, setShownBalance] = useState(balance);

  useEffect(() => {
    if (!held.current) setShownBalance(balance);
  }, [balance]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const claim = useCallback(() => {
    // Measured first: the claim button unmounts as soon as the store updates.
    const from = host.current ? centre(origin.current, host.current) : null;
    const to = host.current ? centre(target.current, host.current) : null;
    // The displayed balance waits for the coins so the count-up lands with them.
    held.current = !reduced;
    const r = useRewards.getState().checkIn();
    if (!r.ok) {
      held.current = false;
      return;
    }
    haptic.notify('success');
    sfx.checkIn();
    if (reduced || !from || !to) return;
    setBurst({ key: Date.now(), bonus: r.bonus, from, to });
    timers.current.push(
      window.setTimeout(() => {
        held.current = false;
        setShownBalance(useWallet.getState().balance);
        setBump((n) => n + 1);
        haptic.impact('light');
      }, 640),
      window.setTimeout(() => setBurst(null), 1700),
    );
  }, [reduced, host, origin, target]);

  return { claim, burst, bump, shownBalance, reduced };
}

/* ------------------------------------------------------------------ */
/* Public component                                                     */
/* ------------------------------------------------------------------ */

export function StreakCard({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  return variant === 'compact' ? <StreakCompact /> : <StreakFull />;
}

function StreakFull() {
  const now = useToday();
  const view = useStreak(now);
  const host = useRef<HTMLElement>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const balRef = useRef<HTMLDivElement>(null);
  const { claim, burst, bump, shownBalance, reduced } = useClaim(host, cta, balRef);

  const cold = view.count === 0 && !view.checkedToday;
  const { today, days } = streakTrack(view);
  const headline = view.count > 0 ? t('streak.day', { n: view.count }) : t('streak.start');
  const justClaimed = burst ? today : 0;
  const next = t('streak.next', { t: '\u0000' }).split('\u0000');

  return (
    <section ref={host} className="card card--pad stk stk--full" aria-label={t('streak.title')} data-ready={!view.checkedToday || undefined}>
      <header className="stk__head">
        <span key={burst?.key ?? 0} className="stk__flame" data-cold={cold || undefined} data-pop={burst ? '' : undefined} aria-hidden="true">
          <IconFire size={24} />
        </span>
        <div className="stk__txt">
          <span className="sc-kicker">{t('streak.title')}</span>
          <b className="stk__h">{headline}</b>
          <span className="stk__sub">{view.checkedToday ? t('streak.done') : t('streak.ready')}</span>
        </div>
        {view.best > 0 && (
          <span className="stk__best num">
            <IconTrophy size={12} />
            {t('streak.best', { n: view.best })}
          </span>
        )}
      </header>

      <ul className="stk__days">
        {STREAK_BONUS.map((bonus, i) => {
          const n = i + 1;
          const state = days[i]!;
          return (
            <li
              key={n}
              className="stk__day"
              data-state={state}
              data-last={n === STREAK_BONUS.length || undefined}
              data-today={n === today || undefined}
              data-just={n === justClaimed || undefined}
              aria-label={t('streak.pill', { n, b: bonus, s: t(`streak.pill.${state}`) })}
            >
              <span className="stk__dn num" aria-hidden="true">
                {state === 'done' ? <IconCheck size={13} /> : n === STREAK_BONUS.length ? <IconStar size={12} /> : n}
              </span>
              <span className="stk__db num" aria-hidden="true">
                +{bonus}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="stk__foot">
        {view.checkedToday ? (
          <div className="stk__cta stk__cta--done" role="status">
            <span className="stk__ctat">
              <IconCheck size={15} />
              {t('streak.wait')}
            </span>
            <span className="stk__ctas">
              <IconTimer size={12} />
              {next[0]}
              <NextIn long />
              {next[1]}
            </span>
          </div>
        ) : (
          <button ref={cta} className="btn btn--primary stk__cta" onClick={claim}>
            <IconGift size={18} />
            {t('streak.claim', { n: view.nextBonus })}
          </button>
        )}
        <div ref={balRef} className="stk__bal">
          {bump > 0 && <i key={bump} className="stk__balfx" />}
          <span className="stk__balk">{t('streak.balance')}</span>
          <span className="stk__balv num">
            <IconCoin size={14} />
            <CountUp value={shownBalance} duration={700} />
          </span>
        </div>
      </div>
      <p className="stk__fine">{t('streak.fine')}</p>

      <span className="sr-only" role="status">
        {burst ? t('streak.added', { n: fmtNumber(burst.bonus) }) : ''}
      </span>
      <div className="stk__fx" aria-hidden="true">
        <AnimatePresence>
          {burst && (
            <span key={burst.key} className="stk__floatwrap" style={{ left: burst.from.x, top: burst.from.y }}>
              <motion.span className="stk__float num" initial={{ opacity: 0, y: 12 }} animate={{ opacity: [0, 1, 1, 0], y: -30 }} transition={{ duration: 1.1, times: [0, 0.2, 0.7, 1] }}>
                +{fmtNumber(burst.bonus)}
              </motion.span>
            </span>
          )}
        </AnimatePresence>
        {burst && !reduced && <Coins key={burst.key} burst={burst} count={10} />}
      </div>
    </section>
  );
}

function StreakCompact() {
  const now = useToday();
  const view = useStreak(now);
  const host = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const flame = useRef<HTMLSpanElement>(null);
  const { claim, burst, reduced } = useClaim(host, chip, flame);

  const cold = view.count === 0 && !view.checkedToday;
  const headline = view.count > 0 ? t('streak.day', { n: view.count }) : t('streak.start');
  const sub = view.checkedToday ? t('streak.compact.done') : t('streak.compact.ready', { n: view.nextBonus });

  return (
    <div ref={host} className="card stk stk--compact" data-ready={!view.checkedToday || undefined}>
      <button
        className="stk__main"
        onClick={() => {
          haptic.tap();
          useNav.getState().push({ name: 'rewards' });
        }}
      >
        <span ref={flame} key={burst?.key ?? 0} className="stk__flame" data-cold={cold || undefined} data-pop={burst ? '' : undefined} aria-hidden="true">
          <IconFire size={20} />
        </span>
        <span className="stk__txt">
          <b className="stk__h">{headline}</b>
          <span className="stk__sub">{sub}</span>
        </span>
      </button>
      {view.checkedToday ? (
        <span className="stk__chip stk__chip--wait" aria-label={t('streak.next', { t: fmtDuration(msToMidnight(now)) })}>
          <IconTimer size={13} />
          <NextIn />
        </span>
      ) : (
        <button ref={chip} className="stk__chip stk__chip--go num" onClick={claim} aria-label={t('streak.claim', { n: view.nextBonus })}>
          <IconGift size={16} />
          +{view.nextBonus}
        </button>
      )}
      <span className="sr-only" role="status">
        {burst ? t('streak.added', { n: fmtNumber(burst.bonus) }) : ''}
      </span>
      <div className="stk__fx" aria-hidden="true">
        {burst && !reduced && <Coins key={burst.key} burst={burst} count={7} />}
      </div>
    </div>
  );
}
