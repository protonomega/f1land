import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNav, type TabId } from '@/store/nav';
import { useLive } from '@/store/live';
import { t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';
import { sfx } from '@/audio/sfx';
import { IconFlag, IconHome, IconPulse, IconTrophy, IconUser, NavCar } from './icons';
import { useSettings, prefersReducedMotion } from '@/store/settings';
import { useWallet } from '@/store/wallet';

// Screen enter transitions read the direction from <html data-nav-dir>. Zustand notifies
// synchronously inside set(), so the attribute is in place before the next screen mounts.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.navDir = '0';
  useNav.subscribe((s, prev) => {
    if (s.stack !== prev.stack || s.tab !== prev.tab) document.documentElement.dataset.navDir = String(s.dir);
  });
}

const TABS: Array<{ id: TabId; icon: typeof IconHome; key: string }> = [
  { id: 'home', icon: IconHome, key: 'nav.home' },
  { id: 'races', icon: IconFlag, key: 'nav.races' },
  { id: 'live', icon: IconPulse, key: 'nav.live' },
  { id: 'pools', icon: IconTrophy, key: 'nav.pools' },
  { id: 'profile', icon: IconUser, key: 'nav.profile' },
];

/** Car length in px; keep in sync with `.nav__car` width. */
const CAR_LEN = 46;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';

type Flag = 'live' | 'sc' | null;

/** Race-status dot on the Live tab: red while a session runs, yellow under SC/VSC. */
function useLiveFlag(): Flag {
  return useLive((s) => {
    const l = s.live;
    if (!l || l.stale) return null;
    if (l.status !== 'STARTED' && l.status !== 'RESUMED' && l.status !== 'FORMATION' && l.status !== 'SUSPENDED') return null;
    return /^(SC|VSC)/.test(l.trackState) ? 'sc' : 'live';
  });
}

function puff(lane: HTMLElement, x: number, y: number, drift: number, size = 9, delay = 0) {
  const el = document.createElement('span');
  el.className = 'nav__puff';
  el.style.left = `${x - size / 2}px`;
  el.style.top = `${y - size / 2}px`;
  el.style.width = el.style.height = `${size}px`;
  lane.appendChild(el);
  const a = el.animate(
    [
      { transform: 'translate(0,0) scale(0.35)', opacity: 0.85 },
      { transform: `translate(${drift}px, ${-3 - Math.random() * 3}px) scale(2.3)`, opacity: 0 },
    ],
    { duration: 560 + Math.random() * 180, delay, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'backwards' },
  );
  a.onfinish = a.oncancel = () => el.remove();
}

/**
 * Bottom navigation. The bar's top edge is the track: a top-down F1 car rides on it and tows
 * the recessed "pit box" that marks the active tab. Switching tabs drives it there: a pivot
 * (with tyre smoke) when it has to turn round, launch, a light trail along the edge, rain light
 * on braking, and a suspension settle as it pulls into the box. Tabs it passes flinch in its
 * slipstream. Tapping the active tab scrolls the screen to the top and the car revs in place.
 *
 * Navigation itself is instant; the drive is purely decorative and is skipped under
 * reduced motion.
 */
export function NavBar({ hidden }: { hidden?: boolean }) {
  const tab = useNav((s) => s.tab);
  const go = useNav((s) => s.go);
  const pending = useWallet((s) => s.entries.reduce((n, e) => n + (e.state === 'PENDING' ? 1 : 0), 0));
  const flag = useLiveFlag();
  const motion = useSettings((s) => s.motion);
  const reduced = prefersReducedMotion(motion);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced);
  }, [reduced]);

  const laneRef = useRef<HTMLDivElement>(null);
  const carRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const chassisRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  // x: car centre in lane px; yaw: degrees, 0 = nose right, -180 = nose left.
  const sim = useRef({ x: null as number | null, yaw: 0, raf: 0 });

  const centreOf = (i: number) => {
    const el = items.current[i];
    return el ? el.offsetLeft + el.offsetWidth / 2 : 0;
  };

  const place = (x: number, yaw: number) => {
    sim.current.x = x;
    sim.current.yaw = yaw;
    carRef.current!.style.transform = `translate3d(${x}px,0,0)`;
    if (slotRef.current) slotRef.current.style.transform = `translate3d(${x}px,0,0)`;
    bodyRef.current!.style.transform = `rotate(${yaw}deg)`;
    const well = wellRef.current;
    const tabW = items.current[0]?.offsetWidth;
    if (well && tabW) {
      const w = Math.min(76, tabW - 10);
      well.style.width = `${w}px`;
      well.style.marginLeft = `${-w / 2}px`;
    }
  };

  useLayoutEffect(() => {
    const car = carRef.current;
    const lane = laneRef.current;
    const trail = trailRef.current;
    if (!car || !lane || !trail) return;
    const idx = TABS.findIndex((x) => x.id === tab);
    const to = centreOf(idx);
    const s = sim.current;
    cancelAnimationFrame(s.raf);
    if (s.x === null || reduced || hidden || Math.abs(to - s.x) < 1) {
      place(to, s.x === null ? 0 : s.yaw);
      return;
    }

    const from = s.x;
    const dir = to > from ? 1 : -1;
    const dist = Math.abs(to - from);
    const yaw0 = s.yaw;
    const yaw1 = dir > 0 ? 0 : -180;
    const turning = Math.abs(yaw1 - yaw0) > 1;
    // A U-turn needs a moment before the car can launch.
    const pivot = turning ? 170 : 0;
    const run = Math.min(640, 300 + dist * 1.05);
    const total = pivot + run;
    const passed = TABS.map((_, i) => i).filter((i) => (dir > 0 ? centreOf(i) > from + 4 && centreOf(i) < to - 4 : centreOf(i) < from - 4 && centreOf(i) > to + 4));
    const woken = new Set<number>();
    const midY = car.offsetTop + car.offsetHeight / 2;
    const rearOffset = CAR_LEN * 0.36;
    let braking = false;
    let launched = false;

    if (turning) {
      // Smoke from both rear tyres as it pivots.
      puff(lane, from - Math.sign(Math.cos((yaw0 * Math.PI) / 180)) * rearOffset, midY - 5, -dir * 6, 10);
      puff(lane, from - Math.sign(Math.cos((yaw0 * Math.PI) / 180)) * rearOffset, midY + 5, -dir * 6, 10, 40);
    }
    car.dataset.moving = '';
    const t0 = performance.now();

    // performance.now() rather than the rAF timestamp: some Android WebViews pass an epoch-based value.
    const step = () => {
      const el = performance.now() - t0;
      let x = from;
      let yaw = yaw0;
      let speed = 0;
      if (el < pivot) {
        const k = el / pivot;
        const e = k * k * (3 - 2 * k);
        yaw = yaw0 + (yaw1 - yaw0) * e;
        x = from + dir * 3 * e;
      } else {
        yaw = yaw1;
        if (!launched) {
          launched = true;
          puff(lane, from - dir * rearOffset, midY, -dir * 10, 8);
        }
        const k = Math.min(1, (el - pivot) / run);
        // Launch hard, then brake later and harder than a symmetric ease.
        const e = k < 0.55 ? 1.6529 * k * k : 1 - 2.2222 * (1 - k) * (1 - k);
        speed = k < 0.55 ? k / 0.55 : (1 - k) / 0.45;
        x = (turning ? from + dir * 3 : from) + (to - (turning ? from + dir * 3 : from)) * e;
        if (!braking && k >= 0.55) {
          braking = true;
          car.dataset.brake = '';
        }
        for (const i of passed) {
          if (!woken.has(i) && (dir > 0 ? x >= centreOf(i) : x <= centreOf(i))) {
            woken.add(i);
            items.current[i]?.querySelector('.nav__icon')?.animate(
              [
                { transform: 'none' },
                { transform: `translate(${dir * 3}px, -2px) rotate(${-dir * 12}deg)`, offset: 0.28 },
                { transform: 'none' },
              ],
              { duration: 460, easing: SPRING },
            );
          }
        }
      }
      sim.current.x = x;
      sim.current.yaw = yaw;
      car.style.transform = `translate3d(${x}px,0,0)`;
      if (slotRef.current) slotRef.current.style.transform = `translate3d(${x}px,0,0)`;
      bodyRef.current!.style.transform = `rotate(${yaw}deg) scaleX(${1 + speed * 0.07})`;
      // The box stretches behind the car at speed, then snaps back as it parks.
      if (wellRef.current) wellRef.current.style.transform = `scaleX(${1 + speed * 0.18})`;
      const len = Math.min(78, dist * 0.5) * speed;
      trail.style.width = `${len}px`;
      trail.style.opacity = String(Math.min(1, speed * 1.4));

      if (el < total) {
        s.raf = requestAnimationFrame(step);
        return;
      }
      place(to, yaw1);
      trail.style.opacity = '0';
      if (wellRef.current) wellRef.current.style.transform = '';
      delete car.dataset.moving;
      // Rain light lingers a beat after the stop, like a real car.
      window.setTimeout(() => delete car.dataset.brake, 260);
      chassisRef.current?.animate(
        [{ transform: 'none' }, { transform: `translateX(${dir * 2.5}px) scaleX(0.97)` }, { transform: `translateX(${-dir * 0.8}px)` }, { transform: 'none' }],
        { duration: 340, easing: 'ease-out' },
      );
      items.current[idx]?.querySelector('.nav__icon')?.animate(
        [{ transform: 'none' }, { transform: 'translateY(-3px) scale(1.16)' }, { transform: 'none' }],
        { duration: 420, easing: SPRING },
      );
    };
    s.raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(s.raf);
      delete car.dataset.moving;
      delete car.dataset.brake;
      trail.style.opacity = '0';
      if (wellRef.current) wellRef.current.style.transform = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reduced, hidden]);

  // Re-park on layout changes (rotation, Telegram viewport resize, font load).
  useEffect(() => {
    const nav = laneRef.current?.parentElement;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const s = sim.current;
      if (s.x === null) return;
      cancelAnimationFrame(s.raf);
      place(centreOf(TABS.findIndex((x) => x.id === useNav.getState().tab)), s.yaw);
    });
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const rev = () => {
    const s = sim.current;
    const lane = laneRef.current;
    const car = carRef.current;
    if (reduced || !lane || !car || s.x === null) return;
    const midY = car.offsetTop + car.offsetHeight / 2;
    const facing = Math.cos((s.yaw * Math.PI) / 180) >= 0 ? 1 : -1;
    chassisRef.current?.animate(
      [{ transform: 'none' }, { transform: 'translateX(-1.5px)' }, { transform: 'translateX(1.5px)' }, { transform: 'translateX(-1px)' }, { transform: 'none' }],
      { duration: 300, easing: 'linear' },
    );
    puff(lane, s.x - facing * CAR_LEN * 0.5, midY, -facing * 9, 8);
    puff(lane, s.x - facing * CAR_LEN * 0.5, midY, -facing * 12, 7, 90);
  };

  return (
    <nav className={`nav ${hidden ? 'nav--hidden' : ''} ${tab === 'live' ? 'nav--live' : ''}`} aria-label={t('nav.label')} aria-hidden={hidden || undefined}>
      {TABS.map(({ id, icon: Icon, key }, i) => {
        const active = id === tab;
        const count = id === 'pools' ? pending : 0;
        return (
          <button
            key={id}
            ref={(el) => {
              items.current[i] = el;
            }}
            className="nav__item"
            aria-current={active ? 'page' : undefined}
            aria-label={count > 0 ? `${t(key)} (${count})` : undefined}
            tabIndex={hidden ? -1 : undefined}
            onClick={() => {
              if (active) {
                haptic.impact('light');
                document.querySelector('main.screen')?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
                rev();
                return;
              }
              haptic.tap();
              sfx.nav();
              go(id);
            }}
          >
            <span className="nav__icon">
              <Icon />
              {count > 0 && (
                <span className="nav__badge num" key={count}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
              {id === 'live' && flag && <span className="nav__flag" data-flag={flag} aria-hidden="true" />}
            </span>
            <span className="nav__label">{t(key)}</span>
          </button>
        );
      })}
      <div className="nav__bed" aria-hidden="true">
        <div className="nav__slot" ref={slotRef}>
          <div className="nav__well" ref={wellRef} />
          <div className="nav__rim" />
        </div>
      </div>
      <div className="nav__lane" ref={laneRef} aria-hidden="true">
        <div className="nav__car" ref={carRef}>
          <div className="nav__car-body" ref={bodyRef}>
            <div className="nav__trail" ref={trailRef} />
            <div className="nav__car-chassis" ref={chassisRef}>
              <NavCar />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
