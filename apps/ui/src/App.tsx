import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_NAV } from '@headunit/shared';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Spinner } from './components/ui';
import { Backdrop } from './layers/Backdrop';
import { BeatOverlay } from './layers/BeatOverlay';
import { Mascot } from './layers/Mascot';
import { Scene, WeatherLayer, weatherFxFor } from './layers/Scene';
import { accentFromImage } from './lib/accent';
import { liveSpeedKmh } from './lib/driving';
import { useNow } from './lib/hooks';
import { usePlace } from './lib/place';
import { effectiveTheme } from './lib/theme';
import { appearanceInput, applyAppearance, resolveAppearance } from './lib/themes';
import { AndroidAutoPage } from './pages/AndroidAuto';
import { AppHost, AppsPage } from './pages/Apps';
import { DevicesPage } from './pages/Devices';
import { DrivePage } from './pages/Drive';
import { HomePage } from './pages/home/Home';
import { MediaPage } from './pages/media/Media';
import { NowPlayingPage } from './pages/NowPlaying';
import { SettingsPage } from './pages/settings/Settings';
import { VehiclePage } from './pages/Vehicle';
import { AlertStrip } from './shell/AlertStrip';
import { CameraOverlay } from './shell/CameraOverlay';
import { DockBoundary } from './shell/Dock';
import { GlobalEffects } from './shell/GlobalEffects';
import { HardwareController } from './shell/HardwareController';
import { NavEditor } from './pages/settings/nav/NavEditor';
import { QuickPanel } from './shell/QuickPanel';
import { RadioPlayer } from './shell/RadioPlayer';
import { SpotifyPlaybackBridge } from './shell/SpotifyPlaybackBridge';
import { StatusBar } from './shell/StatusBar';
import { Standby } from './shell/Standby';
import { Toast } from './shell/Toast';
import { TouchFx } from './shell/TouchFx';
import { TouchKeyboard } from './shell/TouchKeyboard';
import { selectTrackArt, startSocket, useHeadUnit, type Route } from './store';

const kiosk = new URLSearchParams(location.search).has('kiosk');

/** Pages that show the animated scene behind them. Busy pages (settings, apps) keep a still background. */
const SCENE_ROUTES: ReadonlySet<Route> = new Set<Route>(['home', 'media', 'nowplaying', 'drive', 'aa']);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const cb = () => setReduced(q.matches);
    q.addEventListener('change', cb);
    return () => q.removeEventListener('change', cb);
  }, []);
  return reduced;
}

/** One page, mounted fresh on each navigation so its entrance animation plays (direction from the store). */
function PageFrame({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const dir = useHeadUnit((s) => s.navDir);
  return (
    <div className="layer page-enter" key={routeKey} style={{ ['--dir' as string]: dir, pointerEvents: 'auto' }}>
      <ErrorBoundary
        fallback={(_e, retry) => (
          <div className="page">
            <div className="empty">
              <b>This screen could not be shown</b>
              <span>The rest of the head unit still works.</span>
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}
      >
        <Suspense
          fallback={
            <div className="page" style={{ placeItems: 'center', display: 'grid' }}>
              <Spinner />
            </div>
          }
        >
          {children}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  const ready = useHeadUnit((s) => s.ready);
  const route = useHeadUnit((s) => s.route);
  const appId = useHeadUnit((s) => s.appId);
  const settings = useHeadUnit((s) => s.settings);
  const system = useHeadUnit((s) => s.system);
  const editing = useHeadUnit((s) => s.editing);
  const moving = useHeadUnit((s) => (liveSpeedKmh(s.vehicle, s.svc.gps) ?? 0) > 8);
  const nav = useHeadUnit((s) => s.navDraft ?? s.settings?.nav);
  const navEditor = useHeadUnit((s) => s.navEditor);
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const weatherNow = useHeadUnit((s) => (s.settings?.weatherFx ? s.svc.weather?.current : undefined));
  const reduced = useReducedMotion();

  useEffect(() => startSocket(), []);

  // A way back that needs no working screen: open the head unit once with `?nav=default` and the navigation is reset.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(location.search);
    if (params.get('nav') !== 'default') return;
    patchSettings({ nav: DEFAULT_NAV });
    params.delete('nav');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }, [ready, patchSettings]);

  // Re-evaluated every 30 s so the automatic day/night switch happens without a reload.
  const now = useNow(30_000);
  const place = usePlace();
  const theme = settings ? effectiveTheme(settings, now, place) : 'obsidian';

  // Tint the interface with the playing album's colour (not for radio, which has no cover art).
  const artUrl = useHeadUnit((s) => (s.settings?.artAccent && !s.radio?.playing ? selectTrackArt(s) : undefined));
  const [artColor, setArtColor] = useState<string | null>(null);
  useEffect(() => {
    if (!artUrl) return setArtColor(null);
    let live = true;
    void accentFromImage(artUrl).then((c) => live && setArtColor(c));
    return () => {
      live = false;
    };
  }, [artUrl]);
  const accent = artColor ?? settings?.accent ?? '#a66bff';

  const resolved = useMemo(() => (settings ? resolveAppearance(appearanceInput(settings, theme, accent)) : null), [settings, theme, accent]);

  // The whole look → data-* attributes and CSS variables on <html>.
  useEffect(() => {
    if (!settings) return;
    applyAppearance(document.documentElement, appearanceInput(settings, theme, accent));
  }, [settings, theme, accent]);

  const calm = !settings || settings.motionSpeed === 'off' || settings.effects === 'minimal' || reduced;
  useEffect(() => {
    document.documentElement.dataset.moving = String(moving);
    document.documentElement.dataset.calm = String(calm);
  }, [moving, calm]);

  useEffect(() => {
    document.documentElement.classList.toggle('kiosk', kiosk);
    if (!kiosk) return;
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', block);
    return () => window.removeEventListener('contextmenu', block);
  }, []);

  // Car-friendly Back gesture: start at the far left edge and swipe right.
  const back = useHeadUnit((s) => s.back);
  useEffect(() => {
    if (!kiosk || route === 'home') return;
    let swipe: { id: number; x: number; y: number } | null = null;
    let suppressClickUntil = 0;
    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.clientX > 34) return;
      if (e.target instanceof Element && e.target.closest('[data-no-edge-back]')) return;
      if (useHeadUnit.getState().navEditor) return;
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      const dy = Math.abs(e.clientY - swipe.y);
      if (dx > 18 && dx > dy * 1.25) e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      const dy = Math.abs(e.clientY - swipe.y);
      swipe = null;
      if (dx >= 86 && dx > dy * 1.35) {
        suppressClickUntil = Date.now() + 450;
        back();
      }
    };
    const click = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const cancel = () => {
      swipe = null;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('click', click, true);
    };
  }, [back, route]);

  if (!ready || !resolved || !settings) {
    return (
      <div className="splash" role="status" aria-label="RootUnit starting">
        <img src="/mascot/armored.webp" alt="" />
        <div className="splash-title">ROOTUNIT</div>
        <div className="splash-sub">Connecting to the head unit…</div>
        <div className="splash-bar">
          <i />
        </div>
      </div>
    );
  }

  // When the display has no controllable backlight, dim with an overlay instead.
  const softDim = system && !system.hardwareBrightness ? Math.max(0, (100 - system.brightness) / 100) * 0.85 : 0;
  const showScene = !calm && !moving && SCENE_ROUTES.has(route) && settings.dashScene !== 'off';
  const weatherFx = !calm && !moving && settings.weatherFx && SCENE_ROUTES.has(route) ? weatherFxFor(weatherNow?.code, weatherNow?.isDay) : null;
  const mascotHere = route === 'home' || settings.mascotScope === 'all';
  const routeKey = route === 'app' ? `app:${appId}` : route;

  return (
    <div className="app" data-nav-pos={nav?.position ?? 'left'} data-nav-size={nav?.size ?? 'regular'} data-nav-labels={nav?.labels ?? 'always'} data-dock={settings.dockStyle}>
      <Backdrop palette={resolved.palette} accent={resolved.accent} accent2={resolved.accent2} />
      {showScene && <Scene scene={settings.dashScene} />}
      {weatherFx && <WeatherLayer fx={weatherFx} />}
      <BeatOverlay />
      {mascotHere && <Mascot editing={route === 'home' && editing} />}
      <DockBoundary />
      <div className="main">
        <StatusBar />
        <AlertStrip />
        <main className="content">
          {/* The music page stays mounted while hidden so local TIDAL / YouTube playback keeps going. */}
          <div className="layer keepalive" data-visible={route === 'media'} aria-hidden={route !== 'media'} style={{ pointerEvents: route === 'media' ? 'auto' : 'none' }}>
            <ErrorBoundary fallback={<div className="page"><div className="empty"><b>Music could not be shown</b></div></div>}>
              <MediaPage />
            </ErrorBoundary>
          </div>
          {route !== 'media' && (
            <PageFrame routeKey={routeKey}>
              {route === 'home' && <HomePage />}
              {route === 'drive' && <DrivePage />}
              {route === 'nowplaying' && <NowPlayingPage />}
              {route === 'devices' && <DevicesPage />}
              {route === 'vehicle' && <VehiclePage />}
              {route === 'apps' && <AppsPage />}
              {route === 'app' && <AppHost />}
              {route === 'aa' && <AndroidAutoPage />}
              {route === 'settings' && <SettingsPage />}
            </PageFrame>
          )}
        </main>
      </div>
      <QuickPanel />
      {navEditor && (
        // Bundled with the main interface: a failed lazy chunk once left the rail looking dead. The fallback can always close it.
        <ErrorBoundary
          fallback={
            <div className="sheet-scrim" data-no-edge-back>
              <div className="sheet" role="alertdialog" aria-label="Navigation editor problem">
                <div className="sheet-head">
                  <h2>The navigation editor couldn’t open</h2>
                </div>
                <div className="sheet-body">
                  <p>Your navigation has not been changed.</p>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      const st = useHeadUnit.getState();
                      st.setNavDraft(null);
                      st.setNavEditor(null);
                    }}
                  >
                    Close editor
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <NavEditor />
        </ErrorBoundary>
      )}
      <Toast />
      <RadioPlayer />
      <CameraOverlay />
      <TouchKeyboard />
      <SpotifyPlaybackBridge />
      <HardwareController />
      <GlobalEffects />
      <Standby />
      <TouchFx />
      {softDim > 0 && <div className="dim-overlay" style={{ opacity: softDim }} />}
    </div>
  );
}
