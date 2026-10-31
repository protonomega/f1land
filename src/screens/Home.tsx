import { useMemo } from 'react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { levelFromXp, useWallet, type Entry } from '@/store/wallet';
import { CHANNELS } from '@/demo/channels';
import { CIRCUIT_META } from '@/data/circuits';
import { DRIVER_BY_ID } from '@/data/teams';
import { fmtCountdown, fmtGap, fmtLap, fmtNumber, fmtOdds, getLang, t } from '@/i18n/core';
import { Header } from '@/app/Header';
import { useMapCars, useSessionNow } from '@/app/hooks';
import { outcomeShort, poolTexts } from '@/app/poolText';
import { Card, Section, TeamBar } from '@/ui/kit';
import { TrackMap } from '@/ui/TrackMap';
import { StreakCard } from '@/ui/celebrate/StreakCard';
import { IconArrow, IconChevron, IconTimer, IconTrophy } from '@/ui/icons';
import { msUntilLock } from '@/domain/lifecycle';
import { leaderboardWithYou, userPoints } from '@/demo/leaderboard';
import { useYou } from './Profile';
import '@/styles/home.css';

/**
 * Home is a return-visit screen, ordered by what pulls a fan back in:
 * the race happening now, one question to answer next, picks already in play,
 * the daily streak, more open questions, and progress towards the next level.
 */
export function HomeScreen() {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const channelId = useLive((s) => s.channelId);
  const go = useNav((s) => s.go);
  const push = useNav((s) => s.push);
  const pools = usePools((s) => s.pools);
  const entries = useWallet((s) => s.entries);
  const now = useSessionNow();

  const open = useMemo(
    () =>
      pools
        .filter((p) => p.pool.status === 'OPEN' && p.pool.intake_status === 'ACCEPTING')
        .sort((a, b) => b.priority - a.priority || Date.parse(a.pool.closes_at) - Date.parse(b.pool.closes_at)),
    [pools],
  );
  const featured = open[0] ?? null;
  const pending = entries.filter((e) => e.state === 'PENDING');
  const openPool = (lp: LivePool) => push({ name: 'pool', channelId, poolId: lp.pool.pool_id });

  return (
    <div className="home">
      <Header />

      <LiveCard onOpen={() => go('live')} />

      <Section title={t('home3.next')}>
        {featured ? (
          <NextPool lp={featured} now={now} onOpen={() => openPool(featured)} />
        ) : live ? (
          <Card className="hm-empty" onClick={() => go('live')} ariaLabel={t('home3.noPools')}>
            <span>{t('home3.noPools')}</span>
            <IconChevron size={16} />
          </Card>
        ) : (
          <div className="skeleton hm-skel" aria-hidden="true" />
        )}
      </Section>

      {pending.length > 0 && (
        <Section title={t('home3.inPlay')} action={<span className="hm-count num">{pending.length}</span>}>
          <Card pad={false} className="hm-list">
            {pending.slice(0, 3).map((e) => (
              <PickRow key={e.id} e={e} onOpen={() => push({ name: 'entry', entryId: e.id })} />
            ))}
            {pending.length > 3 && (
              <button type="button" className="hm-more" onClick={() => go('pools')}>
                {t('home3.allPicks', { n: pending.length })}
                <IconChevron size={14} />
              </button>
            )}
          </Card>
        </Section>
      )}

      <StreakCard variant="compact" />

      {open.length > 1 && (
        <Section
          title={t('home3.open')}
          action={
            <button type="button" className="link-btn" onClick={() => go('live')}>
              {t('home3.all')} <IconChevron size={14} />
            </button>
          }
        >
          <Card pad={false} className="hm-list">
            {open.slice(1, 5).map((lp) => (
              <PoolRow key={lp.pool.pool_id} lp={lp} now={now} onOpen={() => openPool(lp)} />
            ))}
          </Card>
        </Section>
      )}

      <ProgressCard onOpen={() => push({ name: 'leaderboard' })} />

      {!runner && <p className="home__note muted">{t('home2.loadingSession')}</p>}
      {runner && <p className="home__note muted">{t('app.demoNote')}</p>}
    </div>
  );
}

function LiveCard({ onOpen }: { onOpen: () => void }) {
  const live = useLive((s) => s.live);
  const runner = useLive((s) => s.runner);
  const progress = useLive((s) => s.progress);
  const channelId = useLive((s) => s.channelId);
  const followId = useLive((s) => s.followId);
  const lang = getLang();
  const channel = CHANNELS.find((c) => c.id === channelId)!;
  const meta = CIRCUIT_META.find((c) => c.id === channel.circuitId);
  const circuit = runner?.circuit;
  const isQuali = channel.sessionType === 'QUALIFYING' || channel.sessionType === 'SPRINT_QUALIFYING';
  const mapCars = useMapCars(live, followId, null, []);
  const neutral = live && live.trackState !== 'GREEN' && live.trackState !== 'CHEQUERED' ? live.trackState : null;

  return (
    <Card className="hm-live" onClick={onOpen} ariaLabel={`${t('home.liveNow')}: ${channel.title[lang]}`}>
      <div className="hm-live__head">
        <span className="hm-live__on">
          <i aria-hidden="true" /> LIVE
        </span>
        {live && !isQuali && live.totalLaps !== null && (
          <span className="hm-live__lap num">
            {t('live.lap')} <b>{Math.max(1, Math.min(live.leaderLap, live.totalLaps))}</b>/{live.totalLaps}
          </span>
        )}
        {live?.segment && (
          <span className="hm-live__lap num">
            {live.segment.id} <b>{fmtCountdown(live.segment.remainingMs)}</b>
          </span>
        )}
      </div>
      <h2 className="hm-live__title">{channel.title[lang]}</h2>
      <div className="hm-live__sub">
        <span className="ellipsis">{meta?.shortName ?? circuit?.name}</span>
        {neutral && <span className={`hm-flag hm-flag--${neutral === 'RED' ? 'red' : 'sc'}`}>{t(`rc.${neutral}`)}</span>}
      </div>
      <div className="hm-live__body">
        <ol className="hm-tower" aria-label={t('home.liveTiming')}>
          {live
            ? live.cars.slice(0, 3).map((c) => (
                <li key={c.id} className={c.id === followId ? 'hm-tower__on' : undefined}>
                  <span className="num hm-tower__pos">{c.position}</span>
                  <TeamBar id={c.id} />
                  <b>{DRIVER_BY_ID[c.id]?.code}</b>
                  <span className="num hm-tower__gap">{c.position === 1 ? (isQuali ? fmtLap(c.segmentBestMs ?? null) : t('home2.leader')) : c.gapMs !== null ? fmtGap(c.gapMs, 1) : '—'}</span>
                </li>
              ))
            : [0, 1, 2].map((i) => <li key={i} className="skeleton hm-tower__skel" />)}
        </ol>
        <div className="hm-live__map">
          {circuit ? (
            <TrackMap circuit={circuit} cars={mapCars} width={150} height={104} padding={8} stale={live?.stale} showZones={false} showPit={false} glow={false} className="hm-map" />
          ) : (
            <span className="hm-live__sync num">
              {t('ui.syncing')} {Math.round(progress * 100)}%
            </span>
          )}
        </div>
      </div>
      <span className="hm-live__go">
        {t('home3.watch')} <IconArrow size={15} />
      </span>
    </Card>
  );
}

function NextPool({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  const ms = msUntilLock(lp.pool, now);
  const total = Date.parse(lp.pool.closes_at) - Date.parse(lp.pool.opens_at);
  const left = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0;
  const bank = Object.values(lp.book.stakes).reduce((a, b) => a + b, 0);
  const top = [...lp.pool.outcomes]
    .map((o) => ({ o, m: multiplier(lp.book, o.id) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 3);
  const urgent = ms < 10_000;
  return (
    <Card className="hm-next" onClick={onOpen} ariaLabel={`${tx.question}. ${t('home.locksIn')} ${fmtCountdown(ms)}`}>
      <div className="hm-next__meta">
        <span className="ellipsis">{tx.title}</span>
        <span className={`hm-next__timer num ${urgent ? 'hm-next__timer--urgent' : ''}`} role="timer">
          <IconTimer size={13} /> {fmtCountdown(ms)}
        </span>
      </div>
      <div className="hm-next__q">{tx.question}</div>
      <div className="hm-next__outs">
        {top.map(({ o, m }) => (
          <span key={o.id} className="hm-out">
            <span className="ellipsis">{outcomeShort(o, lp.pool)}</span>
            <b className="num">×{fmtOdds(m)}</b>
          </span>
        ))}
      </div>
      <div className="hm-next__bar" aria-hidden="true">
        <span style={{ width: `${left * 100}%` }} data-urgent={urgent || undefined} />
      </div>
      <div className="hm-next__foot">
        <span className="hm-next__bank">
          <span className="num">{fmtNumber(bank)}</span> {t('home3.bank')} · {t('ui.joined', { n: fmtNumber(lp.book.players) })}
        </span>
        <span className="btn btn--primary btn--sm hm-next__cta">
          {t('lv.predict')} <IconArrow size={15} />
        </span>
      </div>
    </Card>
  );
}

function PickRow({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const tx = poolTexts(e.pool);
  return (
    <button type="button" className="hm-row" onClick={onOpen}>
      <span className="hm-row__main">
        <span className="hm-row__q">{tx.question}</span>
        <span className="hm-row__sub ellipsis">
          {e.outcomeLabel} · <span className="num">{fmtNumber(e.stake)}</span>
        </span>
      </span>
      <span className="hm-row__side num">≈{fmtNumber(Math.round(e.stake * e.estimate))}</span>
      <IconChevron size={14} />
    </button>
  );
}

function PoolRow({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  const ms = msUntilLock(lp.pool, now);
  const best = Math.max(...lp.pool.outcomes.map((o) => multiplier(lp.book, o.id)));
  return (
    <button type="button" className="hm-row" onClick={onOpen}>
      <span className="hm-row__main">
        <span className="hm-row__q">{tx.question}</span>
        <span className="hm-row__sub ellipsis">
          {tx.title} · <span className={`num ${ms < 10_000 ? 'hm-urgent' : ''}`}>{fmtCountdown(ms)}</span>
        </span>
      </span>
      {Number.isFinite(best) && best < 50 && <span className="hm-row__side num">{t('home2.upTo', { x: fmtOdds(best) })}</span>}
      <IconChevron size={14} />
    </button>
  );
}

function ProgressCard({ onOpen }: { onOpen: () => void }) {
  const xp = useWallet((s) => s.xp);
  const entries = useWallet((s) => s.entries);
  const you = useYou();
  const lvl = levelFromXp(xp);
  const rank = useMemo(() => {
    const at = Date.now();
    return leaderboardWithYou('season', at, you, userPoints(entries, xp, 'season', at)).rank;
  }, [entries, xp, you.name, you.driverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.round((lvl.into / Math.max(1, lvl.need)) * 100);
  return (
    <Card className="hm-prog" onClick={onOpen} ariaLabel={`${t('shell.level', { n: lvl.level })}. ${t('home3.rank')} #${rank}`}>
      <span className="hm-prog__lvl num">{lvl.level}</span>
      <span className="hm-prog__main">
        <span className="hm-prog__top">
          <b>{t('shell.level', { n: lvl.level })}</b>
          <span className="num muted">{t('home3.toLevel', { n: fmtNumber(lvl.need - lvl.into), l: lvl.level + 1 })}</span>
        </span>
        <span className="hm-prog__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="hm-prog__rank">
        <span className="num">
          <IconTrophy size={13} />#{rank}
        </span>
        <small>{t('home3.rank')}</small>
      </span>
    </Card>
  );
}
