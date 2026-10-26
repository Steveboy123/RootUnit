import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Cloud, Download, Eye, HardDriveDownload, Info, LayoutDashboard, Music, Navigation, PanelTop, RefreshCw, RotateCcw, Ruler, Sun, Volume2 } from 'lucide-react';
import { DEFAULT_LAUNCHER, DEFAULT_LAYOUT, DEFAULT_NAV, DEFAULT_PANEL, type MusicService, type MusicSource } from '@headunit/shared';
import { APPS } from '../../apps/registry';
import { ServiceCard } from '../../components/music/ServiceCard';
import { Banner, ChoiceChips, ConfirmButton, Segment, Slider, SwitchRow, Toggle } from '../../components/ui';
import { apiRequest, useApi } from '../../lib/api';
import { describeRestore, fileSize, type RestoreReport } from '../../lib/backup';
import { pickOpenService, providerLabel, useConnections } from '../../lib/connections';
import { whenText } from '../../lib/dates';
import { useTypingLocked } from '../../lib/driving';
import { openNavEditor } from '../../lib/nav';
import { buttonCount } from '../../lib/navEdit';
import { hiddenApps, movePanelTile, panelTileRows, PANEL_SECTIONS, QUICK_TILE_LABELS, showAllApps, toggleHidden, togglePanelTile } from '../../lib/surfaces';
import { QUICK_TILE_ICONS } from '../../shell/QuickPanel';
import { useHeadUnit } from '../../store';
import { APP_VERSION } from '../../version';
import { NavPreview } from './nav/NavPreview';
import { Field, SetSection } from './parts';
import { DOCK_INFO } from '../../lib/appearanceInfo';

const SOURCES: Array<{ value: MusicSource; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'tidal', label: 'TIDAL' },
];

export function MusicServicesSection() {
  const settings = useHeadUnit((s) => s.settings);
  const patch = useHeadUnit((s) => s.patchSettings);
  const provider = useHeadUnit((s) => s.media?.provider);
  const needsAuth = useHeadUnit((s) => s.media?.status === 'needs-auth');
  const { services, error, busy, reload, update } = useConnections();
  // Decided once, when the first answer arrives, so a card never folds itself away while it is in use.
  const [openFirst, setOpenFirst] = useState<MusicService | null | undefined>(undefined);
  useEffect(() => {
    if (services && openFirst === undefined) setOpenFirst(pickOpenService(services));
  }, [services, openFirst]);
  if (!settings) return null;
  return (
    <SetSection title="Music services" icon={Music} blurb="One service plays at a time; they are never mixed. Auto uses the first one you are signed in to.">
      <Segment label="Music source" value={settings.musicSource} onChange={(musicSource) => patch({ musicSource })} options={SOURCES} />
      <div className="dim small">
        Music is using: {providerLabel(provider)}
        {needsAuth ? ' (not signed in yet)' : ''}
      </div>
      {services === null && error && (
        <Banner
          tone="warn"
          action={
            <button type="button" className="btn small" onClick={() => void reload()}>
              Try again
            </button>
          }
        >
          {error}
        </Banner>
      )}
      {services === null && !error && <div className="dim">Loading…</div>}
      {services && openFirst !== undefined && (
        <div className="svc-list">
          {services.map((c) => (
            <ServiceCard key={c.service} conn={c} onChanged={update} collapsible defaultOpen={c.service === openFirst} />
          ))}
        </div>
      )}
      {services && error && !busy && <div className="dim small">Couldn’t refresh just now: {error}</div>}
      <SwitchRow label="Lock typing while driving" hint="Search and adding stations wait until you are below 8 km/h, or a passenger says so." on={settings.lockWhileDriving} onChange={(lockWhileDriving) => patch({ lockWhileDriving })} />
    </SetSection>
  );
}

const STANDBY = [0, 2, 5, 10, 30] as const;

export function DisplaySection() {
  const settings = useHeadUnit((s) => s.settings);
  const system = useHeadUnit((s) => s.system);
  const patch = useHeadUnit((s) => s.patchSettings);
  const patchSystem = useHeadUnit((s) => s.patchSystem);
  if (!settings || !system) return null;
  const standby = String(settings.standbyMin);
  const standbyOptions = [...STANDBY.map((m) => ({ value: String(m), label: m === 0 ? 'Never' : `${m} min` })), ...(STANDBY.some((m) => String(m) === standby) ? [] : [{ value: standby, label: `${standby} min` }])];
  return (
    <>
      <SetSection title="Display and sound" icon={Sun}>
        <div className="row" data-no-swipe>
          <Sun size={20} className="dim" />
          <Slider label="Brightness" min={5} value={system.brightness} onChange={(v) => patchSystem({ brightness: v })} throttleMs={150} />
          <b className="num set-num">{system.brightness}%</b>
        </div>
        <div className="row" data-no-swipe>
          <Volume2 size={20} className="dim" />
          <Slider label="Volume" value={system.volume} onChange={(v) => patchSystem({ volume: v, muted: false })} throttleMs={150} />
          <b className="num set-num">{system.volume}%</b>
        </div>
        {system.outputs.length > 0 && (
          <Field label="Sound comes out of" stack>
            <ChoiceChips value={String(system.outputs.find((o) => o.isDefault)?.id ?? '')} onChange={(id) => patchSystem({ output: Number(id) })} options={system.outputs.map((o) => ({ value: String(o.id), label: o.name }))} />
          </Field>
        )}
        {!system.hardwareBrightness && <div className="dim small">This screen’s backlight cannot be set, so it is dimmed in software.</div>}
      </SetSection>
      <SetSection title="Screen behaviour" icon={Eye}>
        <Field label="Standby clock" hint="After this long parked and untouched, the screen rests on a quiet clock. A touch wakes it." stack>
          <Segment label="Standby clock" value={standby} onChange={(v) => patch({ standbyMin: Number(v) })} options={standbyOptions} />
        </Field>
        <SwitchRow label="Open Drive when the car moves" hint="Big speed and the essentials. Music keeps playing." on={settings.driveAuto} onChange={(driveAuto) => patch({ driveAuto })} />
      </SetSection>
    </>
  );
}

export function NavigationSection() {
  const nav = useHeadUnit((s) => s.settings?.nav ?? DEFAULT_NAV);
  const dockStyle = useHeadUnit((s) => s.settings?.dockStyle ?? 'island');
  const panel = useHeadUnit((s) => s.settings?.panel ?? DEFAULT_PANEL);
  const launcher = useHeadUnit((s) => s.settings?.launcher ?? DEFAULT_LAUNCHER);
  const patch = useHeadUnit((s) => s.patchSettings);
  const locked = useTypingLocked();
  const n = buttonCount(nav);
  const hidden = hiddenApps(APPS, launcher.hidden);
  return (
    <>
      <SetSection title="Navigation" icon={Navigation} blurb="Hold any button on it for a moment to edit it too. Editing waits until you are parked.">
        <div className="nav-summary">
          <span className="nav-summary-pic" data-pos={nav.position}>
            <NavPreview config={nav} />
          </span>
          <span className="col" style={{ gap: 4 }}>
            <b>
              {DOCK_INFO[dockStyle].label}, {nav.position === 'bottom' ? 'along the bottom' : `on the ${nav.position}`}
            </b>
            <span className="dim small">
              {n} {n === 1 ? 'button' : 'buttons'}, {nav.size === 'compact' ? 'small' : nav.size === 'large' ? 'large' : 'medium'}
            </span>
          </span>
        </div>
        <div className="row wrap">
          <button type="button" className="btn primary" aria-haspopup="dialog" onClick={() => void openNavEditor()}>
            Edit navigation…
          </button>
          <ConfirmButton className="btn danger" label={locked ? 'Park to reset' : 'Reset navigation'} confirmLabel="Tap again to reset" disabled={locked} onConfirm={() => patch({ nav: DEFAULT_NAV })} />
        </div>
      </SetSection>

      <SetSection title="Quick Panel" icon={PanelTop} blurb="What the pull-down panel shows, in order. The sliders and the buttons along its bottom are always there.">
        {locked && <Banner>Park to change these.</Banner>}
        <ul className="sf-list" aria-label="Quick Panel tiles">
          {panelTileRows(panel.tiles).map(({ tile, shown, canUp, canDown }) => {
            const Icon = QUICK_TILE_ICONS[tile];
            const name = QUICK_TILE_LABELS[tile];
            return (
              <li key={tile} className="sf-row" data-off={!shown || undefined}>
                <Icon size={20} aria-hidden="true" />
                <span className="grow">{name}</span>
                <Toggle on={shown} disabled={locked} onChange={() => patch({ panel: { version: 1, tiles: [...togglePanelTile(panel.tiles, tile)] } })} label={`Show ${name}`} />
                <button type="button" className="icon-btn" aria-label={`Move ${name} earlier`} disabled={!canUp || locked} onClick={() => patch({ panel: { version: 1, tiles: [...movePanelTile(panel.tiles, tile, -1)] } })}>
                  <ArrowUp />
                </button>
                <button type="button" className="icon-btn" aria-label={`Move ${name} later`} disabled={!canDown || locked} onClick={() => patch({ panel: { version: 1, tiles: [...movePanelTile(panel.tiles, tile, 1)] } })}>
                  <ArrowDown />
                </button>
              </li>
            );
          })}
        </ul>
        {PANEL_SECTIONS.map(({ key, label, hint }) => (
          <SwitchRow key={key} label={label} hint={hint} on={panel.sections[key]} disabled={locked} onChange={(on) => patch({ panel: { version: 1, sections: { ...panel.sections, [key]: on } } })} />
        ))}
        <div className="row">
          <ConfirmButton className="btn" label="Reset Quick Panel" confirmLabel="Tap again to reset" disabled={locked} onConfirm={() => patch({ panel: { version: 1, tiles: [...DEFAULT_PANEL.tiles], sections: { ...DEFAULT_PANEL.sections } } })} />
        </div>
      </SetSection>

      <SetSection title="Apps launcher" icon={LayoutDashboard} blurb="Hold a tile on the Apps screen to hide an app you never use. An app that needs your attention still shows.">
        {hidden.length > 0 ? (
          <ul className="sf-list" aria-label="Hidden apps">
            {hidden.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.id} className="sf-row">
                  <Icon size={20} aria-hidden="true" />
                  <span className="grow">{a.name}</span>
                  <button type="button" className="btn small" aria-label={`Unhide ${a.name}`} disabled={locked} onClick={() => patch({ launcher: { version: 1, hidden: [...toggleHidden(launcher, a.id).hidden] } })}>
                    <Eye size={16} /> Unhide
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="set-blurb">No apps are hidden.</p>
        )}
        {launcher.hidden.length > 0 && (
          <div className="row">
            <ConfirmButton className="btn" label="Show all apps" confirmLabel="Tap again to show all" disabled={locked} onConfirm={() => patch({ launcher: { version: 1, hidden: [...showAllApps(launcher).hidden] } })} />
          </div>
        )}
      </SetSection>
    </>
  );
}

export function GeneralSection() {
  const settings = useHeadUnit((s) => s.settings);
  const patch = useHeadUnit((s) => s.patchSettings);
  const cameraCmd = useHeadUnit((s) => s.camera_cmd);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const setPage = useHeadUnit((s) => s.setPage);
  const setEditing = useHeadUnit((s) => s.setEditing);
  const go = useHeadUnit((s) => s.go);
  if (!settings) return null;
  return (
    <>
      <SetSection title="Units and clock" icon={Ruler}>
        <Field label="Units">
          <Segment
            label="Units"
            value={settings.units}
            onChange={(units) => patch({ units })}
            options={[
              { value: 'metric', label: 'km/h · °C' },
              { value: 'imperial', label: 'mph · °F' },
            ]}
          />
        </Field>
        <Field label="Clock">
          <Segment
            label="Clock"
            value={settings.clock24h ? '24' : '12'}
            onChange={(v) => patch({ clock24h: v === '24' })}
            options={[
              { value: '24', label: '24-hour' },
              { value: '12', label: '12-hour' },
            ]}
          />
        </Field>
      </SetSection>
      <SetSection title="Rear camera" icon={Camera} blurb="Shows by itself when something calls /api/camera/show (a reverse-gear signal, for example).">
        <SwitchRow label="Mirror the picture" on={settings.cameraMirror} onChange={(cameraMirror) => patch({ cameraMirror })} />
        <SwitchRow label="Parking guide lines" on={settings.cameraGuides} onChange={(cameraGuides) => patch({ cameraGuides })} />
        <div className="row">
          <button type="button" className="btn small" onClick={() => cameraCmd('show')}>
            <Camera size={16} /> Test the camera
          </button>
        </div>
      </SetSection>
      <SetSection title="Home dashboard" icon={LayoutDashboard}>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            onClick={() => {
              go('home');
              setEditing(true);
            }}
          >
            Edit the dashboard
          </button>
          <ConfirmButton
            className="btn danger"
            label="Restore the original layout"
            confirmLabel="Tap again to restore"
            onConfirm={() => {
              setLayout(structuredClone(DEFAULT_LAYOUT));
              setPage(DEFAULT_LAYOUT.pages[0]!.id);
            }}
          />
        </div>
      </SetSection>
      <SetSection title="Online extras" icon={Cloud} blurb="The only two features that use the internet for their own sake. Everything else works with none at all.">
        <SwitchRow label="Weather" hint="Asks open-meteo.com for the forecast, sending only where the car is, rounded to about 1 km." on={settings.weather} onChange={(weather) => patch({ weather })} />
        <SwitchRow label="Synced lyrics" hint="Asks lrclib.net for the words, sending the song’s title, artist, album and length." on={settings.lyrics} onChange={(lyrics) => patch({ lyrics })} />
      </SetSection>
    </>
  );
}

interface BackupFile {
  file: string;
  size: number;
  modifiedAt: string;
}
interface UpdateStatus {
  enabled: boolean;
  version: string;
  rollbackAvailable: boolean;
  downloadedUpdate?: { fileName: string; version: string; size: number; modifiedAt: string; isNewer: boolean };
}

export function MaintenanceSection() {
  const platform = useHeadUnit((s) => s.system?.platform);
  const demo = useHeadUnit((s) => s.demo);
  const vehicle = useHeadUnit((s) => s.vehicle);
  const projection = useHeadUnit((s) => s.projection);
  const [key, setKey] = useState(0);
  const backups = useApi<BackupFile[]>('/api/backup/available', key);
  const [result, setResult] = useState<{ summary: string; problems: string[]; ok: boolean } | { error: string } | null>(null);
  const restore = async (file: string) => {
    try {
      setResult(describeRestore(await apiRequest<RestoreReport>('/api/backup/restore', 'POST', { file })));
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'That backup could not be restored.' });
    }
  };
  const now = Date.now();
  return (
    <>
      <SetSection title="Backup and restore" icon={HardDriveDownload} blurb="Settings, dashboard, garage, trips, notes, scenes and stations. Sign-ins, passwords and web-hook addresses are never included.">
        <div className="row">
          <a className="btn primary" href="/api/backup" download onClick={() => window.setTimeout(() => setKey((k) => k + 1), 2500)}>
            <Download size={16} /> Save a backup
          </a>
        </div>
        {backups.data && backups.data.length > 0 ? (
          <ul className="sf-list" aria-label="Backups in Downloads">
            {backups.data.map((f) => (
              <li key={f.file} className="sf-row">
                <span className="grow col" style={{ gap: 0 }}>
                  <b>{whenText(new Date(f.modifiedAt), now)}</b>
                  <small className="dim">
                    {f.file} · {fileSize(f.size)}
                  </small>
                </span>
                <ConfirmButton className="btn small" icon={RotateCcw} label="Restore" confirmLabel="Tap again: replaces what is here" onConfirm={() => restore(f.file)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="set-blurb">{backups.loading ? 'Looking in Downloads…' : 'No backups in Downloads yet. Save one above, or copy one there.'}</p>
        )}
        {result && 'error' in result && <Banner tone="warn">{result.error}</Banner>}
        {result && 'summary' in result && (
          <Banner tone={result.ok ? 'ok' : 'warn'}>
            {result.summary}
            {result.problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </Banner>
        )}
      </SetSection>
      {platform?.startsWith('linux') && <SoftwareUpdate />}
      <SetSection title="About" icon={Info}>
        <Field label="Version">
          <span className="dim">{APP_VERSION}</span>
        </Field>
        {platform && (
          <Field label="Running on">
            <span className="dim">{platform}</span>
          </Field>
        )}
        <Field label="Car data">
          <span className="dim">{vehicle?.connected ? `OBD-II · ${vehicle.link?.adapter ?? 'adapter'}` : `OBD-II · ${vehicle?.link?.status === 'ecu-off' ? 'car off' : (vehicle?.link?.status ?? 'connecting')}`}</span>
        </Field>
        <Field label="Android Auto">
          <span className="dim">{projection?.mode === 'resident' ? `Resident app · ${projection.running ? 'running' : 'not running'}` : 'External app, on demand'}</span>
        </Field>
        {demo && (
          <Field label="Demo mode">
            <span className="dim">Simulated car and music</span>
          </Field>
        )}
      </SetSection>
    </>
  );
}

function SoftwareUpdate() {
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(0);
  const { data: status, error: statusError, loading } = useApi<UpdateStatus>('/api/update/status', key);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'download' | 'update' | 'rollback' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const restart = () => {
    setMessage('Installed. The head unit is restarting…');
    window.setTimeout(() => window.location.reload(), 6500);
  };
  const attempt = async (kind: 'download' | 'update' | 'rollback', start: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(kind);
    setError('');
    setMessage(start);
    try {
      await fn();
      restart();
    } catch (e) {
      setBusy(null);
      setMessage('');
      setError(e instanceof Error ? e.message : 'That did not work.');
      setKey((k) => k + 1);
    }
  };
  const install = () =>
    attempt('update', 'Checking and building the update…', async () => {
      const r = await fetch('/api/update/apply', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error || `Update failed (${r.status})`);
    });
  const dl = status?.downloadedUpdate;
  return (
    <SetSection
      title="Software update"
      icon={RefreshCw}
      aside={
        <button type="button" className="btn small" disabled={busy !== null} onClick={() => setKey((k) => k + 1)}>
          <RefreshCw size={16} /> Check
        </button>
      }
    >
      <Field label="Installed">
        <span className="dim">{loading ? 'Checking…' : (status?.version ?? 'Unknown')}</span>
      </Field>
      {status && !status.enabled && (
        <Banner tone="warn">
          The updater is not installed yet. Run this build’s <b>sudo ./install.sh</b> once; after that, updates install from here.
        </Banner>
      )}
      {statusError && <Banner tone="warn">{statusError.message}</Banner>}
      {status?.enabled && (
        <>
          <Field label="From Downloads" hint={dl ? `${dl.fileName} · v${dl.version} · ${(dl.size / 1048576).toFixed(1)} MB${dl.isNewer ? ' · newer' : ' · already installed or older'}` : 'Download the update ZIP in the head unit’s browser, then tap Check.'}>
            <button type="button" className="btn primary" disabled={!dl || busy !== null} onClick={() => void attempt('download', `Installing ${dl?.fileName}…`, () => apiRequest('/api/update/apply-downloaded', 'POST'))}>
              {busy === 'download' ? 'Installing…' : dl ? `Install v${dl.version}` : 'Install'}
            </button>
          </Field>
          <Field label="From a file" hint={file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'A ZIP from USB or another folder'}>
            <span className="row">
              <button type="button" className="btn" disabled={busy !== null} onClick={() => input.current?.click()}>
                Choose ZIP
              </button>
              <button type="button" className="btn primary" disabled={!file || busy !== null} onClick={() => void install()}>
                {busy === 'update' ? 'Updating…' : 'Install'}
              </button>
            </span>
          </Field>
          <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setError(''), setMessage(''))} />
          <Field label="Roll back" hint={status.rollbackAvailable ? 'The previous working version is kept.' : 'No previous version saved yet.'}>
            <ConfirmButton className="btn danger" label="Roll back" confirmLabel="Tap again to roll back" disabled={!status.rollbackAvailable || busy !== null} onConfirm={() => void attempt('rollback', 'Restoring the previous version…', () => apiRequest('/api/update/rollback', 'POST'))} />
          </Field>
          <p className="set-blurb">Your settings, sign-ins, wallpapers and Android Auto setup are kept. The update is built and checked before it replaces the running version.</p>
        </>
      )}
      {message && <Banner>{message}</Banner>}
      {error && <Banner tone="warn">{error}</Banner>}
    </SetSection>
  );
}
