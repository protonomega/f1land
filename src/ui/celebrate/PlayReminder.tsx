import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNav } from '@/store/nav';
import { useSettings } from '@/store/settings';
import { useToasts } from '@/store/toasts';
import { useWallet } from '@/store/wallet';
import { fmtDuration, fmtNumber, t } from '@/i18n/core';
import { haptic, insideTelegram, tg } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { signed, useReduced } from '@/screens/common';
import { IconTimer } from '@/ui/icons';
import { useCelebrate } from './store';
import { ActiveClock } from './activeTime';
import { useModalFocus } from './hooks';
import './celebrate.css';

const TICK_MS = 1000;
const SESSION_START = Date.now();

interface Recap {
  playedMs: number;
  entries: number;
  net: number;
}

/** Stakes and results recorded since the app opened (wall-clock tx log, independent of the simulated race clock). */
function recap(playedMs: number): Recap {
  const mine = useWallet.getState().txs.filter((x) => x.at >= SESSION_START);
  return {
    playedMs,
    entries: mine.filter((x) => x.kind === 'stake').length,
    net: mine.filter((x) => x.kind === 'stake' || x.kind === 'payout' || x.kind === 'refund').reduce((s, x) => s + x.amount, 0),
  };
}

/**
 * Responsible-play check-in. Counts only foreground time; once the chosen
 * interval of active play has passed it shows a calm summary of this session.
 */
export function PlayReminder() {
  const [shown, setShown] = useState<Recap | null>(null);
  const clock = useRef<ActiveClock>(null);
  clock.current ??= new ActiveClock(Date.now());
  const open = useRef(false);

  const fire = useCallback(() => {
    if (open.current) return;
    open.current = true;
    setShown(recap(clock.current!.played));
    sfx.soft();
    haptic.impact('soft');
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const c = clock.current!;
      c.tick(Date.now(), document.visibilityState === 'visible');
      const s = useSettings.getState();
      const free = s.onboarded && useCelebrate.getState().queue.length === 0;
      if (free && c.due(s.reminderMin * 60_000)) fire();
    }, TICK_MS);
    // Changing the interval starts a fresh count instead of firing straight away.
    const unsub = useSettings.subscribe((s, prev) => {
      if (s.reminderMin !== prev.reminderMin) clock.current!.reset();
    });
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') Object.assign(window, { __reminderFire: fire });
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, [fire]);

  const close = useCallback(() => {
    clock.current!.reset();
    open.current = false;
    setShown(null);
  }, []);

  return <AnimatePresence>{shown && <ReminderModal key="rem" data={shown} onKeep={close} />}</AnimatePresence>;
}

function ReminderModal({ data, onKeep }: { data: Recap; onKeep: () => void }) {
  const reduced = useReduced();
  const root = useRef<HTMLDivElement>(null);
  const onKeyDown = useModalFocus(root, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);

  const rest = () => {
    haptic.tap();
    onKeep();
    if (insideTelegram()) tg()?.close?.();
    else useToasts.getState().push({ kind: 'info', title: t('rem.breakToast') });
  };

  return (
    <motion.div
      ref={root}
      className="rem"
      data-reduced={reduced || undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rem-title"
      aria-describedby="rem-body"
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.22 }}
      onKeyDown={onKeyDown}
    >
      <div className="rem__scrim" />
      <motion.div
        className="rem__card"
        initial={reduced ? false : { y: 24, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        exit={reduced ? undefined : { y: 16, scale: 0.98, transition: { duration: 0.18, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      >
        <span className="rem__ic" aria-hidden="true">
          <IconTimer size={28} />
        </span>
        <h2 id="rem-title" className="rem__title">
          {t('rem.title')}
        </h2>
        <p id="rem-body" className="rem__body">
          {t('rem.body', { d: fmtDuration(data.playedMs) })}
        </p>
        <dl className="rem__stats">
          <div className="rem__stat">
            <dt>{t('rem.time')}</dt>
            <dd className="num">{fmtDuration(data.playedMs)}</dd>
          </div>
          <div className="rem__stat">
            <dt>{t('rem.entries')}</dt>
            <dd className="num">{fmtNumber(data.entries)}</dd>
          </div>
          <div className="rem__stat">
            <dt>{t('rem.net')}</dt>
            <dd className="num">{signed(data.net, fmtNumber)}</dd>
          </div>
        </dl>
        <div className="rem__actions">
          <button className="btn btn--primary btn--block" onClick={rest}>
            {t('rem.break')}
          </button>
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              haptic.tap();
              onKeep();
            }}
          >
            {t('rem.keep')}
          </button>
        </div>
        <button
          className="rem__link"
          onClick={() => {
            haptic.tap();
            onKeep();
            useNav.getState().push({ name: 'settings' });
          }}
        >
          {t('rem.settings')}
        </button>
      </motion.div>
    </motion.div>
  );
}
