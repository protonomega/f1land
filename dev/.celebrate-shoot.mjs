// Visual checks for the settlement overlay, streak card, reminder row and modal.
// Usage: node shoot.mjs [width] [height] [lang]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const W = +(process.argv[2] ?? 390);
const H = +(process.argv[3] ?? 844);
const lang = process.argv[4] ?? 'en';
const dir = new URL('.', import.meta.url).pathname + `${W}-${lang}`;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 300)));

const seed = ({ lang, rewards }) => {
  localStorage.clear();
  localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang, quality: 'low', motion: 'full', haptics: true, sound: false, renderMode: '2d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, reminderMin: 60 }, version: 1 }));
  if (rewards) localStorage.setItem('pa-f1-rewards', JSON.stringify({ state: rewards, version: 1 }));
};
const boot = async (rewards) => {
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(seed, { lang, rewards });
  await page.reload();
  await page.waitForFunction(() => window.__nav && window.__celebrate && window.__wallet, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });

const WIN = {
  state: 'WON', payout: 1175, stake: 500, mult: 2.35, title: lang === 'ru' ? 'Кто выиграет Гран-при Абу-Даби?' : 'Who will win the Abu Dhabi Grand Prix?',
  pick: 'Max Verstappen', winner: 'Max Verstappen', entryId: 'E-test', rankBefore: 40, xp: 60,
};
const LOSS = { ...WIN, state: 'LOST', payout: 0, pick: 'Lando Norris', winner: 'Max Verstappen', xp: 10 };

// 1. Plain win (seen level already current -> no level-up).
await boot({ claimed: {}, streak: 0, bestStreak: 0, lastCheckIn: null, seenLevel: 2, seenAch: [] });
await page.evaluate((m) => window.__celebrate.getState().push(m), WIN);
await page.waitForTimeout(500);
await shot('win-1-mid');
await page.waitForTimeout(2600);
await shot('win-2-settled');

// 2. Win with level-up + badges (fake settled entries so achievements unlock).
await boot({ claimed: {}, streak: 0, bestStreak: 0, lastCheckIn: null, seenLevel: 1, seenAch: [] });
await page.evaluate((m) => {
  const w = window.__wallet;
  const e = (id, state, stake, payout) => ({ id, poolId: 'p' + id, channelId: 'x', cycle: 1, sessionId: 's', marketId: 'F1-M14', outcomeId: 'o', pool: {}, questionKey: '', questionParams: {}, outcomeLabel: 'x', stake, estimate: 2, createdAt: Date.now(), state, payout, settlement: null, settlementHistory: [], finalMultiplier: 2, circuitId: 'abu_dhabi', meetingName: { ru: '', en: '' }, seen: true });
  w.setState({ entries: [e('E-test', 'WON', 500, 1175), e('E-b', 'LOST', 50, 0)] });
  window.__celebrate.getState().push(m);
}, WIN);
await page.waitForTimeout(700);
await shot('win-3-levelup-mid');
await page.waitForTimeout(2600);
await shot('win-4-levelup-settled');

// 3. Loss card, over the Home screen.
await boot({ claimed: {}, streak: 0, bestStreak: 0, lastCheckIn: null, seenLevel: 2, seenAch: [] });
await page.evaluate((m) => window.__celebrate.getState().push(m), LOSS);
await page.waitForTimeout(900);
await shot('loss-1');

// 4. Rewards: streak before / after claim, and Home compact.
await boot({ claimed: {}, streak: 3, bestStreak: 5, lastCheckIn: (() => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), seenLevel: 2, seenAch: [] });
await page.evaluate(() => window.__nav.getState().push({ name: 'rewards' }));
await page.waitForTimeout(1200);
await shot('streak-1-before');
await page.locator('.stk__cta').click();
await page.waitForTimeout(450);
await shot('streak-2-claim-mid');
await page.waitForTimeout(1800);
await shot('streak-3-after');
await page.evaluate(() => window.__nav.getState().go('home'));
await page.waitForTimeout(800);
await page.locator('.stk--compact').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot('home-streak-claimed');

// Home compact, ready state (fresh boot).
await boot({ claimed: {}, streak: 3, bestStreak: 5, lastCheckIn: (() => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), seenLevel: 2, seenAch: [] });
await page.locator('.stk--compact').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot('home-streak-ready');
await page.locator('.stk__chip--go').click();
await page.waitForTimeout(500);
await shot('home-streak-claim-mid');

// 5. Cold streak (never checked in) on Rewards.
await boot(null);
await page.evaluate(() => window.__nav.getState().push({ name: 'rewards' }));
await page.waitForTimeout(1200);
await shot('streak-4-cold');

// 6. Settings row + reminder modal.
await page.evaluate(() => window.__nav.getState().push({ name: 'settings' }));
await page.waitForTimeout(1000);
await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 330));
await page.waitForTimeout(500);
await shot('settings-reminder');
await page.evaluate(() => window.__reminderFire());
await page.waitForTimeout(900);
await shot('reminder-modal');

console.log('errors:', errs.length ? errs : 'none');
await browser.close();
