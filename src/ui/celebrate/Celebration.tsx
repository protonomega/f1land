import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useNav } from '@/store/nav';
import { useRewards } from '@/store/rewards';
import { useSettings } from '@/store/settings';
import { levelFromXp, useWallet } from '@/store/wallet';
import { achievements, type AchievementState } from '@/demo/progress';
import { fmtNumber, fmtOdds, plural, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { AchGlyph, signed, useReduced } from '@/screens/common';
import { CountUp } from '@/ui/bet/motionBits';
import { Confetti } from '@/ui/bet/parts';
import { IconCheck, IconChevron, IconClose, IconFlag, IconStar, IconTrophy } from '@/ui/icons';
import { currentSeasonStanding, useCelebrate, type QueuedMoment } from './store';
import { useDismissTimer, useModalFocus } from './hooks';
import './celebrate.css';

const WIN_MS = 6000;
const LOSS_MS = 4000;

/** Renders the head of the settlement queue; the next moment waits for the previous one to leave. */
export function Celebration() {
  const head = useCelebrate((s) => s.queue[0]);
  const shift = useCelebrate((s) => s.shift);
  const onboarded = useSettings((s) => s.onboarded);
  const shown = onboarded ? head : undefined;
  return (
    <AnimatePresence mode="wait">
      {shown && (shown.state === 'WON' ? <WinMoment key={shown.id} m={shown} onDone={shift} /> : <LossMoment key={shown.id} m={shown} onDone={shift} />)}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* What this settlement changed for the player                         */
/* ------------------------------------------------------------------ */

interface Extras {
  levelUp: { from: number; to: number } | null;
  level: number;
  xpFrom: number;
  xpTo: number;
  xpLeft: number;
  badges: AchievementState[];
  rank: { now: number; of: number; up: number } | null;
}

/**
 * Reads the stores once on mount. `seenLevel`/`seenAch` are null on a fresh
 * install: they are seeded from the state just before this settlement, so
 * history never re-fires but a first win can still unlock its badge.
 */
function readExtras(m: QueuedMoment): Extras {
  const w = useWallet.getState();
  const r = useRewards.getState();
  const now = levelFromXp(w.xp);
  const before = levelFromXp(Math.max(0, w.xp - m.xp));
  const seenLevel = r.seenLevel ?? before.level;
  const list = achievements(w.entries, w.xp);
  const seenAch =
    r.seenAch ??
    achievements(
      w.entries.map((e) => (e.id === m.entryId ? { ...e, state: 'PENDING' as const, payout: 0 } : e)),
      Math.max(0, w.xp - m.xp),
    )
      .filter((a) => a.unlocked)
      .map((a) => a.def.id);
  const next = useCelebrate.getState().queue[1];
  let rank: Extras['rank'] = null;
  if (m.rankBefore !== null) {
    // In a burst the following moment's "before" is exactly this one's "after".
    const standing = currentSeasonStanding();
    const after = next && next.rankBefore !== null ? next.rankBefore : standing.rank;
    rank = { now: after, of: standing.of, up: Math.max(0, m.rankBefore - after) };
  }
  return {
    levelUp: now.level > seenLevel ? { from: seenLevel, to: now.level } : null,
    level: now.level,
    xpFrom: before.level === now.level ? before.into / before.need : 0,
    xpTo: now.into / now.need,
    xpLeft: now.need - now.into,
    badges: list.filter((a) => a.unlocked && !seenAch.includes(a.def.id)),
    rank,
  };
}

function useExtras(m: QueuedMoment): Extras {
  const [x] = useState(() => readExtras(m));
  useEffect(() => {
    useRewards.getState().markSeen({
      level: x.level,
      ach: achievements(useWallet.getState().entries, useWallet.getState().xp)
        .filter((a) => a.unlocked)
        .map((a) => a.def.id),
    });
  }, [x]);
  return x;
}

const places = (n: number) => plural(n, { ru: [t('cel.place.one'), t('cel.place.few'), t('cel.place.many')], en: [t('cel.place.one'), t('cel.place.many')] });
const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

function describe(m: QueuedMoment, x: Extras): string {
  const parts = [t('cel.win.sr', { n: fmtNumber(m.payout) }), m.title];
  if (x.levelUp) parts.push(`${t('cel.levelUp')}: ${t('cel.lv', { n: x.levelUp.to })}`);
  if (x.badges.length) parts.push(`${t('cel.badge')}: ${x.badges.map((a) => t(`scr.ach.${a.def.id}`)).join(', ')}`);
  return parts.join('. ');
}

/* ------------------------------------------------------------------ */
/* Win                                                                 */
/* ------------------------------------------------------------------ */

function WinMoment({ m, onDone }: { m: QueuedMoment; onDone: () => void }) {
  const reduced = useReduced();
  const present = useIsPresent();
  const x = useExtras(m);
  const root = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const descId = useId();
  const [amount, setAmount] = useState(reduced ? m.payout : 0);
  const [burst, setBurst] = useState(0);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);
  const timer = useDismissTimer(WIN_MS, finish, present);
  const onKeyDown = useModalFocus(root, present);

  useEffect(() => {
    haptic.win();
    sfx.celebrate();
    const ids = [window.setTimeout(() => setAmount(m.payout), reduced ? 0 : 320), window.setTimeout(() => setBurst(1), 160)];
    if (x.levelUp)
      ids.push(
        window.setTimeout(() => {
          sfx.levelUp();
          haptic.impact('rigid');
        }, 1300),
      );
    if (x.badges.length)
      ids.push(
        window.setTimeout(() => {
          sfx.unlock();
          haptic.impact('light');
        }, x.levelUp ? 2200 : 1400),
      );
    return () => ids.forEach((id) => window.clearTimeout(id));
    // Runs once per moment: the component is keyed by the moment id.
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const finalText = `+${fmtNumber(m.payout)}`;
  // Level-up already takes a row, so it leaves room for one badge instead of two.
  const shownBadges = x.badges.slice(0, x.levelUp ? 1 : 2);
  const lvlDelay = 1.15;
  const badgeDelay = x.levelUp ? 1.45 : 1.15;

  return (
    <motion.div
      ref={root}
      className="cel cel--win"
      data-reduced={reduced || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t('cel.win.aria')}
      aria-describedby={descId}
      aria-live="polite"
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.24 }}
      style={present ? undefined : { pointerEvents: 'none' }}
      onKeyDown={onKeyDown}
      onPointerDownCapture={timer.stop}
    >
      <p id={descId} className="sr-only">
        {describe(m, x)}
      </p>
      <div className="cel__scrim" onClick={finish} />
      <div className="cel__fx" aria-hidden="true">
        <i className="cel__sweep" />
        <i className="cel__flag cel__flag--t" />
        <i className="cel__flag cel__flag--b" />
      </div>
      {!reduced && <Confetti fire={burst} />}

      <div className="cel__scroll">
        <div className="cel__col">
          <div className="cel__kicker" aria-hidden="true">
            {t('cel.win.kicker')}
          </div>

          <div className="cel__medal" aria-hidden="true">
            <span className="cel__halo">
              <i className="cel__rays" />
            </span>
            <i className="cel__ripple" />
            <i className="cel__ripple cel__ripple--2" />
            <i className="cel__bezel" />
            <span className="cel__disc">
              <IconTrophy size={52} />
            </span>
            <i className="cel__star cel__star--a" />
            <i className="cel__star cel__star--b" />
            <i className="cel__star cel__star--c" />
          </div>

          <div className="cel__pay" aria-hidden="true" data-long={finalText.length > 8 || undefined}>
            <span className="cel__amt num">
              <span className="cel__ghost">{finalText}</span>
              <CountUp className="cel__live" value={amount} duration={1100} format={(n) => `+${fmtNumber(n)}`} />
            </span>
            <span className="cel__unit">PULSE</span>
          </div>

          <div className="cel__chips cel__rise" style={delay(0.45)}>
            <span className="cel__chip cel__chip--mult num">{fmtOdds(m.mult)}x</span>
            <span className="cel__chip num">{t('cel.stake', { n: fmtNumber(m.stake) })}</span>
            <span className="cel__chip cel__chip--net num">{t('cel.net', { n: signed(m.payout - m.stake, fmtNumber) })}</span>
          </div>

          <div className="cel__ticket cel__rise" style={delay(0.55)}>
            <div className="cel__q">{m.title}</div>
            <div className="cel__rows">
              <div className="cel__row">
                <span className="cel__k">{t('cel.pick')}</span>
                <b className="cel__v cel__v--ok">
                  <IconCheck size={15} />
                  <span>{m.pick}</span>
                </b>
              </div>
              {m.winner && m.winner !== m.pick && (
                <div className="cel__row">
                  <span className="cel__k">{t('cel.result')}</span>
                  <b className="cel__v">{m.winner}</b>
                </div>
              )}
            </div>
          </div>

          {x.levelUp && (
            <div className="cel__lvl cel__rise" style={delay(lvlDelay)}>
              <span className="cel__lvlbadge num">{x.levelUp.to}</span>
              <span className="cel__lvltxt">
                <b>{t('cel.levelUp')}</b>
                <span className="num">
                  {t('cel.lv', { n: x.levelUp.from })} → {t('cel.lv', { n: x.levelUp.to })}
                </span>
              </span>
              <IconStar size={20} className="cel__lvlstar" />
            </div>
          )}

          {shownBadges.map((a, i) => (
            <div key={a.def.id} className="cel__ach cel__rise" style={delay(badgeDelay + i * 0.15)}>
              <span className={`sc-ic sc-ic--${a.def.tone}`}>
                <AchGlyph icon={a.def.icon} size={20} />
              </span>
              <span className="cel__achtxt">
                <span className="cel__k">{t('cel.badge')}</span>
                <b>{t(`scr.ach.${a.def.id}`)}</b>
              </span>
              {i === shownBadges.length - 1 && x.badges.length > shownBadges.length && <span className="cel__more num">{t('cel.badge.more', { n: x.badges.length - shownBadges.length })}</span>}
            </div>
          ))}

          <div className="cel__stats cel__rise" style={delay(0.7)}>
            <div className="cel__stat">
              <span className="cel__k">{t('cel.xp')}</span>
              <b className="cel__sv num">+{fmtNumber(m.xp)} XP</b>
              <span className="cel__bar" style={{ '--from': x.xpFrom, '--to': x.xpTo } as CSSProperties}>
                <i />
              </span>
              <span className="cel__sub">{t('cel.toNext', { n: fmtNumber(x.xpLeft), l: x.level + 1 })}</span>
            </div>
            {x.rank && (
              <div className="cel__stat">
                <span className="cel__k">{t('cel.rank')}</span>
                <b className="cel__sv num">#{fmtNumber(x.rank.now)}</b>
                {x.rank.up > 0 ? (
                  <span className="cel__sub cel__sub--up num">
                    ▲ {fmtNumber(x.rank.up)} {places(x.rank.up)}
                  </span>
                ) : (
                  <span className="cel__sub">{t('cel.rank.of', { n: fmtNumber(x.rank.of) })}</span>
                )}
              </div>
            )}
          </div>

          <div className="cel__actions cel__rise" style={delay(0.85)}>
            <button
              className="btn btn--ghost"
              onClick={() => {
                haptic.tap();
                useNav.getState().push({ name: 'entry', entryId: m.entryId });
                finish();
              }}
            >
              {t('cel.proof')}
            </button>
            <button
              className="btn btn--primary"
              onClick={() => {
                haptic.tap();
                finish();
              }}
            >
              {t('cel.continue')}
            </button>
          </div>
        </div>
      </div>
      <i className="cel__timer" data-state={timer.state} style={{ '--ms': `${WIN_MS}ms` } as CSSProperties} aria-hidden="true" />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Loss: calm, compact, never blocks the app                           */
/* ------------------------------------------------------------------ */

function LossMoment({ m, onDone }: { m: QueuedMoment; onDone: () => void }) {
  const reduced = useReduced();
  const present = useIsPresent();
  const x = useExtras(m);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);
  const timer = useDismissTimer(LOSS_MS, finish, present);

  useEffect(() => {
    sfx.soft();
    haptic.impact('soft');
    const id = x.levelUp || x.badges.length ? window.setTimeout(() => sfx.unlock(), 700) : 0;
    return () => window.clearTimeout(id);
    // Runs once per moment: the component is keyed by the moment id.
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const hasWinner = !!m.winner;
  const extra = [x.levelUp && `${t('cel.levelUp')}: ${t('cel.lv', { n: x.levelUp.to })}`, x.badges.length > 0 && `${t('cel.badge')}: ${x.badges.map((a) => t(`scr.ach.${a.def.id}`)).join(', ')}`].filter(Boolean);
  const base = hasWinner ? t('cel.loss.sr', { pick: m.pick, winner: m.winner ?? '', n: fmtNumber(m.stake) }) : t('cel.loss.srNoWinner', { pick: m.pick, n: fmtNumber(m.stake) });
  const spoken = [base, ...extra].join(' ');
  // Live regions announce changes, not their first paint, so the text lands a beat after mount.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setAnnounce(spoken), 80);
    return () => window.clearTimeout(id);
  }, [spoken]);

  return (
    <div className="cel-loss" data-reduced={reduced || undefined} style={present ? undefined : { pointerEvents: 'none' }}>
      <motion.div
        className="cel-loss__card"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.97 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98, transition: { duration: 0.2, ease: 'easeIn' } }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 32 }}
        drag={reduced ? false : 'y'}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragStart={timer.stop}
        onDragEnd={(_, info) => {
          if (info.offset.y > 36 || info.velocity.y > 420) finish();
        }}
        onPointerDownCapture={timer.stop}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
        <div className="cel-loss__head">
          <span className="cel-loss__ic" aria-hidden="true">
            <IconFlag size={18} />
          </span>
          <span className="cel-loss__txt" aria-hidden="true">
            <b>{t('cel.loss.title')}</b>
            <span className="ellipsis">{m.title}</span>
          </span>
          <button className="cel-loss__x" aria-label={t('ui.close')} onClick={finish}>
            <IconClose size={15} />
          </button>
        </div>

        <div className="cel-loss__cmp" aria-hidden="true">
          <div className="cel-loss__cell">
            <span className="cel__k">{t('cel.pick')}</span>
            <b className="ellipsis">{m.pick}</b>
          </div>
          {hasWinner && (
            <div className="cel-loss__cell cel-loss__cell--res">
              <span className="cel__k">{t('cel.result')}</span>
              <b className="ellipsis">{m.winner}</b>
            </div>
          )}
        </div>

        <div className="cel-loss__foot">
          <span className="cel-loss__stake num" aria-hidden="true">
            −{fmtNumber(m.stake)} <small>PULSE</small>
          </span>
          <span className="cel-loss__chip num" aria-hidden="true">
            +{fmtNumber(m.xp)} XP
          </span>
          {x.levelUp && (
            <span className="cel-loss__chip cel-loss__chip--lvl num" aria-hidden="true">
              <IconStar size={12} /> {t('cel.lv', { n: x.levelUp.to })}
            </span>
          )}
          {x.badges.length > 0 && (
            <span className="cel-loss__chip cel-loss__chip--lvl" aria-hidden="true">
              <IconStar size={12} /> {t(`scr.ach.${x.badges[0]!.def.id}`)}
            </span>
          )}
          <button
            className="cel-loss__proof"
            onClick={() => {
              haptic.tap();
              useNav.getState().push({ name: 'entry', entryId: m.entryId });
              finish();
            }}
          >
            {t('cel.proof')}
            <IconChevron size={14} />
          </button>
        </div>
        <i className="cel-loss__timer" data-state={timer.state} style={{ '--ms': `${LOSS_MS}ms` } as CSSProperties} aria-hidden="true" />
      </motion.div>
    </div>
  );
}
