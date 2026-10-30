/* Pool state cards: "you're in" while open, then locked / resolving / void / settled with proof. */
import { type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { LivePool } from '@/demo/poolEngine';
import { multiplier } from '@/demo/poolEngine';
import type { Entry } from '@/store/wallet';
import type { Outcome, Pool } from '@/domain/types';
import { outcomeLabel, poolTexts } from '@/app/poolText';
import { headlineValues } from '@/app/settlementText';
import { previousFinalSettlement, settlementPhase } from '@/domain/settlement';
import { fmtClock, fmtNumber, fmtOdds, fmtSec, plural, t } from '@/i18n/core';
import { IconCheck, IconChevron, IconLock, IconRefund } from '@/ui/icons';
import { FlagGlyph, IcTrophy } from './icons';
import { outcomeIcon } from './poolFamilies';
import { CountUp } from './motionBits';

type OpenEntry = (id: string) => void;

const picksWord = (n: number) => plural(n, { ru: ['выбор', 'выбора', 'выборов'], en: ['pick', 'picks'] });

/** Multiplier for an entry: final (locked book) when known, else the live estimate. */
function entryMult(lp: LivePool, e: Entry): number {
  return lp.book.finalMultipliers?.[e.outcomeId] ?? e.finalMultiplier ?? multiplier(lp.book, e.outcomeId);
}

/* ------------------------------------------------------------------ */
/* Open pool: the user's live picks                                    */
/* ------------------------------------------------------------------ */

export function InPlayCard({ lp, entries, onOpen }: { lp: LivePool; entries: Entry[]; onOpen: OpenEntry }) {
  if (!entries.length) return null;
  const staked = entries.reduce((a, e) => a + e.stake, 0);
  return (
    <motion.section className="rs rs--in" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }} aria-live="polite">
      <div className="rs__head">
        <span className="rs__radar" aria-hidden="true">
          <i />
          <i />
          <IconCheck size={18} />
        </span>
        <div className="rs__t">
          <b>
            {t('pool2.inPlay')} · {entries.length} {picksWord(entries.length)}
          </b>
          <span>{t('pool2.inPlaySub')}</span>
        </div>
        <span className="rs__amt num">
          {fmtNumber(staked)}
          <small>PULSE</small>
        </span>
      </div>
      <EntryRows lp={lp} entries={entries} onOpen={onOpen} />
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Closed pool: suspended / locked / resolving / void / settled        */
/* ------------------------------------------------------------------ */

export function PoolStateCard({ lp, entries, blockKey, onOpen }: { lp: LivePool; entries: Entry[]; blockKey: string | null; onOpen: OpenEntry }) {
  const pool = lp.pool;

  if (pool.status === 'OPEN' && pool.intake_status === 'SUSPENDED') {
    return (
      <section className="rs rs--red" role="status">
        <span className="rs__ico" aria-hidden="true">
          <FlagGlyph color="#ff3b47" size={22} />
        </span>
        <div className="rs__t">
          <b>{t('pool.suspended')}</b>
          <span>{t(blockKey ?? 'pool.lockedNow')}</span>
        </div>
      </section>
    );
  }

  if (pool.status === 'VOID') return <VoidCard lp={lp} entries={entries} onOpen={onOpen} />;
  if (pool.status === 'SETTLED') return <SettledCard lp={lp} entries={entries} onOpen={onOpen} />;

  // OPEN-but-closed (lock reached before the status tick), LOCKED, RESOLVING — and pre-open states.
  const resolving = pool.status === 'RESOLVING';
  const notOpen = pool.status === 'DRAFT' || pool.status === 'SCHEDULED';
  const tx = poolTexts(pool);
  const lockedRet = entries.reduce((a, e) => a + Math.round(e.stake * entryMult(lp, e)), 0);
  return (
    <section className="rs rs--wait" role="status">
      <div className="rs__head">
        <span className="rs__radar" aria-hidden="true">
          <i />
          <i />
          {resolving ? <span className="cf__spin" /> : <IconLock size={17} />}
        </span>
        <div className="rs__t">
          <b>{notOpen ? t('f1.entry.not_open') : resolving ? t('pl.state.resolving') : t('pl.state.locked')}</b>
          <span>{resolving ? t('pl.state.resolvingSub') : t('pl.state.lockedSub')}</span>
        </div>
      </div>
      <div className="rs__scan" aria-hidden="true">
        <span />
      </div>
      <dl className="rs__facts">
        <div>
          <dt>{t('pool.determinedBy')}</dt>
          <dd>{tx.determinant}</dd>
        </div>
        <div>
          <dt>{t('pool2.settlesBy')}</dt>
          <dd className="num">{fmtClock(Date.parse(pool.settlement_deadline), true)}</dd>
        </div>
      </dl>
      {entries.length > 0 && (
        <div className="rs__locked-ret">
          <span>{t('pool2.lockedReturn')}</span>
          <span className="num">
            <b>≈ {fmtNumber(lockedRet)}</b> <small>PULSE</small>
          </span>
        </div>
      )}
      <EntryRows lp={lp} entries={entries} onOpen={onOpen} />
    </section>
  );
}

function VoidCard({ lp, entries, onOpen }: { lp: LivePool; entries: Entry[]; onOpen: OpenEntry }) {
  const reason = lp.pool.settlement?.void_reason;
  const refunded = entries.reduce((a, e) => a + (e.state === 'VOID' ? e.payout || e.stake : e.stake), 0);
  return (
    <section className="rs rs--void" role="status">
      <div className="rs__head">
        <span className="rs__ico" aria-hidden="true">
          <IconRefund size={20} />
        </span>
        <div className="rs__t">
          <b>{t('f1.void.title')}</b>
          <span>{reason ? t(`f1.void.${reason.toLowerCase()}`) : t('pl.state.refund')}</span>
        </div>
        {entries.length > 0 && (
          <span className="rs__amt rs__amt--void num">
            ↺ {fmtNumber(refunded)}
            <small>{t('pool2.refunded')}</small>
          </span>
        )}
      </div>
      <EntryRows lp={lp} entries={entries} onOpen={onOpen} />
    </section>
  );
}

function SettledCard({ lp, entries, onOpen }: { lp: LivePool; entries: Entry[]; onOpen: OpenEntry }) {
  const pool = lp.pool;
  const s = pool.settlement;
  const winner = pool.outcomes.find((o) => o.id === s?.winner_outcome_id) ?? null;
  const won = entries.filter((e) => e.state === 'WON');
  const lost = entries.filter((e) => e.state === 'LOST');
  const payout = won.reduce((a, e) => a + e.payout, 0);
  const lostStake = lost.reduce((a, e) => a + e.stake, 0);
  const kind = won.length ? 'won' : lost.length ? 'lost' : 'neutral';
  const phase = settlementPhase(pool);
  const prev = previousFinalSettlement(pool);
  const prevWinner = prev ? pool.outcomes.find((o) => o.id === prev.winner_outcome_id) : undefined;
  const tx = poolTexts(pool);
  const winMult = winner ? (lp.book.finalMultipliers?.[winner.id] ?? null) : null;
  const myLosingPick = !won.length && lost.length ? lost[0] : null;

  return (
    <motion.section className={`rc rc--${kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }} role="status">
      {kind === 'won' && <span className="rc__sweep" aria-hidden="true" />}
      <div className="rc__head">
        <span className="rc__badge" aria-hidden="true">
          {kind === 'won' ? <IcTrophy size={24} /> : kind === 'lost' ? <IconLock size={19} /> : <IconCheck size={20} />}
        </span>
        <div className="rc__t">
          <small>{t('pool2.result')}</small>
          <b>{kind === 'won' ? t('pl.res.won') : kind === 'lost' ? t('pl.res.lost') : winner ? t('pl.state.winner', { o: outcomeLabel(winner, pool.market_id) }) : t('pool.settled')}</b>
          <span>{kind === 'won' ? t('pl.res.wonSub') : kind === 'lost' ? t('pl.res.lostSub') : entries.length ? t('pl.state.settledSub') : t('pool2.noPick')}</span>
        </div>
        {kind === 'won' && (
          <span className="rc__amt rc__amt--won num">
            <span>
              +<CountUp value={payout} duration={900} />
            </span>
            <small>PULSE</small>
          </span>
        )}
        {kind === 'lost' && (
          <span className="rc__amt rc__amt--lost num">
            −{fmtNumber(lostStake)}
            <small>PULSE</small>
          </span>
        )}
      </div>

      {winner && (
        <div className="rc__winner">
          <span className="rc__k">{t('pool2.winning')}</span>
          <div className="rc__win-row">
            <span className="rc__win-ico">{outcomeIcon(winner, pool, 20)}</span>
            <b className="rc__win-label">{outcomeLabel(winner, pool.market_id)}</b>
            {winMult !== null && <span className="rc__win-odds num">{fmtOdds(winMult)}x</span>}
          </div>
          {myLosingPick && <div className="rc__mine-line">{t('pool2.yourPick', { o: myLosingPick.outcomeLabel })}</div>}
        </div>
      )}

      {s && (
        <dl className="rc__proof">
          <div className="rc__item">
            <dt>{t('pool2.rule')}</dt>
            <dd>
              <span className="rc__rule">{tx.rule}</span>
              <BucketRule pool={pool} winner={winner} values={s.normalized_values} />
            </dd>
          </div>
          <MeasuredItem values={s.normalized_values} />
          <div className="rc__item">
            <dt>{t('pool2.status')}</dt>
            <dd>
              {phase === 'CORRECTED' ? (
                <span className="rc__corr rc__corr--fixed">{t('pool2.corrected', { o: prevWinner ? outcomeLabel(prevWinner, pool.market_id) : (prev?.void_reason ?? '—') })}</span>
              ) : s.provisional ? (
                <span className="rc__corr rc__corr--prov">{t('pool2.provisional')}</span>
              ) : (
                <span className="rc__corr rc__corr--final">{t('pool2.final', { n: s.settlement_revision })}</span>
              )}
              <small className="num">
                {fmtClock(Date.parse(s.determined_at), true)} · {t('pool2.evidence', { n: s.evidence_source_event_ids.length })}
              </small>
            </dd>
          </div>
        </dl>
      )}

      <EntryRows lp={lp} entries={entries} onOpen={onOpen} />
    </motion.section>
  );
}

function MeasuredItem({ values }: { values: Record<string, string | number | boolean | null> }) {
  const vals = headlineValues({ normalized_values: values });
  if (!vals.length) return null;
  return (
    <div className="rc__item">
      <dt>{t('pool2.measured')}</dt>
      <dd>
        <div className="rc__vals">
          {vals.map((v) => (
            <span key={v.k} className="rc__val">
              <small>{v.label}</small>
              <b className="num">{v.value}</b>
            </span>
          ))}
        </div>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bucket rule: where the measured time landed ([from, to) ranges)     */
/* ------------------------------------------------------------------ */

const BUCKET_VALUE: Partial<Record<Pool['market_id'], string>> = {
  'F1-M05': 'stop_duration_ms',
  'F1-M06': 'lane_duration_ms',
  'F1-M19': 'sector_time_ms',
};

function BucketRule({ pool, winner, values }: { pool: Pool; winner: Outcome | null; values: Record<string, string | number | boolean | null> }) {
  const key = BUCKET_VALUE[pool.market_id];
  const { t1_ms: t1, t2_ms: t2 } = pool.target.parameters;
  if (!key || t1 === undefined || t2 === undefined) return null;
  const v = values[key];
  const measured = typeof v === 'number' ? v : null;
  const digits = pool.market_id === 'F1-M19' ? 2 : 1;
  const s = (ms: number) => fmtSec(ms, digits);
  // Equal-width segments; the open-ended third spans one more range width.
  const span = Math.max(1, t2 - t1);
  const pos = measured === null ? null : measured < t1 ? (measured / Math.max(1, t1)) / 3 : measured < t2 ? 1 / 3 + ((measured - t1) / span) / 3 : 2 / 3 + Math.min(1, (measured - t2) / span) / 3;
  const segs: Array<{ id: string; text: ReactNode }> = [
    { id: 'BUCKET_1', text: `< ${s(t1)}` },
    { id: 'BUCKET_2', text: `${s(t1)}–${s(t2)}` },
    { id: 'BUCKET_3', text: `≥ ${s(t2)}` },
  ];
  return (
    <div className="brule">
      <div className="brule__bar">
        {segs.map((g) => (
          <span key={g.id} className={`brule__seg num ${winner?.id === g.id ? 'brule__seg--win' : ''}`}>
            {g.text} s
          </span>
        ))}
        {pos !== null && (
          <span className="brule__mark" style={{ left: `${Math.max(0.5, Math.min(99.5, pos * 100))}%` }}>
            <b className="num">{fmtSec(measured!, 3)}</b>
          </span>
        )}
      </div>
      <span className="brule__note">{t('pool2.bucketNote', { t: `${s(t2)} s` })}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Entry rows                                                          */
/* ------------------------------------------------------------------ */

function EntryRows({ lp, entries, onOpen }: { lp: LivePool; entries: Entry[]; onOpen: OpenEntry }) {
  if (!entries.length) return null;
  return (
    <div className="erows">
      {entries.map((e) => {
        const m = entryMult(lp, e);
        const val = e.state === 'WON' ? `+${fmtNumber(e.payout)}` : e.state === 'LOST' ? `−${fmtNumber(e.stake)}` : e.state === 'VOID' ? `↺ ${fmtNumber(e.payout || e.stake)}` : `≈ ${fmtNumber(Math.round(e.stake * m))}`;
        return (
          <button key={e.id} type="button" className="erow" onClick={() => onOpen(e.id)} aria-label={`${e.outcomeLabel} · ${t('pool2.openProof')}`}>
            <span className="erow__pick">
              <b>{e.outcomeLabel}</b>
              <small className="num">
                {fmtNumber(e.stake)} PULSE · {fmtOdds(m)}x · {fmtClock(e.createdAt, true)}
              </small>
            </span>
            <b className={`erow__val num erow__val--${e.state.toLowerCase()}`}>{val}</b>
            <IconChevron size={14} />
          </button>
        );
      })}
    </div>
  );
}
