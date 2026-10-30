// Celebration layer screenshots: win moment, loss card, streak (Rewards + Home), reminder setting.
// Usage: node dev/shot-celebrate.mjs <width> <height> <ru|en>   (preview on :4173, writes /tmp/verify/cel-*)
import { chromium } from '@playwright/test';
const [w, h, lang] = [+process.argv[2] || 390, +process.argv[3] || 844, process.argv[4] || 'en'];
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((lang) => { localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang, quality: 'low', motion: 'full', haptics: false, sound: false, renderMode: '2d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, reminderMin: 0 }, version: 1 })); }, lang);
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => window.__live?.getState().live && window.__celebrate, null, { timeout: 120000 });
const out = `/tmp/verify/cel-${w}-${lang}`;
const win = { state: 'WON', payout: 312, stake: 100, mult: 3.12, title: 'Who completes the first confirmed on-track pass: Norris or Leclerc?', pick: 'Norris passes Leclerc', winner: 'Norris passes Leclerc', entryId: 'E-M07-001-12345', rankBefore: 74, xp: 60 };
await page.evaluate((m) => window.__celebrate.getState().push(m), win);
await page.waitForTimeout(450);
await page.screenshot({ path: `${out}-win-a.png` });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}-win-b.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.evaluate((m) => window.__celebrate.getState().push({ ...m, state: 'LOST', payout: 0, winner: 'No pass' }), win);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}-loss.png` });
await page.waitForTimeout(5000);
await page.evaluate(() => window.__nav.getState().push({ name: 'rewards' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-rewards.png` });
const claim = page.locator('.streak button, [class*="streak"] button').first();
if (await claim.count()) { await claim.click().catch(() => {}); await page.waitForTimeout(700); await page.screenshot({ path: `${out}-rewards-claim.png` }); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}-rewards-claimed.png` }); }
await page.evaluate(() => window.__nav.getState().push({ name: 'settings' }));
await page.waitForTimeout(1200);
const sc = await page.$('.screen'); await sc.evaluate((el) => el.scrollTo(0, el.scrollHeight));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}-settings.png` });
console.log('done', errs.join(' | '));
await browser.close();
