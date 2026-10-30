import { expect, test } from '@playwright/test';
import { boot, goTab, watchErrors } from './helpers';

test.describe('shell & navigation', () => {
  test('boots into Home with the F1 nav bar and no runtime errors', async ({ page }) => {
    const w = watchErrors(page);
    await boot(page);
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.nav__car')).toBeVisible();
    w.assertClean();
  });

  test('every tab and secondary screen renders', async ({ page }) => {
    const w = watchErrors(page);
    await boot(page);
    for (const tab of ['races', 'live', 'pools', 'profile', 'home'] as const) {
      await goTab(page, tab);
      await expect(page.locator('main.screen')).toBeVisible();
      await expect(page.locator('main.screen')).not.toBeEmpty();
    }
    for (const name of ['leaderboard', 'wallet', 'settings', 'history', 'rewards']) {
      await page.evaluate((n) => window.__nav.getState().push({ name: n }), name);
      await expect(page.locator('main.screen')).not.toBeEmpty();
      await page.evaluate(() => window.__nav.getState().back());
    }
    w.assertClean();
  });

  test('nav buttons switch tabs and move the car', async ({ page }) => {
    await boot(page);
    const car = page.locator('.nav__car');
    const before = await car.boundingBox();
    await page.getByRole('navigation').getByRole('button').last().click();
    await expect.poll(() => page.evaluate(() => window.__nav.getState().tab)).toBe('profile');
    await expect.poll(async () => (await car.boundingBox())!.x).not.toBe(before!.x);
  });

  test('onboarding shows for new users and can be skipped', async ({ page }) => {
    await boot(page, { onboarded: false });
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('.sc-onb__skip').click();
    await expect(dlg).toBeHidden();
    expect(await page.evaluate(() => window.__settings.getState().onboarded)).toBe(true);
  });

  test('language switch re-renders RU/EN copy', async ({ page }) => {
    await boot(page, { lang: 'en' });
    const label = page.getByRole('navigation').getByRole('button').first();
    const en = await label.innerText();
    await page.evaluate(() => window.__settings.getState().set({ lang: 'ru' }));
    await expect.poll(() => label.innerText()).not.toBe(en);
    await expect(page.locator('html')).toHaveAttribute('lang', /ru/);
  });
});
