// Full-app audit screenshots: every route at the given viewport, plus scroll-through frames.
// Usage: node dev/shot-app.mjs --url http://127.0.0.1:4173/ --dir /tmp/shots --w 390 --h 844 [--lang ru|en] [--only home,pool:zone] [--scroll 2]
// Route specs: home races live pools profile leaderboard wallet settings history rewards meeting session circuit driver entry pool:<layout>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const a = process.argv.slice(2);
const arg = (k, d) => {
  const i = a.indexOf('--' + k);
  return i >= 0 ? (a[i + 1] === undefined || a[i + 1].startsWith('--') ? true : a[i + 1]) : d;
};
const dir = arg('dir', '/tmp/shots');
const w = +arg('w', 390);
const h = +arg('h', 844);
const lang = arg('lang', 'en');
const scrollFrames = +arg('scroll', 2);
const settle = +arg('settle', 2500);
const ALL = 'home,races,live,pools,profile,leaderboard,wallet,settings,history,rewards,meeting,session,circuit,driver,pool:zone,pool:duel,pool:pit,pool:tyre,pool:pace,pool:incident,pool:position,pool:quali,pool:combo';
const only = String(arg('only', ALL)).split(',');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +arg('dpr', 2), isMobile: true, hasTouch: true });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 300)));

await page.goto(arg('url', 'http://127.0.0.1:4173/'));
await page.evaluate((lang) => {
  localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang, quality: 'medium', motion: 'full', haptics: true, sound: false, renderMode: '3d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, reminderMin: 0 }, version: 1 }));
}, lang);
await page.reload();
await page.waitForFunction(() => window.__nav && window.__live?.getState().runner?.ready, null, { timeout: 120000 }).catch(() => errs.push('runner not ready'));
const ch = arg('channel');
if (ch) await page.evaluate((id) => window.__live.getState().open(id), ch);
// Wait for the synced live state (not just the runner) so screens show real data.
await page.waitForFunction(() => window.__live.getState().live, null, { timeout: 180000 }).catch(() => errs.push('live state not ready'));
await page.waitForTimeout(1500);

const nav = (fn, argv) => page.evaluate(fn, argv);
const scroller = async () => page.$('.screen');

async function shoot(name) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${dir}/${name}.png` });
  const sc = await scroller();
  if (!sc || scrollFrames < 1) return;
  const total = await sc.evaluate((el) => el.scrollHeight - el.clientHeight);
  for (let i = 1; i <= scrollFrames && total > 0; i++) {
    const y = Math.min(total, Math.round((total * i) / scrollFrames));
    await sc.evaluate((el, y) => el.scrollTo(0, y), y);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${name}~${i}.png` });
    if (y >= total) break;
  }
  await sc.evaluate((el) => el.scrollTo(0, 0));
}

for (const spec of only) {
  const [kind, sub] = spec.split(':');
  try {
    await nav(() => window.__nav.getState().go('home'));
    if (['home', 'races', 'live', 'pools', 'profile'].includes(kind)) await nav((t) => window.__nav.getState().go(t), kind);
    else if (['leaderboard', 'wallet', 'settings', 'history', 'rewards'].includes(kind)) await nav((n) => window.__nav.getState().push({ name: n }), kind);
    else if (kind === 'session') await nav(() => window.__nav.getState().push({ name: 'session', channelId: window.__live.getState().channelId }));
    else if (kind === 'meeting') await nav(() => window.__nav.getState().push({ name: 'meeting', meetingId: String(window.__live.getState().runner?.channel.meetingRound ?? 1) }));
    else if (kind === 'circuit') await nav(() => window.__nav.getState().push({ name: 'circuit', circuitId: window.__live.getState().runner.circuit.id }));
    else if (kind === 'driver') await nav(() => window.__nav.getState().push({ name: 'driver', driverId: window.__live.getState().live?.cars?.[0]?.id }));
    else if (kind === 'entry') {
      const id = await nav(() => window.__wallet.getState().entries[0]?.id ?? null);
      if (!id) { console.log('skip entry (none)'); continue; }
      await nav((entryId) => window.__nav.getState().push({ name: 'entry', entryId }), id);
    } else if (kind === 'pool') {
      const id = await nav((layout) => {
        const all = window.__engine?.()?.all() ?? [];
        // Mirrors POOL_LAYOUT in src/app/poolText.ts.
        const fam = { zone: ['F1-M11'], duel: ['F1-M02', 'F1-M07', 'F1-M16'], pit: ['F1-M03', 'F1-M05', 'F1-M06'], tyre: ['F1-M04', 'F1-M20'], pace: ['F1-M08', 'F1-M09', 'F1-M19'], incident: ['F1-M10', 'F1-M12'], position: ['F1-M01', 'F1-M13', 'F1-M14', 'F1-M18'], quali: ['F1-M15', 'F1-M17'], combo: ['F1-M21'] }[layout] ?? [];
        const pick = all.filter((p) => fam.includes(p.pool.market_id)).sort((x, y) => (y.pool.status === 'OPEN') - (x.pool.status === 'OPEN'))[0];
        return pick ? pick.pool.pool_id : null;
      }, sub);
      if (!id) { console.log('skip pool', sub, '(none in this session)'); continue; }
      await nav((poolId) => window.__nav.getState().push({ name: 'pool', channelId: window.__live.getState().channelId, poolId }), id);
    }
    await shoot(spec.replace(':', '-'));
    console.log('shot', spec);
  } catch (e) {
    console.log('fail', spec, e.message.slice(0, 200));
  }
}
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 20).join('\n'));
await browser.close();
