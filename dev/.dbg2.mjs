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
const out = "/tmp/verify/dbg/x";
await page.getByRole('radio').nth(1).click();
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const d = document.querySelector('.tdock');
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const hits = [];
  for (const y of [r.top + 20, r.top + 60, r.top + 100, r.top + 140]) { const e = document.elementFromPoint(r.left + 60, y); hits.push(y.toFixed(0) + ':' + (e ? e.className + '<' + (e.parentElement?.className ?? '') : 'none')); }
  const chain = [];
  let e = d.parentElement; while (e) { const c = getComputedStyle(e); if (c.transform !== 'none' || c.opacity !== '1' || c.filter !== 'none' || c.zIndex !== 'auto' || c.isolation === 'isolate' || c.willChange !== 'auto' || c.contain !== 'none') chain.push(e.className + ' t=' + c.transform + ' o=' + c.opacity + ' z=' + c.zIndex + ' wc=' + c.willChange + ' contain=' + c.contain); e = e.parentElement; }
  const ot = document.querySelector('.og__minor .ot'); const oc = ot ? getComputedStyle(ot) : null;
  return { opacity: cs.opacity, bg: cs.backgroundImage.slice(0, 160), bf: cs.backdropFilter, z: cs.zIndex, pos: cs.position, hits, chain, ot: oc && { z: oc.zIndex, t: oc.transform, wc: oc.willChange } };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
