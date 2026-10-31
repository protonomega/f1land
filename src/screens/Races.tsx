import { useMemo, useState } from 'react';
import { SEASON_2026, currentOrNextMeeting, meetingStatus, type CalendarSession, type Meeting, type MeetingStatus } from '@/data/calendar';
import { CHANNELS, channelLaps, getChannel, type DemoChannel } from '@/demo/channels';
import { usePools, multiplier, type LivePool } from '@/demo/poolEngine';
import { demoResults } from '@/demo/results';
import { previousStart } from '@/demo/schedule';
import { DRIVER_BY_ID } from '@/data/teams';
import { useNav } from '@/store/nav';
import { useLive } from '@/store/live';
import { Header, SubHeader } from '@/app/Header';
import { useSessionNow } from '@/app/hooks';
import { poolTexts } from '@/app/poolText';
import { msUntilLock } from '@/domain/lifecycle';
import { Card, DriverAvatar, TeamBar, useNow } from '@/ui/kit';
import { TrackMap } from '@/ui/TrackMap';
import { IconCalendar, IconCheck, IconChevron, IconMap, IconPlay, IconTimer, IconUsers } from '@/ui/icons';
import { flagEmoji, fmtClock, fmtCountdown, fmtDate, fmtDuration, fmtGap, fmtLap, fmtNumber, fmtOdds, getLang, t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { CircuitThumb, Empty, PageHead, Reveal, StatusPill, meetingDates, meetingName, safeMeta, useBack, useCircuit } from './common';



export function channelFor(m: Meeting, s?: CalendarSession): DemoChannel | undefined {
  return CHANNELS.find((c) => c.meetingRound === m.round && (!s || c.sessionType === s.sessionType));
}

export function watchChannel(ch: DemoChannel): void {
  haptic.impact('medium');
  sfx.nav();
  void useLive.getState().open(ch.id);
  useNav.getState().go('live');
}

type SessState = 'done' | 'live' | 'upcoming';
function sessState(s: CalendarSession, now: number): SessState {
  if (now >= Date.parse(s.endsAt)) return 'done';
  if (now >= Date.parse(s.startsAt)) return 'live';
  return 'upcoming';
}

/** Live session of the meeting, else the next one not yet started. */
function focusSession(m: Meeting, now: number): { s: CalendarSession; live: boolean } | null {
  const live = m.sessions.find((s) => sessState(s, now) === 'live');
  if (live) return { s: live, live: true };
  const next = m.sessions.find((s) => sessState(s, now) === 'upcoming');
  return next ? { s: next, live: false } : null;
}

/** "17 ч 16 мин" style countdown, ticking seconds only in the last hour. */
function startsIn(ms: number): string {
  if (ms < 3_600_000) return fmtCountdown(ms);
  return fmtDuration(ms);
}

/* ------------------------------------------------------------------ */
/* Races tab                                                           */
/* ------------------------------------------------------------------ */

// Calendars headline a race by its country; these read better than the CLDR names.
const COUNTRY: Record<string, { ru: string; en: string }> = {
  US: { ru: 'США', en: 'USA' },
  AE: { ru: 'Абу-Даби', en: 'Abu Dhabi' },
  GB: { ru: 'Великобритания', en: 'Great Britain' },
};
const regionNames = new Map<string, Intl.DisplayNames | null>();

export function countryName(cc: string): string {
  const lang = getLang();
  const own = COUNTRY[cc]?.[lang];
  if (own) return own;
  if (!regionNames.has(lang)) {
    try {
      regionNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }));
    } catch {
      regionNames.set(lang, null);
    }
  }
  return regionNames.get(lang)?.of(cc) ?? cc;
}

function monthShort(month: number): string {
  return new Intl.DateTimeFormat(getLang(), { month: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, month - 1, 15)).replace('.', '');
}

/** Calendar-style date chip from the meeting's local on-track days. */
function DateBlock({ m }: { m: Meeting }) {
  const [, m1, d1] = m.startDate.split('-').map(Number) as [number, number, number];
  const [, m2, d2] = m.endDate.split('-').map(Number) as [number, number, number];
  return (
    <span className="rc-date" aria-hidden="true">
      <b className="num">
        {d1}–{d2}
      </b>
      <small>{m1 === m2 ? monthShort(m1) : `${monthShort(m1)}–${monthShort(m2)}`}</small>
    </span>
  );
}

export function RacesScreen() {
  const now = useNow(1000);
  const push = useNav((s) => s.push);
  const [allResults, setAllResults] = useState(false);
  const minute = Math.floor(now / 60_000);
  const statuses = useMemo(() => new Map(SEASON_2026.map((m) => [m.id, meetingStatus(m, minute * 60_000 + 30_000)])), [minute]);
  const current = currentOrNextMeeting(now);
  const done = SEASON_2026.filter((m) => statuses.get(m.id) === 'COMPLETED').length;
  const ahead = SEASON_2026.filter((m) => m.round > current.round);
  const results = SEASON_2026.filter((m) => m.id !== current.id && statuses.get(m.id) === 'COMPLETED').reverse();
  const shown = allResults ? results : results.slice(0, 3);
  const open = (m: Meeting) => push({ name: 'meeting', meetingId: m.id });

  return (
    <>
      <Header />
      <PageHead title={t('races.title')} sub={t('scr.races.season', { d: done, n: SEASON_2026.length })} />
      <WeekendHero m={current} status={statuses.get(current.id)!} now={now} />

      {ahead.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">{t('scr.races.ahead')}</h2>
          </div>
          <Card pad={false} className="rc-list">
            {ahead.map((m) => (
              <RaceRow key={m.id} m={m} status={statuses.get(m.id)!} onOpen={() => open(m)} />
            ))}
          </Card>
        </section>
      )}

      {results.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">{t('races.results')}</h2>
          </div>
          <Card pad={false} className="rc-list">
            {shown.map((m) => (
              <RaceRow key={m.id} m={m} status="COMPLETED" onOpen={() => open(m)} />
            ))}
            {results.length > 3 && (
              <button
                type="button"
                className="rc-more"
                aria-expanded={allResults}
                onClick={() => {
                  haptic.tap();
                  setAllResults(!allResults);
                }}
              >
                {allResults ? t('ui.collapse') : t('scr.races.allResults', { n: results.length })}
                <IconChevron size={14} dir={allResults ? 'up' : 'down'} />
              </button>
            )}
          </Card>
        </section>
      )}
    </>
  );
}

/** Round, status, country headline, GP name, dates and circuit. Shared by the tab and the meeting screen. */
function RaceTitle({ m, status, as: H = 'h2' }: { m: Meeting; status: MeetingStatus; as?: 'h1' | 'h2' }) {
  const meta = safeMeta(m.circuitId);
  return (
    <span className="rc-title">
      <span className="rc-title__top">
        <span>
          {t('races.round', { n: m.round })}
          {m.sprint ? ` · ${t('scr.sprint')}` : ''}
        </span>
        {(status === 'LIVE' || status === 'NEXT') && <StatusPill status={status} />}
      </span>
      <H className="rc-title__name">
        <span className="flag">{flagEmoji(m.countryCode)}</span>
        <span>{countryName(m.countryCode)}</span>
      </H>
      <span className="rc-title__gp">{meetingName(m)}</span>
      <span className="rc-title__meta">
        {meetingDates(m)} · {meta?.shortName ?? meta?.name}
      </span>
    </span>
  );
}

/** The weekend's sessions as a track: done, live, next (lime) and still to come. */
function WeekendTimeline({ m, now }: { m: Meeting; now: number }) {
  const next = m.sessions.find((s) => sessState(s, now) !== 'done');
  return (
    <ol className="rc-tl" aria-label={t('races.sessions')}>
      {m.sessions.map((s) => {
        const at = Date.parse(s.startsAt);
        return (
          <li key={s.id} className="rc-tl__s" data-st={sessState(s, now)} data-next={s === next || undefined} aria-label={`${t(`session.${s.kind}`)}: ${fmtDate(at, { weekday: 'long' })}, ${fmtClock(at)}`}>
            <span className="rc-tl__k" aria-hidden="true">
              {t(`scr.sess.${s.kind}`)}
            </span>
            <span className="rc-tl__dot" aria-hidden="true" />
            <span className="rc-tl__d" aria-hidden="true">
              {fmtDate(at, { weekday: 'short' })}
            </span>
            <span className="rc-tl__t num" aria-hidden="true">
              {fmtClock(at)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WeekendHero({ m, status, now }: { m: Meeting; status: MeetingStatus; now: number }) {
  const push = useNav((s) => s.push);
  const focus = focusSession(m, now);
  const ch = channelFor(m, focus?.s) ?? channelFor(m);
  const open = () => {
    haptic.tap();
    push({ name: 'meeting', meetingId: m.id });
  };
  return (
    <section className="card rc-hero">
      <button type="button" className="rc-hero__head" onClick={open}>
        <RaceTitle m={m} status={status} />
        <CircuitThumb id={m.circuitId} size={104} className="rc-hero__track" cars={status === 'LIVE' ? ['#c6ff3d'] : undefined} />
      </button>
      {focus && (
        <div className="rc-hero__next">
          {focus.live ? (
            <b className="rc-hero__live">
              <span className="dot-live" aria-hidden="true" />
              {t('scr.races.liveNow', { s: t(`session.${focus.s.kind}`) })}
            </b>
          ) : (
            <>
              <b>{t(`session.${focus.s.kind}`)}</b>
              <span className="rc-hero__in num" role="timer">
                {t('scr.races.in', { t: startsIn(Date.parse(focus.s.startsAt) - now) })}
              </span>
            </>
          )}
        </div>
      )}
      <WeekendTimeline m={m} now={now} />
      <div className="rc-hero__actions">
        {ch && (
          <button className="btn btn--primary" onClick={() => watchChannel(ch)}>
            <IconPlay size={16} />
            {t('races.watchDemo')}
          </button>
        )}
        <button className="btn btn--ghost" onClick={open}>
          {t('scr.races.weekend')}
          <IconChevron size={16} />
        </button>
      </div>
    </section>
  );
}

function RaceRow({ m, status, onOpen }: { m: Meeting; status: MeetingStatus; onOpen: () => void }) {
  const meta = safeMeta(m.circuitId);
  const podium = status === 'COMPLETED' ? demoResults(m.id).filter((r) => !r.dnf).slice(0, 3) : null;
  const race = m.sessions.find((s) => s.kind === 'GRAND_PRIX');
  const raceAt = race ? Date.parse(race.startsAt) : null;
  return (
    <button type="button" className="rc-row" onClick={onOpen} aria-label={`${t('races.round', { n: m.round })}. ${meetingName(m)}, ${meetingDates(m)}`}>
      <DateBlock m={m} />
      <span className="rc-row__main">
        <span className="rc-row__name">
          <span className="flag">{flagEmoji(m.countryCode)}</span>
          <span className="ellipsis">{countryName(m.countryCode)}</span>
          {podium && <span className="rc-row__place ellipsis">{meta?.shortName}</span>}
        </span>
        {podium ? (
          <span className="rc-pod">
            {podium.map((r) => (
              <span key={r.driverId} className="rc-pod__d" data-pos={r.pos}>
                <TeamBar id={r.driverId} />
                {DRIVER_BY_ID[r.driverId]?.code}
              </span>
            ))}
          </span>
        ) : (
          <span className="rc-row__meta ellipsis">
            {meta?.shortName}
            {raceAt !== null && (
              <>
                {' · '}
                <span className="rc-row__when">
                  <span className="rc-row__k">{t('session.GRAND_PRIX')} </span>
                  {fmtDate(raceAt, { weekday: 'short' })} {fmtClock(raceAt)}
                </span>
              </>
            )}
            {m.sprint ? ` · ${t('scr.sprint')}` : ''}
          </span>
        )}
      </span>
      <CircuitThumb id={m.circuitId} size={40} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Meeting                                                             */
/* ------------------------------------------------------------------ */

export function MeetingScreen({ meetingId }: { meetingId: string }) {
  const back = useBack();
  const m = SEASON_2026.find((x) => x.id === meetingId);
  if (!m) return <NotFound onBack={back} />;
  return <MeetingBody m={m} />;
}

function MeetingBody({ m }: { m: Meeting }) {
  const back = useBack();
  const push = useNav((s) => s.push);
  const now = useNow(1000);
  const status = meetingStatus(m, now);
  const meta = safeMeta(m.circuitId);
  const circuit = useCircuit(m.circuitId);
  const channels = CHANNELS.filter((c) => c.meetingRound === m.round);
  const activeId = useLive((s) => s.channelId);
  const loading = useLive((s) => s.loading);
  const activeHere = channels.find((c) => c.id === activeId);
  const [showAll, setShowAll] = useState(false);
  const results = status === 'COMPLETED' ? demoResults(m.id) : null;
  let i = 0;
  return (
    <>
      <SubHeader onBack={back} />
      <Reveal i={i++}>
        <section className="card rc-hero rc-hero--static">
          <div className="rc-hero__head">
            <RaceTitle m={m} status={status} as="h1" />
            <CircuitThumb id={m.circuitId} size={104} className="rc-hero__track" cars={status === 'LIVE' ? ['#c6ff3d'] : undefined} />
          </div>
        </section>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.sessions')}</h2>
          <span className="sc-note">{t('races.localTime')}</span>
        </div>
        <Card pad={false} className="sc-sess-list">
          {m.sessions.map((s) => (
            <SessionRow key={s.id} m={m} s={s} now={now} />
          ))}
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.circuit')}</h2>
        </div>
        <Card onClick={() => push({ name: 'circuit', circuitId: m.circuitId })} ariaLabel={meta?.name ?? t('races.circuit')} className="sc-ccard">
          <div className="sc-ccard__top">
            <CircuitThumb id={m.circuitId} size={86} />
            <div className="sc-ccard__txt">
              <div className="sc-ccard__name">{meta?.name}</div>
              <div className="muted sc-ccard__loc">
                {flagEmoji(m.countryCode)} {meta?.location}, {meta?.country}
              </div>
              <span className="link-btn">
                <IconMap size={14} />
                {t('scr.circuit.open')}
              </span>
            </div>
            <IconChevron size={16} />
          </div>
          <div className="sc-kvgrid">
            <KV k={t('races.length')} v={meta ? `${fmtNumber(meta.lengthM / 1000, 3)} ${t('scr.km')}` : '—'} />
            <KV k={t('races.laps')} v={meta ? String(meta.laps) : '—'} />
            <KV k={t('races.record')} v={circuit ? fmtLap(circuit.lapRecordMs) : '—'} />
            <KV k={t('races.direction')} v={meta ? t(meta.direction === 'CW' ? 'races.cw' : 'races.ccw') : '—'} text />
            <KV k={t('scr.circuit.turns')} v={circuit ? String(circuit.corners.length) : '—'} />
            <KV k={t('scr.circuit.distance')} v={meta ? `${fmtNumber((meta.lengthM * meta.laps) / 1000, 1)} ${t('scr.km')}` : '—'} />
          </div>
        </Card>
      </Reveal>

      <Reveal i={i++} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('races.pools')}</h2>
          {activeHere && <span className="sc-note">DEMO · {t(`session.${activeHere.sessionType}`)}</span>}
        </div>
        {activeHere ? (
          <MeetingPools channel={activeHere} />
        ) : channels.length ? (
          <Card>
            <Empty
              icon={<IconUsers size={24} />}
              title={t('scr.meeting.poolsDemo')}
              body={t('scr.meeting.poolsDemoSub')}
              action={
                <div className="sc-btnrow">
                  {channels.map((c) => (
                    <button
                      key={c.id}
                      className="btn btn--ghost btn--sm"
                      disabled={loading}
                      onClick={() => {
                        haptic.tap();
                        void useLive.getState().open(c.id);
                      }}
                    >
                      <IconPlay size={14} />
                      {t(`session.${c.sessionType}`)}
                    </button>
                  ))}
                </div>
              }
            />
          </Card>
        ) : (
          <Card>
            <Empty icon={<IconTimer size={24} />} title={t('races.noPools')} body={t('scr.meeting.noDemo')} />
          </Card>
        )}
      </Reveal>

      {results && (
        <Reveal i={i++} className="section">
          <div className="section__head">
            <h2 className="section__title">{t('races.results')}</h2>
            <span className="sc-note">{t(`session.GRAND_PRIX`)}</span>
          </div>
          <Card pad={false} className="sc-results">
            {(showAll ? results : results.slice(0, 10)).map((r) => {
              const d = DRIVER_BY_ID[r.driverId];
              return (
                <button key={r.driverId} className="sc-res" data-pos={r.pos} onClick={() => push({ name: 'driver', driverId: r.driverId })}>
                  <span className="sc-res__pos num">{r.dnf ? 'DNF' : r.pos}</span>
                  <TeamBar id={r.driverId} />
                  <DriverAvatar id={r.driverId} size={28} />
                  <span className="sc-res__name">
                    <b>{d?.code}</b>
                    <span className="muted ellipsis">{d ? `${d.firstName} ${d.lastName}` : r.driverId}</span>
                  </span>
                  {r.fastestLap && <span className="sc-pill sc-pill--fl">{t('scr.fl')}</span>}
                  <span className="sc-res__gap num">{r.pos === 1 ? t('scr.winner') : r.dnf ? '—' : r.lapsDown ? t('scr.lapsDown', { n: r.lapsDown }) : fmtGap(r.gapMs, 3)}</span>
                  <span className="sc-res__pts num">{r.points ? `+${r.points}` : ''}</span>
                </button>
              );
            })}
            <button
              className="sc-res__more"
              onClick={() => {
                haptic.tap();
                setShowAll(!showAll);
              }}
            >
              {showAll ? t('ui.collapse') : t('scr.meeting.fullResults')}
              <IconChevron size={14} dir={showAll ? 'up' : 'down'} />
            </button>
          </Card>
          <p className="sc-fine">{t('scr.demoResultsNote')}</p>
        </Reveal>
      )}
    </>
  );
}

function KV({ k, v, tone, text }: { k: string; v: string; tone?: string; text?: boolean }) {
  return (
    <div className="sc-kv">
      <span className={`sc-kv__v ${text ? 'sc-kv__v--txt' : 'num'} ${tone ?? ''}`}>{v}</span>
      <span className="sc-kv__k">{k}</span>
    </div>
  );
}

function SessionRow({ m, s, now }: { m: Meeting; s: CalendarSession; now: number }) {
  const st = sessState(s, now);
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  const prev = previousStart(s.id);
  const ch = channelFor(m, s);
  const major = s.kind === 'GRAND_PRIX' || s.kind === 'SPRINT';
  return (
    <div className="sc-sess" data-st={st} data-major={major || undefined}>
      <div className="sc-sess__day">
        <span>{fmtDate(start, { weekday: 'short' })}</span>
        <b className="num">{new Date(start).getDate()}</b>
      </div>
      <div className="sc-sess__main">
        <div className="sc-sess__name">{t(`session.${s.kind}`)}</div>
        <div className="sc-sess__time num">
          {fmtClock(start)}–{fmtClock(end)}
        </div>
        {prev && (
          <div className="sc-sess__resched">
            <span className="badge badge--yellow">{t('races.rescheduled')}</span>
            <s className="muted">{t('races.wasAt', { time: fmtClock(Date.parse(prev)) })}</s>
          </div>
        )}
      </div>
      <div className="sc-sess__right">
        {st === 'done' && (
          <span className="sc-sess__done">
            <IconCheck size={14} />
            {t('session.status.FINISHED')}
          </span>
        )}
        {st === 'live' && (
          <span className="badge badge--live">
            LIVE
          </span>
        )}
        {st === 'upcoming' && <span className="sc-sess__in num">{t('scr.in', { d: start - now < 86_400_000 ? fmtCountdown(start - now) : fmtDuration(start - now) })}</span>}
        {ch && (
          <button className="sc-sess__watch" onClick={() => watchChannel(ch)} aria-label={`${t('races.watchDemo')}: ${t(`session.${s.kind}`)}`}>
            <IconPlay size={12} />
            DEMO
          </button>
        )}
      </div>
    </div>
  );
}

function MeetingPools({ channel }: { channel: DemoChannel }) {
  const pools = usePools((s) => s.pools);
  const push = useNav((s) => s.push);
  const loading = useLive((s) => s.loading);
  const now = useSessionNow();
  const open = pools.filter((p) => p.pool.status === 'OPEN').sort((a, b) => b.priority - a.priority);
  if (!open.length)
    return (
      <Card>
        <Empty
          icon={<IconTimer size={24} />}
          title={loading ? t('ui.syncing') : t('races.noPools')}
          action={
            <button className="btn btn--ghost btn--sm" onClick={() => watchChannel(channel)}>
              <IconPlay size={14} />
              {t('races.watchDemo')}
            </button>
          }
        />
      </Card>
    );
  return (
    <div className="sc-pools">
      {open.slice(0, 6).map((lp) => (
        <PoolRow key={lp.pool.pool_id} lp={lp} now={now} onOpen={() => push({ name: 'pool', channelId: channel.id, poolId: lp.pool.pool_id })} />
      ))}
    </div>
  );
}

function PoolRow({ lp, now, onOpen }: { lp: LivePool; now: number; onOpen: () => void }) {
  const tx = poolTexts(lp.pool);
  // Outcomes nobody has backed yet report the 50× cap; keep the range to priced outcomes.
  const xs = lp.pool.outcomes.map((o) => multiplier(lp.book, o.id)).filter((x) => x < 50);
  const lo = xs.length ? Math.min(...xs) : null;
  const hi = xs.length ? Math.max(...xs) : null;
  const ms = msUntilLock(lp.pool, now);
  return (
    <Card onClick={onOpen} ariaLabel={tx.question} className="sc-pool">
      <div className="sc-pool__top">
        <span className="sc-pool__fam">{tx.title}</span>
        <span className="sc-pool__lock num">
          <IconTimer size={12} />
          {fmtCountdown(ms)}
        </span>
      </div>
      <div className="sc-pool__q">{tx.question}</div>
      <div className="sc-pool__foot">
        <span className="muted">
          <IconUsers size={12} /> {t('ui.joined', { n: fmtNumber(lp.book.players) })}
        </span>
        {lo !== null && hi !== null && <span className="sc-pool__x num">{lo === hi ? `×${fmtOdds(lo)}` : `×${fmtOdds(lo)}–${fmtOdds(hi)}`}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Session (DEMO channel)                                              */
/* ------------------------------------------------------------------ */

export function SessionScreen({ channelId }: { channelId: string }) {
  const back = useBack();
  let ch: DemoChannel;
  try {
    ch = getChannel(channelId);
  } catch {
    return <NotFound onBack={back} />;
  }
  return <SessionBody ch={ch} />;
}

function SessionBody({ ch }: { ch: DemoChannel }) {
  const back = useBack();
  const push = useNav((s) => s.push);
  const lang = getLang();
  const circuit = useCircuit(ch.circuitId);
  const meta = safeMeta(ch.circuitId);
  const meeting = SEASON_2026.find((m) => m.round === ch.meetingRound);
  const activeId = useLive((s) => s.channelId);
  const live = useLive((s) => (s.channelId === ch.id ? s.live : null));
  const isActive = activeId === ch.id;
  const laps = meta ? channelLaps(ch, meta.laps, circuit?.sprintLaps) : null;
  const leader = live?.cars[0];
  const quali = ch.sessionType === 'QUALIFYING' || ch.sessionType === 'SPRINT_QUALIFYING';
  return (
    <>
      <SubHeader title={ch.title[lang]} onBack={back} />
      <Reveal i={0}>
        <Card glow pad={false} className="sc-sesshero">
          <div className="sc-sesshero__map">
            {circuit ? <TrackMap circuit={circuit} width={332} height={200} padding={18} showZones={false} /> : <div className="skeleton" style={{ height: 200 }} />}
          </div>
          <div className="sc-sesshero__body">
            <div className="sc-hero__top">
              <span className="sc-pill sc-pill--demo">DEMO</span>
              <span className="sc-hero__round">{t(`session.${ch.sessionType}`)}</span>
              {isActive && live && (
                <span className="badge badge--live">
                  LIVE
                </span>
              )}
            </div>
            <div className="sc-hero__name">
              <span className="flag">{flagEmoji(meta?.countryCode ?? '')}</span>
              <span>{meeting ? meetingName(meeting) : ch.title[lang]}</span>
            </div>
            <div className="sc-hero__circuit">{meta?.name}</div>
            <div className="sc-kvgrid sc-kvgrid--3">
              <KV k={quali ? t('scr.session.format') : t('races.laps')} v={quali ? (ch.sessionType === 'QUALIFYING' ? 'Q1·Q2·Q3' : 'SQ1·SQ2·SQ3') : String(laps ?? '—')} />
              <KV k={t('races.length')} v={meta ? `${fmtNumber(meta.lengthM / 1000, 3)} ${t('scr.km')}` : '—'} />
              <KV k={isActive && live ? t('scr.session.lap') : t('scr.session.status')} v={isActive && live ? `${live.leaderLap}/${live.totalLaps ?? '—'}` : t('scr.session.loop')} tone={isActive && live ? 'lime' : ''} />
            </div>
            {isActive && leader && (
              <div className="sc-sesshero__leader">
                <span className="muted">P1</span>
                <TeamBar id={leader.id} />
                <DriverAvatar id={leader.id} size={24} />
                <b>{DRIVER_BY_ID[leader.id]?.code}</b>
                <span className="muted num">{fmtLap(leader.bestLapMs)}</span>
              </div>
            )}
            <p className="sc-fine">{t('scr.session.about')}</p>
            <button className="btn btn--primary btn--block btn--lg" onClick={() => watchChannel(ch)}>
              <IconPlay size={18} />
              {isActive ? t('scr.session.backToLive') : t('scr.session.openLive')}
            </button>
          </div>
        </Card>
      </Reveal>
      <Reveal i={1} className="section">
        <div className="sc-btnrow sc-btnrow--split">
          {meeting && (
            <button className="btn btn--ghost" onClick={() => push({ name: 'meeting', meetingId: meeting.id })}>
              <IconCalendar size={16} />
              {t('scr.races.weekend')}
            </button>
          )}
          <button className="btn btn--ghost" onClick={() => push({ name: 'circuit', circuitId: ch.circuitId })}>
            <IconMap size={16} />
            {t('races.circuit')}
          </button>
        </div>
      </Reveal>
      <Reveal i={2} className="section">
        <div className="section__head">
          <h2 className="section__title">{t('scr.session.others')}</h2>
        </div>
        <div className="sc-chlist">
          {CHANNELS.filter((c) => c.id !== ch.id).map((c) => (
            <button key={c.id} className="sc-ch" onClick={() => push({ name: 'session', channelId: c.id })}>
              <CircuitThumb id={c.circuitId} size={40} />
              <span className="sc-ch__txt">
                <span className="ellipsis">{c.title[lang]}</span>
                <span className="muted">{t(`session.${c.sessionType}`)}</span>
              </span>
              {c.id === activeId && <span className="dot-live" />}
              <IconChevron size={14} />
            </button>
          ))}
        </div>
      </Reveal>
    </>
  );
}

export function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SubHeader title={t('scr.notFound')} onBack={onBack} />
      <Card>
        <Empty icon={<IconMap size={24} />} title={t('scr.notFound')} body={t('scr.notFoundSub')} />
      </Card>
    </>
  );
}
