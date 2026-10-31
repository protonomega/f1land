/* Live overlay panels (workstream D): timing strip/tower, timing table, race-control feed, charts, pool cards, entries, follow card. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLive } from '@/store/live';
import { useNav } from '@/store/nav';
import { useWallet } from '@/store/wallet';
import { multiplier, usePools, type LivePool } from '@/demo/poolEngine';
import { DRIVER_BY_ID, TEAM_BY_ID } from '@/data/teams';
import type { LiveCar, Moment } from '@/sim/types';
import { fmtClock, fmtGap, fmtLap, fmtNumber, fmtOdds, fmtSec, t } from '@/i18n/core';
import { msUntilLock } from '@/domain/lifecycle';
import { marketTitle, outcomeShort, poolTexts } from '@/app/poolText';
import { useSessionNow } from '@/app/hooks';
import { LineChart, TyreBadge } from '@/ui/kit';
import { IconChevron, IconLock, IconPit } from '@/ui/icons';
import { haptic } from '@/telegram/sdk';
import { CountdownRing, PoolMeta } from './parts';
import { FlagGlyph, IcArrowUp, IcNo, IcPass, IcRetire, IcStopwatch, IcSwapCar, IcSwords, RcBadge } from './icons';

const teamColor = (id: string) => TEAM_BY_ID[DRIVER_BY_ID[id]?.teamId ?? '']?.color ?? '#888';

/* ------------------------------------------------------------------ */
/* Moments                                                             */
/* ------------------------------------------------------------------ */

export function momentText(m: Moment): string {
  const a = m.drivers[0] ? DRIVER_BY_ID[m.drivers[0]]?.lastName ?? m.drivers[0] : '';
  const b = m.drivers[1] ? DRIVER_BY_ID[m.drivers[1]]?.lastName ?? m.drivers[1] : '';
  switch (m.kind) {
    case 'PIT':
      return m.data?.service === 'DRIVE_THROUGH'
        ? t('moment.PIT_DT', { a })
        : t('moment.PIT', { a, stop: fmtSec(Number(m.data?.stopMs ?? 0), 1), tyre: t(`tyre.${String(m.data?.compound ?? 'medium').toLowerCase()}`) });
    case 'FASTEST_LAP':
      return t('moment.FASTEST_LAP', { a, time: fmtLap(Number(m.data?.ms ?? 0)) });
    case 'ELIMINATED':
      return t('moment.ELIMINATED', { a, seg: String(m.data?.segment ?? '') });
    case 'SEGMENT':
      return t('moment.SEGMENT', { seg: String(m.data?.segment ?? '') });
    default:
      return t(`moment.${m.kind}`, { a, b });
  }
}

/** Accent colour per moment kind (border / icon tint). */
export const MOMENT_TONE: Partial<Record<Moment['kind'], string>> = {
  OVERTAKE: 'var(--lime)',
  BATTLE: 'var(--orange)',
  PIT: 'var(--cyan)',
  FASTEST_LAP: 'var(--purple)',
  SC: 'var(--yellow)',
  VSC: 'var(--yellow)',
  RED: 'var(--red)',
  GREEN: 'var(--green)',
  RETIREMENT: 'var(--orange)',
  TRACK_LIMITS: 'var(--yellow)',
  ELIMINATED: 'var(--red)',
  FINISH: '#fff',
  START: 'var(--green)',
  SEGMENT: 'var(--cyan)',
};

export function MomentIcon({ kind, size = 18 }: { kind: Moment['kind']; size?: number }) {
  const tone = MOMENT_TONE[kind] ?? 'var(--text-2)';
  switch (kind) {
    case 'OVERTAKE':
      return <IcPass size={size} style={{ color: tone }} />;
    case 'BATTLE':
      return <IcSwords size={size} style={{ color: tone }} />;
    case 'PIT':
      return <IconPit size={size} className="icon" />;
    case 'FASTEST_LAP':
    case 'SEGMENT':
      return <IcStopwatch size={size} style={{ color: tone }} />;
    case 'SC':
      return <RcBadge text="SC" size={size - 2} />;
    case 'VSC':
      return <RcBadge text="VSC" size={size - 2} />;
    case 'RED':
      return <FlagGlyph color="#ff3b47" size={size} />;
    case 'GREEN':
    case 'START':
      return <FlagGlyph color="#3ddc84" size={size} />;
    case 'FINISH':
      return <FlagGlyph chequered size={size} />;
    case 'TRACK_LIMITS':
      return <FlagGlyph color="#ffd12e" size={size} />;
    case 'RETIREMENT':
      return <IcRetire size={size} style={{ color: tone }} />;
    case 'ELIMINATED':
      return <IcNo size={size} style={{ color: tone }} />;
    default:
      return <IcArrowUp size={size} />;
  }
}

/* ------------------------------------------------------------------ */
/* Gap helpers                                                         */
/* ------------------------------------------------------------------ */

function carGap(c: LiveCar, quali: boolean, interval: boolean): string {
  if (c.status !== 'ACTIVE') return 'OUT';
  if (c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP') return 'PIT';
  if (quali) return c.position === 1 ? fmtLap(c.segmentBestMs ?? null) : c.gapMs !== null ? fmtGap(c.gapMs) : '—';
  if (c.position === 1) return `${t('lv.lapShort')} ${c.driverLaps + 1}`;
  const v = interval ? c.intervalMs : c.gapMs;
  return v !== null ? fmtGap(v, 1) : '—';
}

/* ------------------------------------------------------------------ */
/* Compact timing strip (top-5 visible, horizontally scrollable)        */
/* ------------------------------------------------------------------ */

export function TowerStrip({ cars, followId, quali, cut, onPick }: { cars: LiveCar[]; followId: string | null; quali: boolean; cut: number | null; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the followed driver in view when it is outside the visible part.
  useEffect(() => {
    const node = ref.current?.querySelector<HTMLElement>('.tw-chip--on');
    if (node && ref.current) {
      const r = node.offsetLeft - ref.current.scrollLeft;
      if (r < 0 || r > ref.current.clientWidth - node.clientWidth) ref.current.scrollTo({ left: node.offsetLeft - 8, behavior: 'smooth' });
    }
  }, [followId]);
  return (
    <div className="tw-strip" aria-label={t('live.timing')}>
      <div className="tw-strip__scroll" ref={ref}>
        {cars.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`tw-chip ${c.id === followId ? 'tw-chip--on' : ''} ${c.status !== 'ACTIVE' || c.eliminatedIn ? 'tw-chip--out' : ''} ${quali && cut !== null && c.position === cut + 1 ? 'tw-chip--cut' : ''}`}
            style={{ ['--team' as string]: teamColor(c.id) }}
            onClick={() => onPick(c.id)}
            aria-label={`P${c.position} ${DRIVER_BY_ID[c.id]?.lastName ?? c.id}`}
            aria-pressed={c.id === followId}
          >
            <span className="tw-chip__top">
              <span className="tw-chip__pos num">{c.position}</span>
              <span className="tw-chip__code">{DRIVER_BY_ID[c.id]?.code}</span>
            </span>
            <span className={`tw-chip__gap num ${c.mode === 'PIT_LANE' || c.mode === 'PIT_STOP' ? 'cyan' : ''}`}>{carGap(c, quali, true)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Followed driver card                                                */
/* ------------------------------------------------------------------ */

/** Followed driver: one quiet row. Tapping it opens the driver picker (and the rival option). */
export function FollowCard({ car, cars, quali, onOpen }: { car: LiveCar; cars: LiveCar[]; quali: boolean; onOpen: () => void }) {
  const d = DRIVER_BY_ID[car.id]!;
  const team = TEAM_BY_ID[d.teamId]!;
  const ahead = cars.find((c) => c.position === car.position - 1) ?? null;
  const state = car.status !== 'ACTIVE' ? t(`status.${car.status}`) : car.occupancy !== 'ON_TRACK' ? t(`occ.${car.occupancy}`) : `S${car.sector}`;
  const value = quali ? fmtLap(car.segmentBestMs ?? null) : car.position === 1 ? t('lv.leader') : car.intervalMs !== null ? fmtGap(car.intervalMs, 1) : '—';
  const valueSub = quali ? t('live.bestLap') : car.position === 1 ? `${t('lv.lapShort')} ${car.driverLaps + 1}` : ahead ? `→ ${DRIVER_BY_ID[ahead.id]?.code}` : '';
  return (
    <button type="button" className="fc" style={{ ['--team' as string]: team.color }} onClick={onOpen} aria-label={`${t('live.changeDriver')}: P${car.position} ${d.lastName}`}>
      <span className="fc__tick" aria-hidden="true" />
      <span className="fc__who">
        <span className="fc__name">
          <span className="fc__pos num">P{car.position}</span>
          <b className="ellipsis">{d.lastName}</b>
        </span>
        <span className="fc__team">
          <span className="ellipsis">
            {team.shortName} · {state}
          </span>
          {!quali && (
            <span className="fc__tyre num">
              <TyreBadge compound={car.tyre} size={14} />
              {t('home2.laps', { n: car.tyreAgeLaps })}
            </span>
          )}
        </span>
      </span>
      <span className="fc__val">
        <b className="num">{value}</b>
        {valueSub && <small className="num">{valueSub}</small>}
      </span>
      <span className="fc__swap" aria-hidden="true">
        <IcSwapCar size={16} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Pools                                                               */
/* ------------------------------------------------------------------ */

export function PoolCard({ lp, now, onOpen, wide }: { lp: LivePool; now: number; onOpen: () => void; wide?: boolean }) {
  const tx = poolTexts(lp.pool);
  const mine = useWallet((s) => s.entries.some((e) => e.poolId === lp.pool.pool_id));
  const locked = lp.pool.status !== 'OPEN';
  const book = lp.book;
  const top = [...lp.pool.outcomes]
    .map((o) => ({ o, m: locked && book.finalMultipliers?.[o.id] ? book.finalMultipliers[o.id]! : multiplier(book, o.id) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 3);
  const ms = msUntilLock(lp.pool, now);
  const total = Date.parse(lp.pool.closes_at) - Date.parse(lp.pool.opens_at);
  const totalStake = Object.values(book.stakes).reduce((a, b) => a + b, 0);
  const winner = lp.pool.settlement?.winner_outcome_id ?? null;
  return (
    <div
      className={`pc ${wide ? 'pc--wide' : ''} ${mine ? 'pc--mine' : ''} ${locked ? 'pc--locked' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${tx.title}. ${tx.question}`}
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
    >
      <div className="pc__head">
        {locked ? (
          <span className="pc__lock">
            <IconLock size={16} />
          </span>
        ) : (
          <CountdownRing ms={ms} totalMs={total} size={40} label={`${t('pool.locksIn')} ${Math.ceil(ms / 1000)}`} />
        )}
        <div className="pc__titles">
          <div className="pc__kicker">
            <span className="ellipsis">{tx.title}</span>
            {mine && <span className="pc__mine">{t('lv.youreIn')}</span>}
            {locked && <span className={`pc__status pc__status--${lp.pool.status.toLowerCase()}`}>{t(`pool.status.${lp.pool.status}`)}</span>}
          </div>
          <div className="pc__q">{tx.question}</div>
        </div>
      </div>
      <div className="pc__outs">
        {top.map(({ o, m }) => (
          <span key={o.id} className={`pc__out ${winner === o.id ? 'pc__out--win' : ''}`}>
            <span className="pc__out-l">{outcomeShort(o, lp.pool)}</span>
            <b className="num">{fmtOdds(m)}x</b>
          </span>
        ))}
      </div>
      <div className="pc__foot">
        <PoolMeta total={totalStake} players={book.players} />
        <span className="pc__go">
          {locked ? t('lv.view') : t('lv.predict')} <IconChevron size={14} />
        </span>
      </div>
    </div>
  );
}

export function PoolsTab({ layout }: { layout: 'strip' | 'list' }) {
  const pools = usePools((s) => s.pools);
  const channelId = useLive((s) => s.channelId);
  const push = useNav((s) => s.push);
  const now = useSessionNow();
  const open = pools.filter((p) => p.pool.status === 'OPEN').sort((a, b) => b.priority - a.priority || Date.parse(a.pool.closes_at) - Date.parse(b.pool.closes_at));
  const pending = pools.filter((p) => p.pool.status === 'LOCKED' || p.pool.status === 'RESOLVING').slice(-6).reverse();
  const done = pools.filter((p) => p.pool.status === 'SETTLED' || p.pool.status === 'VOID').slice(-4).reverse();
  const openPool = (lp: LivePool) => push({ name: 'pool', channelId, poolId: lp.pool.pool_id });
  if (!open.length && !pending.length && !done.length) {
    return (
      <div className="lv-empty">
        <span className="lv-empty__pulse" />
        {t('pool.noPools')}
      </div>
    );
  }
  if (layout === 'strip') {
    return (
      <div className="pc-strip">
        {[...open, ...pending].map((lp) => (
          <PoolCard key={lp.pool.pool_id} lp={lp} now={now} onOpen={() => openPool(lp)} />
        ))}
        {!open.length && !pending.length && <div className="lv-empty">{t('pool.noPools')}</div>}
      </div>
    );
  }
  return (
    <div className="pc-list">
      {open.length > 0 && <GroupHead label={t('pool.liveMarkets')} count={open.length} tone="lime" />}
      {open.map((lp) => (
        <PoolCard key={lp.pool.pool_id} lp={lp} now={now} wide onOpen={() => openPool(lp)} />
      ))}
      {pending.length > 0 && <GroupHead label={t('pool.resolving')} count={pending.length} />}
      {pending.map((lp) => (
        <PoolCard key={lp.pool.pool_id} lp={lp} now={now} wide onOpen={() => openPool(lp)} />
      ))}
      {done.length > 0 && <GroupHead label={t('pool.settled')} count={done.length} />}
      {done.map((lp) => (
        <PoolCard key={lp.pool.pool_id} lp={lp} now={now} wide onOpen={() => openPool(lp)} />
      ))}
    </div>
  );
}

function GroupHead({ label, count, tone }: { label: string; count: number; tone?: 'lime' }) {
  return (
    <div className={`lv-group ${tone ? `lv-group--${tone}` : ''}`}>
      <span>{label}</span>
      <b className="num">{count}</b>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timing table                                                        */
/* ------------------------------------------------------------------ */

export function TimingTable({ cars, quali, followId, onPick }: { cars: LiveCar[]; quali: boolean; followId: string | null; onPick: (id: string) => void }) {
  const [interval, setInterval_] = useState(false);
  const fastest = Math.min(...cars.map((c) => c.bestLapMs ?? Infinity));
  return (
    <div className="tt" role="table" aria-label={t('live.timing')}>
      <div className="tt__head" role="row">
        <span>#</span>
        <span>{t('lv.driver')}</span>
        {quali ? (
          <span>{t('live.bestLap')}</span>
        ) : (
          <button type="button" className="tt__sort" aria-label={interval ? t('live.interval') : t('live.gap')} onClick={() => (haptic.tap(), setInterval_(!interval))}>
            {interval ? t('tt.int') : t('tt.gap')} <IcSwapCar size={11} />
          </button>
        )}
        <span>{t('tt.last')}</span>
        <span>{quali ? '' : t('live.tyre')}</span>
      </div>
      {cars.map((c) => {
        const d = DRIVER_BY_ID[c.id];
        return (
          <button key={c.id} type="button" role="row" className={`tt__row ${c.id === followId ? 'tt__row--on' : ''} ${c.eliminatedIn || c.status !== 'ACTIVE' ? 'tt__row--out' : ''}`} onClick={() => onPick(c.id)}>
            <span className="num tt__pos">{c.position}</span>
            <span className="tt__drv">
              <span className="tt__bar" style={{ background: teamColor(c.id) }} />
              <b>{d?.code}</b>
              <span className="tt__name ellipsis">{d?.lastName}</span>
              {c.pitStops > 0 && !quali && <span className="tt__pits num">{c.pitStops}×</span>}
            </span>
            <span className="num">{c.status !== 'ACTIVE' ? t(`status.${c.status}`).split(' ')[0] : quali ? fmtLap(c.segmentBestMs ?? null) : c.position === 1 ? '—' : fmtGap(interval ? c.intervalMs : c.gapMs, 1)}</span>
            <span className={`num ${c.bestLapMs === fastest && c.lastLapMs === c.bestLapMs ? 'purple' : c.lastLapMs && c.bestLapMs === c.lastLapMs ? 'tt__pb' : ''}`}>{fmtLap(c.lastLapMs)}</span>
            <span className="tt__tyre">
              {!quali && (
                <>
                  <TyreBadge compound={c.tyre} size={18} />
                  <small className="num">{c.tyreAgeLaps}</small>
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Race-control feed                                                   */
/* ------------------------------------------------------------------ */

export function EventsFeed({ moments }: { moments: Moment[] }) {
  const list = [...moments].reverse().filter((m) => m.kind !== 'BATTLE');
  if (!list.length) return <div className="lv-empty">{t('live.noEvents')}</div>;
  return (
    <ol className="rcf">
      {list.map((m) => (
        <li key={m.id} className={`rcf__row rcf__row--${m.kind.toLowerCase()}`} style={{ ['--tone' as string]: MOMENT_TONE[m.kind] ?? 'var(--stroke-2)' }}>
          <span className="rcf__lap num">{m.lap > 0 ? `L${m.lap}` : '—'}</span>
          <span className="rcf__dot" />
          <span className="rcf__icon">
            <MomentIcon kind={m.kind} />
          </span>
          <div className="rcf__body">
            <div className="rcf__text">{momentText(m)}</div>
            <div className="rcf__time num">{fmtClock(m.atMs, true)}</div>
          </div>
          {m.kind === 'TRACK_LIMITS' && <span className="badge badge--yellow">{t('entries.corrected')}</span>}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* My entries                                                          */
/* ------------------------------------------------------------------ */

export function MyEntries() {
  const runner = useLive((s) => s.runner);
  const all = useWallet((s) => s.entries);
  const entries = all.filter((e) => e.sessionId === runner?.manifest.session_id);
  const push = useNav((s) => s.push);
  if (!entries.length) return <div className="lv-empty">{t('live.noEntries')}</div>;
  return (
    <div className="me-list">
      {entries.map((e) => {
        const st = e.state === 'PENDING' ? 'pending' : e.state === 'WON' ? 'won' : e.state === 'LOST' ? 'lost' : 'void';
        return (
          <button key={e.id} type="button" className={`me me--${st}`} onClick={() => push({ name: 'entry', entryId: e.id })}>
            <div className="me__main">
              <div className="me__kicker ellipsis">{marketTitle(e.marketId)}</div>
              <div className="me__pick ellipsis">{e.outcomeLabel}</div>
              <div className="me__meta num">
                {fmtNumber(e.stake)} PULSE · {fmtOdds(e.finalMultiplier ?? e.estimate)}x
              </div>
            </div>
            <div className="me__side">
              <span className={`me__state me__state--${st}`}>{t(`entries.${st}`)}</span>
              <b className="num">{e.state === 'WON' ? `+${fmtNumber(e.payout)}` : e.state === 'VOID' ? `↺ ${fmtNumber(e.payout)}` : e.state === 'LOST' ? `−${fmtNumber(e.stake)}` : `≈${fmtNumber(Math.round(e.stake * e.estimate))}`}</b>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

type ChartKind = 'gap' | 'pos' | 'laps' | 'sectors';

export function Charts() {
  const runner = useLive((s) => s.runner);
  const live = useLive((s) => s.live);
  const followId = useLive((s) => s.followId);
  const rev = useLive((s) => s.eventRev);
  const [kind, setKind] = useState<ChartKind>('gap');
  const [zoom, setZoom] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const data = useMemo(() => {
    if (!runner) return null;
    const laps = new Map<string, number[]>();
    const positions = new Map<string, Array<number | null>>();
    const gaps = new Map<string, Array<number | null>>();
    const sectors = new Map<string, [number[], number[], number[]]>();
    for (const e of runner.events) {
      if (e.type === 'LAP_COMPLETED' && e.source_revision === '1' && !e.payload.pit_in_lap && !e.payload.pit_out_lap && !e.payload.neutralised) {
        const arr = laps.get(e.payload.driver_id) ?? [];
        arr.push(e.payload.lap_time_ms / 1000);
        laps.set(e.payload.driver_id, arr);
      } else if (e.type === 'TIMING_ORDER' && e.payload.anchor) {
        for (const o of e.payload.order) {
          const p = positions.get(o.driver_id) ?? [];
          p[e.payload.anchor.lap - 1] = o.position;
          positions.set(o.driver_id, p);
          const g = gaps.get(o.driver_id) ?? [];
          g[e.payload.anchor.lap - 1] = o.gap_to_leader_ms !== null ? o.gap_to_leader_ms / 1000 : o.position === 1 ? 0 : null;
          gaps.set(o.driver_id, g);
        }
      } else if (e.type === 'SECTOR_COMPLETED' && !e.payload.neutralised) {
        const s = sectors.get(e.payload.driver_id) ?? [[], [], []];
        s[e.payload.sector - 1].push(e.payload.sector_time_ms);
        sectors.set(e.payload.driver_id, s);
      }
    }
    return { laps, positions, gaps, sectors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, Math.floor(rev / 40)]);
  if (!data || !live) return null;
  const top = live.cars.slice(0, 5).map((c) => c.id);
  const ids = followId && !top.includes(followId) ? [...top, followId] : top;
  const shown = ids.filter((id) => !hidden.has(id));
  const fill = (arr: Array<number | null> | undefined) => Array.from({ length: arr?.length ?? 0 }, (_, i) => arr?.[i] ?? null);
  const cut = <T,>(arr: T[]) => (zoom ? arr.slice(-10) : arr);
  // First lap number shown on the x axis once the window is cut to the last 10.
  const n = (m: Map<string, unknown[]>) => Math.max(0, ...shown.map((id) => m.get(id)?.length ?? 0));
  const first = (len: number) => (zoom ? Math.max(1, len - 9) : 1);
  const line = <T extends number | null>(id: string, values: T[]) => ({ id, color: teamColor(id), values: cut(values), label: DRIVER_BY_ID[id]?.code, emphasis: id === followId });
  const best = (arr: number[]) => (arr.length ? Math.min(...arr) : null);
  const bestSector = [0, 1, 2].map((i) => Math.min(...[...data.sectors.values()].map((s) => best(s[i]) ?? Infinity)));
  const kinds: Array<{ id: ChartKind; label: string }> = [
    { id: 'gap', label: t('lv.chart.gap') },
    { id: 'pos', label: t('lv.chart.pos') },
    { id: 'laps', label: t('lv.chart.laps') },
    { id: 'sectors', label: t('lv.chart.sectors') },
  ];
  return (
    <div className="ch">
      <div className="ch__kinds" role="tablist" aria-label={t('live.graphs')}>
        {kinds.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={`ch__kind ${kind === k.id ? 'ch__kind--on' : ''}`} onClick={() => (haptic.tap(), setKind(k.id))}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="ch__head">
        <span className="ch__title">{t(`lv.chart.${kind}.title`)}</span>
        {kind !== 'sectors' && (
          <button type="button" className="ch__zoom" aria-pressed={zoom} onClick={() => (haptic.tap(), setZoom(!zoom))}>
            {zoom ? t('lv.chart.all') : t('lv.chart.last10')}
          </button>
        )}
      </div>
      <div className="ch__card">
        {kind === 'gap' && <LineChart invert series={shown.map((id) => line(id, fill(data.gaps.get(id))))} xStart={first(n(data.gaps))} yFormat={(v) => (v < 0.05 ? '0' : `+${v.toFixed(0)}s`)} xLabel={t('lv.lapShort')} height={180} />}
        {kind === 'pos' && <LineChart invert series={shown.map((id) => line(id, fill(data.positions.get(id))))} xStart={first(n(data.positions))} yFormat={(v) => `P${Math.round(v)}`} xLabel={t('lv.lapShort')} height={180} />}
        {kind === 'laps' && <LineChart series={shown.map((id) => line(id, data.laps.get(id) ?? []))} xStart={first(Math.max(0, ...shown.map((id) => data.laps.get(id)?.length ?? 0)))} yFormat={(v) => v.toFixed(1)} xLabel={t('lv.lapShort')} height={180} />}
        {kind === 'sectors' && (
          <div className="heat">
            <div className="heat__row heat__row--head">
              <span />
              <span>S1</span>
              <span>S2</span>
              <span>S3</span>
            </div>
            {live.cars.slice(0, 10).map((c) => {
              const s = data.sectors.get(c.id);
              return (
                <div key={c.id} className={`heat__row ${c.id === followId ? 'heat__row--on' : ''}`}>
                  <span className="heat__code">
                    <i style={{ background: teamColor(c.id) }} />
                    {DRIVER_BY_ID[c.id]?.code}
                  </span>
                  {[0, 1, 2].map((i) => {
                    const b = s ? best(s[i]) : null;
                    const delta = b !== null && Number.isFinite(bestSector[i]!) ? b - bestSector[i]! : null;
                    return (
                      <span key={i} className={`heat__cell num ${delta === 0 ? 'heat__cell--best' : ''}`}>
                        {delta === null ? '—' : delta === 0 ? fmtSec(b!) : `+${fmtSec(delta)}`}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {kind !== 'sectors' && (
        <div className="ch__legend" role="group" aria-label={t('lv.chart.drivers')}>
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={!hidden.has(id)}
              className={`ch__drv ${hidden.has(id) ? 'ch__drv--off' : ''} ${id === followId ? 'ch__drv--follow' : ''}`}
              onClick={() => {
                haptic.tap();
                const n = new Set(hidden);
                if (n.has(id)) n.delete(id);
                else if (shown.length > 1) n.add(id);
                setHidden(n);
              }}
            >
              <i style={{ background: teamColor(id) }} />
              {DRIVER_BY_ID[id]?.code}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span className="lv-pill" style={tone ? { ['--tone' as string]: tone } : undefined}>
      {children}
    </span>
  );
}
