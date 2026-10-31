// Overflow scan: clipped buttons/tabs/badges and content past the viewport, per route, at 320/360 RU+EN.
// Usage: VITE_E2E=1 pnpm build && pnpm preview --port 4173 &; node dev/scan-overflow.mjs
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
const routes = ['home', 'races', 'pools', 'profile', 'settings', 'wallet', 'leaderboard', 'history', 'rewards', 'session', 'meeting', 'circuit', 'driver'];
for (const [w, lang] of [[320, 'ru'], [360, 'ru'], [360, 'en']]) {
  const page = await b.newPage({ viewport: { width: w, height: 720 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:4173/');
  await page.evaluate((lang) => localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang, quality: 'low', motion: 'reduced', haptics: false, sound: false, renderMode: '2d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, reminderMin: 0 }, version: 1 })), lang);
  await page.reload();
  await page.waitForFunction(() => window.__live?.getState().runner?.ready && window.__live.getState().live, null, { timeout: 120000 });
  for (const r of routes) {
    await page.evaluate((r) => {
      const n = window.__nav.getState();
      n.go('home');
      if (['home', 'races', 'pools', 'profile'].includes(r)) n.go(r);
      else if (r === 'session') n.push({ name: 'session', channelId: window.__live.getState().channelId });
      else if (r === 'meeting') n.push({ name: 'meeting', meetingId: String(window.__live.getState().runner?.channel.meetingRound ?? 1) });
      else if (r === 'circuit') n.push({ name: 'circuit', circuitId: window.__live.getState().runner.circuit.id });
      else if (r === 'driver') n.push({ name: 'driver', driverId: window.__live.getState().live?.cars?.[0]?.id });
      else n.push({ name: r });
    }, r);
    await page.waitForTimeout(900);
    const bad = await page.evaluate(() => {
      const out = [];
      const scrollerX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      for (const el of document.querySelectorAll('main.screen button, main.screen .badge, main.screen [role=tab], main.screen .chip, main.screen .btn')) {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
        const txt = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped ${el.scrollWidth}>${el.clientWidth} "${txt}"`);
        for (const s of el.querySelectorAll('.ellipsis')) if (s.scrollWidth > s.clientWidth + 1) out.push(`ellipsised "${s.textContent.slice(0, 30)}"`);
      }
      for (const el of document.querySelectorAll('main.screen *')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > innerWidth + 1 || r.left < -1) && !scrollerX(el) && getComputedStyle(el).position !== 'fixed') {
          const txt = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
          if (txt) out.push(`offscreen [${Math.round(r.left)},${Math.round(r.right)}] <${el.className?.toString().split(' ')[0]}> "${txt}"`);
        }
      }
      return [...new Set(out)].slice(0, 8);
    });
    if (bad.length) console.log(`${w}/${(await page.evaluate(() => document.documentElement.lang))} ${r}:\n  ` + bad.join('\n  '));
  }
  await page.close();
}
await b.close();
