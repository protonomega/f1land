// Pool betting-flow screenshots: open pool → pick → swipe-confirm → sheet → after.
// Usage: node dev/shot-dock.mjs <width> <height> <ru|en>   (preview on :4173, writes /tmp/verify/dock-*)
import { chromium } from '@playwright/test';
const [w, h, lang] = [+process.argv[2] || 390, +process.argv[3] || 844, process.argv[4] || 'en'];
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.addInitScript((lang) => { localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang, quality: 'low', motion: 'full', haptics: false, sound: false, renderMode: '2d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, reminderMin: 0 }, version: 1 })); }, lang);
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => window.__live?.getState().runner?.ready);
const hd = await page.waitForFunction(() => { const now = window.__live.getState().runner?.nowMs; const p = (window.__engine()?.all() ?? []).map((x) => x.pool).filter((p) => p.status === 'OPEN' && p.intake_status === 'ACCEPTING' && Date.parse(p.closes_at) - now > 30000).sort((a,b)=> (a.market_id==='F1-M05'||a.market_id==='F1-M11'?-1:1))[0]; return p?.pool_id ?? null; }, null, { timeout: 120000, polling: 500 });
const id = await hd.jsonValue();
await page.evaluate((poolId) => window.__nav.getState().push({ name: 'pool', channelId: window.__live.getState().channelId, poolId }), id);
await page.waitForTimeout(2500);
const out = `/tmp/verify/dock-${w}-${lang}`;
await page.screenshot({ path: `${out}-a.png` });
await page.getByRole('radio').nth(1).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}-b.png` });
await page.locator('.sw').focus(); await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}-c.png` });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}-d.png` });
await page.getByRole('button', { name: /stay|остаться/i }).click().catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}-e.png` });
console.log('done', id);
await browser.close();
