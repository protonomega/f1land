import { chromium } from '@playwright/test';
const [, , id, q] = process.argv;
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
page.setDefaultTimeout(240000);
page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)));
await page.goto(`http://localhost:5192/dev/ground-test.html?id=${id}&q=${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const s = window.__scene;
  const out = {};
  for (let k = 0; k < 3; k++) {
    let t = performance.now();
    s.colliders.build([s.env.group]);
    out['colliders' + k] = Math.round(performance.now() - t);
  }
  out.cells = s.colliders.size;
  const site = await import('/src/three/track/site.ts');
  for (let k = 0; k < 2; k++) {
    const t = performance.now();
    const m = site.buildSiteMap({ circuit: s.circuit, model: s.model, quality: s.opts.quality, night: 1, lights: [], paved: [], roads: [], trackLight: 0.6 });
    out['site' + k] = Math.round(performance.now() - t);
    m.dispose();
  }
  let tris = 0;
  s.env.group.traverse((o) => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); } });
  out.tris = tris;
  return out;
});
console.log(id, q, JSON.stringify(r));
await browser.close();
