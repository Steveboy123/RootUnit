import { useRef, useState } from 'react';
import { Camera, Car, Check, ChevronDown, ChevronLeft, Pencil, Plus, Satellite, Timer, WifiOff } from 'lucide-react';
import { appById } from '../apps/registry';
import { BatteryIcon, SignalBars } from '../components/Indicators';
import { TabStrip } from '../components/TabStrip';
import { formatClock, formatDuration } from '../lib/format';
import { useNow } from '../lib/hooks';
import { uid } from '../lib/layout';
import { showBack, useResolvedNav } from '../lib/nav/useNav';
import { selectNowPlaying } from '../lib/nowPlaying';
import { AddWidgetSheet, PageSheet } from '../pages/home/DashboardSheets';
import { useHeadUnit, useSvc, type Route } from '../store';
import { Eq } from '../components/ui';

const TITLES: Partial<Record<Route, string>> = {
  devices: 'Phones',
  vehicle: 'Vehicle',
  aa: 'Android Auto',
  settings: 'Settings',
  drive: 'Drive',
  apps: 'Apps',
  nowplaying: 'Now playing',
};
const MAX_PAGES = 6;

/** What is playing, in a pill in the middle of the bar. Reads only what it draws (no progress), so it does not redraw every frame. */
function NowPlayingTicker() {
  const media = useHeadUnit((s) => s.media);
  const local = useHeadUnit((s) => s.localNowPlaying);
  const bluetooth = useHeadUnit((s) => s.devices?.media);
  const radio = useHeadUnit((s) => s.radio);
  const go = useHeadUnit((s) => s.go);
  const np = selectNowPlaying({ media, local, bluetooth, radio }, 0);
  if (!np || (!np.title && !np.artist)) return null;
  return (
    <button type="button" className="sb-np" data-playing={np.playing} onClick={() => go('nowplaying')} aria-label={`Now playing: ${np.title}. Open the player`}>
      <span className="sb-np-art fx fx-drive" style={np.artUrl ? { backgroundImage: `url("${np.artUrl.replace(/"/g, '%22')}")` } : undefined} />
      <span className="sb-np-text truncate">
        <b className="truncate">{np.title || np.sourceLabel}</b>
        <span className="dim truncate">{np.artist || np.sourceLabel}</span>
      </span>
      <Eq on={np.playing} />
    </button>
  );
}

/** What is happening around the car, in one pill: tap it (or pull the bar down) for the Quick Panel. */
function StatusCluster() {
  const phone = useHeadUnit((s) => s.devices?.devices.find((d) => d.connected && d.active));
  const gps = useSvc('gps');
  const dashcam = useSvc('dashcam');
  const timers = useSvc('timers');
  const open = useHeadUnit((s) => s.setQuickPanel);
  const quickOpen = useHeadUnit((s) => s.quickPanel);
  const now = useNow(1000).getTime();
  const next = timers?.items.filter((t) => t.endsAt > now).sort((a, b) => a.endsAt - b.endsAt)[0];
  return (
    <button type="button" className="sb-cluster" data-open={quickOpen} aria-label="Quick controls" aria-expanded={quickOpen} onClick={() => open(!quickOpen)}>
      {dashcam?.recording && <span className="rec">REC</span>}
      {next && (
        <span className="row" style={{ gap: 4 }} title={next.label}>
          <Timer />
          <b className="num">{formatDuration((next.endsAt - now) / 1000)}</b>
        </span>
      )}
      {gps?.connected && (
        <span data-ok={gps.fix} title={gps.fix ? 'GPS fix' : 'GPS waiting for a fix'}>
          <Satellite />
        </span>
      )}
      {phone && (
        <span className="row" style={{ gap: 6 }} title={phone.name}>
          <SignalBars level={phone.signal} />
          <BatteryIcon percent={phone.battery?.percent} charging={phone.battery?.charging} size={19} />
          {phone.battery && <span className="num">{Math.round(phone.battery.percent)}%</span>}
        </span>
      )}
      <ChevronDown className="chev" />
    </button>
  );
}

export function StatusBar() {
  const route = useHeadUnit((s) => s.route);
  const layout = useHeadUnit((s) => s.layout);
  const pageId = useHeadUnit((s) => s.pageId);
  const editing = useHeadUnit((s) => s.editing);
  const conn = useHeadUnit((s) => s.conn);
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const setPage = useHeadUnit((s) => s.setPage);
  const setEditing = useHeadUnit((s) => s.setEditing);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const musicTab = useHeadUnit((s) => s.musicTab);
  const setMusicTab = useHeadUnit((s) => s.setMusicTab);
  const radioPlaying = useHeadUnit((s) => s.radio?.playing ?? false);
  const cameraCmd = useHeadUnit((s) => s.camera_cmd);
  const vehicleSource = useHeadUnit((s) => s.vehicle?.source);
  const vehicleConnected = useHeadUnit((s) => s.vehicle?.connected ?? false);
  const linkStatus = useHeadUnit((s) => s.vehicle?.link?.status);
  const go = useHeadUnit((s) => s.go);
  const back = useHeadUnit((s) => s.back);
  const demo = useHeadUnit((s) => s.demo);
  const appId = useHeadUnit((s) => s.appId);
  const setQuickPanel = useHeadUnit((s) => s.setQuickPanel);
  const now = useNow(10_000);
  const [sheet, setSheet] = useState<null | 'add' | 'page'>(null);
  const navItems = useResolvedNav();

  // Pull the bar down (like a phone's notification shade) to open the Quick Panel.
  const pull = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.isPrimary) pull.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    const dy = e.clientY - p.y;
    if (dy > 34 && dy > Math.abs(e.clientX - p.x) * 1.4) {
      pull.current = null;
      setQuickPanel(true);
    }
  };
  const onPointerEnd = () => {
    pull.current = null;
  };

  const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0]!;
  const { time, suffix } = formatClock(now, h24);
  const addPage = () => {
    const id = uid('p');
    setLayout({ ...layout, pages: [...layout.pages, { id, name: `Page ${layout.pages.length + 1}`, widgets: [] }] });
    setPage(id);
  };
  const title = route === 'app' ? (appById(appId)?.name ?? 'App') : TITLES[route];
  const musicTabs = [
    { id: 'spotify', label: demo ? 'Demo music' : 'Spotify' },
    { id: 'tidal', label: 'TIDAL' },
    { id: 'youtube-music', label: 'YouTube Music' },
    { id: 'radio', label: 'Radio' },
  ] as const;

  return (
    <header className="statusbar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <div className="sb-left">
        {showBack({ route, appId, musicTab }, navItems) && (
          <button type="button" className="icon-btn" aria-label="Back" onClick={back}>
            <ChevronLeft />
          </button>
        )}
        {route === 'home' ? (
          <TabStrip key="pages" activeKey={`${page.id}:${editing}:${layout.pages.map((p) => p.id).join(',')}`}>
            {layout.pages.map((p) => (
              <button key={p.id} type="button" role="tab" className="tab" data-active={p.id === page.id} onClick={() => (editing && p.id === page.id ? setSheet('page') : setPage(p.id))}>
                {p.name}
                {editing && p.id === page.id && <Pencil />}
              </button>
            ))}
            {editing && layout.pages.length < MAX_PAGES && (
              <button type="button" className="tab" aria-label="Add page" onClick={addPage}>
                <Plus />
              </button>
            )}
          </TabStrip>
        ) : route === 'media' ? (
          <TabStrip key="music" activeKey={musicTab}>
            {musicTabs.map((t) => (
              <button key={t.id} type="button" role="tab" className="tab" data-active={musicTab === t.id} onClick={() => setMusicTab(t.id)}>
                {t.label}
                {t.id === 'radio' && radioPlaying && <Eq on />}
              </button>
            ))}
          </TabStrip>
        ) : (
          <h1 className="sb-title" key={title}>
            {title}
          </h1>
        )}
      </div>

      {route !== 'nowplaying' && route !== 'media' && <NowPlayingTicker />}

      <div className="sb-right">
        {demo && (
          <span className="demo-tag" title="The server is running with simulated hardware">
            DEMO
          </span>
        )}
        {conn !== 'open' && (
          <span className="pill warn">
            <WifiOff size={15} /> Reconnecting
          </span>
        )}
        {vehicleSource === 'obd' && !vehicleConnected && (
          <button type="button" className="pill warn" onClick={() => go('vehicle')} aria-label="Vehicle data is not connected. Open Vehicle">
            <Car size={15} />
            {linkStatus === 'ecu-off' ? 'Car off' : linkStatus === 'error' ? 'OBD offline' : 'Connecting…'}
          </button>
        )}
        {route === 'home' &&
          (editing ? (
            <>
              <button type="button" className="btn small" onClick={() => setSheet('add')}>
                <Plus /> Widget
              </button>
              <button type="button" className="btn small primary" onClick={() => setEditing(false)}>
                <Check /> Done
              </button>
            </>
          ) : (
            <button type="button" className="icon-btn" aria-label="Edit dashboard" onClick={() => setEditing(true)}>
              <Pencil />
            </button>
          ))}
        <StatusCluster />
        <button type="button" className="icon-btn" aria-label="Show rear camera" onClick={() => cameraCmd('show')}>
          <Camera />
        </button>
        <span className="sb-clock">
          {time}
          {suffix && <small>{suffix}</small>}
        </span>
      </div>

      {sheet === 'add' && <AddWidgetSheet page={page} onClose={() => setSheet(null)} />}
      {sheet === 'page' && <PageSheet page={page} onClose={() => setSheet(null)} />}
    </header>
  );
}
