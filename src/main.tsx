import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeScreen } from '@/screens/Home';
import { LiveScreen } from '@/screens/Live';
import { MyPoolsScreen, EntryScreen } from '@/screens/MyPools';
import { PoolScreen } from '@/screens/Pool';
import { SettingsScreen, useApplySettings } from '@/screens/Settings';
import { Onboarding } from '@/screens/Onboarding';
import { SceneHost } from '@/app/SceneHost';
import { getEngine, startSessionService } from '@/app/sessionService';
import { CATALOG } from '@/domain/markets/catalog';
import type { MarketId } from '@/domain/types';
import { useWallet } from '@/store/wallet';
import { useLive, startLiveLoop } from '@/store/live';
import { useNav, currentRoute, type Route } from '@/store/nav';
import { usePools } from '@/demo/poolEngine';
import { useSettings } from '@/store/settings';
import { useToasts } from '@/store/toasts';
import { NavBar } from '@/ui/NavBar';
import { Celebration } from '@/ui/celebrate/Celebration';
import { PlayReminder } from '@/ui/celebrate/PlayReminder';
import { useCelebrate } from '@/ui/celebrate/store';
import { registerDict, setLang } from '@/i18n/core';
import { UI_DICTS } from '@/i18n/ui';
import { F1_I18N } from '@/domain/markets/i18n';
import { registerFeatureDicts } from '@/i18n/extra';
import { initTelegram, setBackButton } from '@/telegram/sdk';
import '@/styles/app.css';
import '@/styles/restored.css';
// After app.css so screen styles win ties in the cascade.
import '@/styles/screens.css';

/* Core flows (Home, Live, Pool, My Pools) ship in the entry chunk; the rest load on demand. */
const SCREEN_CHUNKS = {
  races: () => import('@/screens/Races'),
  circuit: () => import('@/screens/Circuit'),
  driver: () => import('@/screens/Driver'),
  profile: () => import('@/screens/Profile'),
  wallet: () => import('@/screens/Wallet'),
  leaderboard: () => import('@/screens/Leaderboard'),
  rewards: () => import('@/screens/Rewards'),
  history: () => import('@/screens/History'),
};
function lazyScreen<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));
}
const RacesScreen = lazyScreen(SCREEN_CHUNKS.races, 'RacesScreen');
const MeetingScreen = lazyScreen(SCREEN_CHUNKS.races, 'MeetingScreen');
const SessionScreen = lazyScreen(SCREEN_CHUNKS.races, 'SessionScreen');
const CircuitScreen = lazyScreen(SCREEN_CHUNKS.circuit, 'CircuitScreen');
const DriverScreen = lazyScreen(SCREEN_CHUNKS.driver, 'DriverScreen');
const ProfileScreen = lazyScreen(SCREEN_CHUNKS.profile, 'ProfileScreen');
const WalletScreen = lazyScreen(SCREEN_CHUNKS.wallet, 'WalletScreen');
const LeaderboardScreen = lazyScreen(SCREEN_CHUNKS.leaderboard, 'LeaderboardScreen');
const RewardsScreen = lazyScreen(SCREEN_CHUNKS.rewards, 'RewardsScreen');
const HistoryScreen = lazyScreen(SCREEN_CHUNKS.history, 'HistoryScreen');

// Warm the screen chunks once the first screen is idle, so navigation never waits on the network.
{
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => Object.values(SCREEN_CHUNKS).forEach((load) => void load()));
}

function ScreenFallback() {
  return (
    <div className="screen-fallback" role="status" aria-live="polite">
      <span className="loader-ring" />
    </div>
  );
}

registerDict('ru', { ...UI_DICTS.ru, ...F1_I18N.ru });
registerDict('en', { ...UI_DICTS.en, ...F1_I18N.en });
registerFeatureDicts();
setLang(useSettings.getState().lang);
initTelegram();
startSessionService();
startLiveLoop();
void useLive.getState().open(useLive.getState().channelId);
// Store handles for scripted screenshots, debugging and Playwright: dev server and VITE_E2E=1 builds only.
if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
  Object.assign(window, {
    __nav: useNav,
    __live: useLive,
    __settings: useSettings,
    __wallet: useWallet,
    __celebrate: useCelebrate,
    __engine: getEngine,
    __family: (id: string) => CATALOG[id as MarketId]?.family,
  });
}

function routeContent(route: Route) {
  switch (route.name) {
    case 'tab':
      switch (route.tab) {
        case 'home':
          return <HomeScreen />;
        case 'races':
          return <RacesScreen />;
        case 'live':
          return <LiveScreen />;
        case 'pools':
          return <MyPoolsScreen />;
        case 'profile':
          return <ProfileScreen />;
      }
      break;
    case 'meeting':
      return <MeetingScreen meetingId={route.meetingId} />;
    case 'session':
      return <SessionScreen channelId={route.channelId} />;
    case 'pool':
      return <PoolScreen key={route.poolId} poolId={route.poolId} />;
    case 'entry':
      return <EntryScreen entryId={route.entryId} />;
    case 'circuit':
      return <CircuitScreen circuitId={route.circuitId} />;
    case 'driver':
      return <DriverScreen driverId={route.driverId} />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'wallet':
      return <WalletScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'rewards':
      return <RewardsScreen />;
  }
  return <HomeScreen />;
}

function App() {
  const tab = useNav((s) => s.tab);
  const stack = useNav((s) => s.stack);
  const back = useNav((s) => s.back);
  const route = currentRoute({ tab, stack });
  const openCount = usePools((s) => s.pools.filter((p) => p.pool.status === 'OPEN').length);
  const toasts = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const error = useLive((s) => s.error);
  const open = useLive((s) => s.open);
  const channelId = useLive((s) => s.channelId);
  const lang = useSettings((s) => s.lang);
  useEffect(() => { setLang(lang); }, [lang]);
  useApplySettings();
  useEffect(() => { setBackButton(stack.length ? back : null); return () => setBackButton(null); }, [stack.length, back]);
  const live = route.name === 'tab' && route.tab === 'live';
  const content = routeContent(route);
  return (
    <div className="app">
      <div className="app__bg-lines" />
      <SceneHost />
      <div className="screen-stack">
        <main key={JSON.stringify(route)} className={`screen ${live ? 'screen--flush' : ''}`}>
          {error && (
            <div role="alert" className="statusbar statusbar--red">
              {error} <button onClick={() => void open(channelId)}>Retry</button>
            </div>
          )}
          <Suspense fallback={<ScreenFallback />}>{content}</Suspense>
        </main>
      </div>
      <NavBar openCount={openCount} />
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((item) => (
          <div className={`toast toast--${item.kind}`} key={item.id}>
            <div>
              <strong>{item.title}</strong>
              {item.body && <div>{item.body}</div>}
            </div>
            {item.action && <button onClick={item.action.run}>{item.action.label}</button>}
            <button aria-label="Close" onClick={() => dismiss(item.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <Celebration />
      <PlayReminder />
      <Onboarding />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
