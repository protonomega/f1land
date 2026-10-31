import { expect, test } from '@playwright/test';
import { balance, boot, openPool, watchErrors } from './helpers';

test.describe('pool screen: pick → stake → confirm', () => {
  test('confirming a pick debits the DEMO balance and records the entry', async ({ page }) => {
    const w = watchErrors(page);
    await boot(page);
    const poolId = await openPool(page, null, 25_000);
    const before = await balance(page);

    const dock = page.locator('.tdock');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.tdock__prompt')).toBeVisible();

    const tile = page.getByRole('radio').first();
    await tile.click();
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await expect(dock.locator('.tdock__pick')).toBeVisible();

    await dock.locator('.tdock__chip', { hasText: /^25$/ }).click();
    await expect(dock.locator('.tdock__val input')).toHaveValue('25');

    const swipe = dock.getByRole('button', { name: /confirm|подтверд/i });
    await expect(swipe).toHaveAttribute('aria-disabled', 'false');
    await swipe.focus();
    await page.keyboard.press('Enter');

    const sheet = page.locator('.cf');
    await expect(sheet).toBeVisible();
    await expect(page.locator('.cf--ok')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cf__id')).toContainText('E-');

    await expect.poll(() => balance(page)).toBe(before - 25);
    const entry = await page.evaluate((id) => window.__wallet.getState().entries.find((e: any) => e.poolId === id), poolId);
    expect(entry?.stake).toBe(25);
    expect(entry?.state).toBe('PENDING');
    w.assertClean();
  });

  test('swipe gesture confirms only past the commit threshold', async ({ page }) => {
    await boot(page);
    await openPool(page, null, 25_000);
    await page.getByRole('radio').first().click();
    const sw = page.locator('.sw');
    const box = (await sw.boundingBox())!;
    const y = box.y + box.height / 2;
    // A short drag springs back without confirming.
    await page.mouse.move(box.x + 28, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, y, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.cf')).toHaveCount(0);
    // A full drag confirms.
    await page.mouse.move(box.x + 28, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 6, y, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.cf')).toBeVisible();
  });

  test('QA17: a pool that locks disables the CTA immediately and never resubmits', async ({ page }) => {
    await boot(page);
    const poolId = await openPool(page, null, 4_000);
    await page.getByRole('radio').first().click();
    // Force the lock from the server side (same path as the lifecycle tick).
    await page.evaluate((id) => {
      const lp = window.__engine().get(id);
      lp.pool = { ...lp.pool, closes_at: new Date((window.__live.getState().runner?.nowMs ?? Date.now()) - 1).toISOString() };
    }, poolId);
    await expect(page.locator('.tdock--locked, .sw--off').first()).toBeVisible({ timeout: 5_000 });
    const sw = page.locator('.sw');
    if (await sw.count()) {
      await expect(sw).toHaveAttribute('aria-disabled', 'true');
      await sw.focus().catch(() => {});
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.cf--ok')).toHaveCount(0);
    const entries = await page.evaluate((id) => window.__wallet.getState().entries.filter((e: any) => e.poolId === id).length, poolId);
    expect(entries).toBe(0);
  });

  test('QA19: losing the WebGL context keeps the pick and shows the SVG map', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page, { renderMode: '3d' });
    await openPool(page, null, 25_000);
    const tile = page.getByRole('radio').first();
    await tile.click();
    await page.waitForSelector('.scene-canvas-wrap canvas', { timeout: 30_000 });
    await page.evaluate(() => {
      const c = document.querySelector('.scene-canvas-wrap canvas') as HTMLCanvasElement;
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await expect(page.locator('.scene-2d svg')).toBeVisible({ timeout: 10_000 });
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.tdock__pick')).toBeVisible();
  });
});

for (const lang of ['ru', 'en'] as const) {
  test(`QA20 (${lang}): anchor is not clipped and the CTA is not covered by the nav`, async ({ page }) => {
    await boot(page, { lang });
    await openPool(page, null, 25_000);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.pl-q__title, .pl-q__line span')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          const clips = cs.overflow !== 'visible' || cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis';
          const r = el.getBoundingClientRect();
          // Real truncation, or text pushed past the viewport edge.
          return (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) || r.right > window.innerWidth || r.left < 0;
        })
        .map((el) => `${el.className}: "${el.textContent}" ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`),
    );
    expect(clipped).toEqual([]);
    await page.getByRole('radio').first().click();
    const cta = (await page.locator('.sw').boundingBox())!;
    // The tab bar steps aside on the pool route, so the CTA only has to clear the viewport edge.
    await expect(page.locator('nav.nav')).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(async () => (await page.locator('nav.nav').boundingBox())!.y).toBeGreaterThanOrEqual(page.viewportSize()!.height);
    expect(cta.y + cta.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const vw = page.viewportSize()!.width;
    const overflow = await page.evaluate(() => document.querySelector('.screen')!.scrollWidth - document.querySelector('.screen')!.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(cta.x).toBeGreaterThanOrEqual(0);
    expect(cta.x + cta.width).toBeLessThanOrEqual(vw);
  });
}

test('QA20: duel cards keep A/B order while the race changes', async ({ page }) => {
  await boot(page);
  const id = await openPool(page, ['F1-M02', 'F1-M07'], 15_000).catch(() => null);
  test.skip(!id, 'no duel pool in this demo window');
  const names = async () => page.locator('.duel2__card').allInnerTexts();
  const first = (await names()).map((s) => s.split('\n')[0]);
  await page.waitForTimeout(4_000);
  const later = (await names()).map((s) => s.split('\n')[0]);
  expect(later).toEqual(first);
});
