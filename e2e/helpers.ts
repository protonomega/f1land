import { expect, type Page } from '@playwright/test';

/** Store handles exposed by `VITE_E2E=1` builds (see src/main.tsx). */
declare global {
  interface Window {
    __nav: any;
    __live: any;
    __settings: any;
    __wallet: any;
    __engine: () => any;
    __family: (id: string) => string | undefined;
    __celebrate?: any;
  }
}

export type Lang = 'ru' | 'en';

/** Boots the app past onboarding with deterministic, quiet settings. */
export async function boot(page: Page, opts: { lang?: Lang; renderMode?: '3d' | '2d'; onboarded?: boolean; channel?: string } = {}): Promise<void> {
  // SVG/DOM is the base interactive layer (F1-045); CPU-rendered WebGL in CI is too slow for UI flows.
  const { lang = 'en', renderMode = '2d', onboarded = true } = opts;
  await page.addInitScript(
    ({ lang, renderMode, onboarded }) => {
      if (sessionStorage.getItem('e2e-booted')) return;
      sessionStorage.setItem('e2e-booted', '1');
      localStorage.clear();
      localStorage.setItem(
        'pa-f1-settings',
        JSON.stringify({
          state: { lang, quality: 'low', motion: 'reduced', haptics: false, sound: false, renderMode, camera: 'director', showZones: true, favoriteDriver: null, onboarded, reminderMin: 0 },
          version: 1,
        }),
      );
    },
    { lang, renderMode, onboarded },
  );
  await page.goto('/');
  await page.waitForFunction(() => window.__live?.getState().runner?.ready === true, null, { timeout: 60_000 });
  if (opts.channel) {
    await page.evaluate((id) => window.__live.getState().open(id), opts.channel);
    await page.waitForFunction((id) => window.__live.getState().runner?.channel.id === id && window.__live.getState().runner?.ready, opts.channel, { timeout: 60_000 });
  }
}

/** Collects uncaught page errors; call `assertClean()` at the end of a test. */
export function watchErrors(page: Page): { errors: string[]; assertClean: () => void } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource|WebGL|GPU stall|CONTEXT_LOST/i.test(m.text())) errors.push(m.text());
  });
  return { errors, assertClean: () => expect(errors, errors.join('\n')).toEqual([]) };
}

/**
 * Waits for an accepting pool whose market matches `markets` and that stays open
 * for at least `minOpenMs`, then opens its screen. Returns the pool id.
 */
export async function openPool(page: Page, markets: string[] | null = null, minOpenMs = 20_000): Promise<string> {
  const id = await page.waitForFunction(
    ({ markets, minOpenMs }) => {
      const now = window.__live.getState().runner?.nowMs ?? Date.now();
      const all = (window.__engine()?.all() ?? []) as Array<{ pool: any }>;
      const ok = all
        .map((lp) => lp.pool)
        .filter((p) => p.status === 'OPEN' && p.intake_status === 'ACCEPTING' && Date.parse(p.opens_at) <= now && Date.parse(p.closes_at) - now > minOpenMs)
        .filter((p) => !markets || markets.includes(p.market_id))
        .sort((a, b) => Date.parse(b.closes_at) - Date.parse(a.closes_at));
      return ok[0]?.pool_id ?? null;
    },
    { markets, minOpenMs },
    { timeout: 75_000, polling: 500 },
  );
  const poolId = (await id.jsonValue()) as string;
  await page.evaluate((poolId) => window.__nav.getState().push({ name: 'pool', channelId: window.__live.getState().channelId, poolId }), poolId);
  await expect(page.locator('.pl-q__title')).toBeVisible();
  return poolId;
}

export async function goTab(page: Page, tab: 'home' | 'races' | 'live' | 'pools' | 'profile'): Promise<void> {
  await page.evaluate((t) => window.__nav.getState().go(t), tab);
}

export const balance = (page: Page) => page.evaluate(() => window.__wallet.getState().balance as number);
