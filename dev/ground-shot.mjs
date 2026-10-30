// TEMP: node dev/ground-shot.mjs <circuit> <quality> <outPrefix> <w>x<h> "name|eyeExpr|targetExpr|fov" ...
import { chromium } from '@playwright/test';
const [, , id, q, prefix, size, ...views] = process.argv;
const [w, h] = size.split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 400)); });
const t0 = Date.now();
await page.goto(`http://localhost:5192/dev/ground-test.html?id=${id}&q=${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
console.log('ready', ((Date.now() - t0) / 1000).toFixed(1), 's; scene load ms', await page.evaluate(() => Math.round(window.__loadMs)));
await page.evaluate(() => {
  window.S = (s, lat = 0, y = 0) => { const p = window.__scene.model.track.pointAt(s, lat); return [p[0], y, -p[1]]; };
  window.cam = (eye, tgt, fov = 55) => {
    const r = window.__scene.rig;
    r.fly = null;
    r.controls.minDistance = 0; r.controls.maxDistance = 1e6; r.controls.maxPolarAngle = Math.PI; r.controls.minPolarAngle = 0;
    r.camera.fov = fov; r.camera.updateProjectionMatrix();
    r.camera.position.set(...eye);
    r.controls.target.set(...tgt);
    r.controls.update();
  };
});
for (const v of views) {
  const [name, eye, tgt, fov] = v.split('|');
  await page.evaluate(([e, t, f]) => window.cam(eval(e), eval(t), Number(f || 55)), [eye, tgt, fov]);
  const f0 = await page.evaluate(() => window.__scene.frameCount);
  await page.waitForFunction((f) => window.__scene.frameCount > f + 3, f0);
  const out = `${prefix}${name}.png`;
  await page.screenshot({ path: out });
  console.log('saved', out, JSON.stringify(await page.evaluate(() => window.__scene.stats())));
}
if (errs.length) console.log([...new Set(errs)].slice(0, 12).join('\n'));
await browser.close();
