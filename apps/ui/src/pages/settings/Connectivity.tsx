import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bluetooth, Check, Lock, Pencil, Power, RefreshCw, Trash2, Wifi, X } from 'lucide-react';
import { apiRequest, useApi } from '../../lib/api';

interface WifiNetwork {
  ssid: string;
  bssid: string;
  signal: number;
  security: string;
  frequency: number;
  active: boolean;
  saved: boolean;
  savedUuid?: string | null;
}
interface WifiSaved {
  name: string;
  uuid: string;
  ssid: string;
  autoconnect: boolean;
  active: boolean;
}
interface WifiState {
  available: boolean;
  powered: boolean;
  device?: string;
  state?: string;
  connection?: string;
  ip4?: string;
  gateway?: string;
  networks: WifiNetwork[];
  saved: WifiSaved[];
  error?: string;
}
interface BluetoothDevice {
  address: string;
  name: string;
  alias: string;
  icon?: string;
  paired: boolean;
  trusted: boolean;
  connected: boolean;
  blocked: boolean;
  rssi?: number;
}
interface BluetoothState {
  available: boolean;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  controller?: string;
  devices: BluetoothDevice[];
  error?: string;
}
interface ConnectivityState {
  ok: boolean;
  wifi: WifiState;
  bluetooth: BluetoothState;
}

type Action =
  | 'wifi-power' | 'wifi-scan' | 'wifi-connect' | 'wifi-disconnect' | 'wifi-forget' | 'wifi-edit'
  | 'bt-power' | 'bt-scan' | 'bt-discoverable' | 'bt-pair' | 'bt-connect' | 'bt-disconnect' | 'bt-forget' | 'bt-trust' | 'bt-rename';

function Signal({ value }: { value: number }) {
  return (
    <span className="conn-signal" aria-label={`${value}% signal`} title={`${value}% signal`}>
      {[25, 45, 65, 85].map((n) => <i key={n} data-on={value >= n} />)}
    </span>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' }) {
  return <span className="conn-pill" data-tone={tone}>{children}</span>;
}

export function ConnectivitySettings() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useApi<ConnectivityState>('/api/connectivity/state', refreshKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const [wifiJoin, setWifiJoin] = useState<WifiNetwork | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [editWifi, setEditWifi] = useState<WifiSaved | null>(null);
  const [editWifiName, setEditWifiName] = useState('');
  const [editWifiPassword, setEditWifiPassword] = useState('');
  const [editWifiAuto, setEditWifiAuto] = useState(true);

  const [renameBt, setRenameBt] = useState<BluetoothDevice | null>(null);
  const [renameBtValue, setRenameBtValue] = useState('');

  useEffect(() => {
    if (busy || wifiJoin || editWifi || renameBt) return;
    const timer = window.setInterval(() => setRefreshKey((x) => x + 1), 8000);
    return () => window.clearInterval(timer);
  }, [busy, wifiJoin, editWifi, renameBt]);

  const run = async (action: Action, payload: Record<string, unknown> = {}, label?: string) => {
    setBusy(action);
    setMessage(label ?? 'Applying…');
    setActionError('');
    try {
      await apiRequest('/api/connectivity/action', 'POST', { action, payload });
      setRefreshKey((x) => x + 1);
      setMessage('');
      return true;
    } catch (e) {
      setMessage('');
      setActionError(e instanceof Error ? e.message : 'Connectivity action failed');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const activeWifi = data?.wifi.networks.find((n) => n.active);
  const visibleWifi = useMemo(() => {
    const src = data?.wifi.networks ?? [];
    const best = new Map<string, WifiNetwork>();
    for (const n of src) {
      const old = best.get(n.ssid);
      if (!old || n.active || n.signal > old.signal) best.set(n.ssid, n);
    }
    return [...best.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal).slice(0, 10);
  }, [data?.wifi.networks]);

  const joinWifi = async () => {
    if (!wifiJoin) return;
    const ok = await run('wifi-connect', {
      ssid: wifiJoin.ssid,
      bssid: wifiJoin.bssid,
      password: wifiPassword,
      device: data?.wifi.device,
    }, `Connecting to ${wifiJoin.ssid}…`);
    if (ok) {
      setWifiJoin(null);
      setWifiPassword('');
    }
  };

  const saveWifiEdit = async () => {
    if (!editWifi) return;
    const ok = await run('wifi-edit', {
      uuid: editWifi.uuid,
      name: editWifiName,
      password: editWifiPassword,
      autoconnect: editWifiAuto,
      reconnect: editWifi.active,
      device: data?.wifi.device,
    }, 'Saving Wi-Fi network…');
    if (ok) {
      setEditWifi(null);
      setEditWifiPassword('');
    }
  };

  const wifi = data?.wifi;
  const bt = data?.bluetooth;

  return (
    <section className="set-section wide connectivity-section">
      <div className="conn-title-row">
        <div>
          <h3>Wi-Fi & Bluetooth</h3>
          <div className="dim small">Manage the Pi’s phone hotspot/internet connection and paired Bluetooth devices without leaving the head-unit UI.</div>
        </div>
        <button className="btn small" disabled={!!busy} onClick={() => setRefreshKey((x) => x + 1)}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {(error || actionError) && <div className="notice warn">{actionError || error?.message}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="connectivity-grid">
        <div className="conn-panel">
          <div className="conn-panel-head">
            <div className="conn-panel-name"><Wifi size={22} /><b>Wi-Fi</b></div>
            <button
              className="btn small"
              data-on={wifi?.powered || undefined}
              disabled={!wifi?.available || !!busy}
              onClick={() => void run('wifi-power', { enabled: !wifi?.powered }, wifi?.powered ? 'Turning Wi-Fi off…' : 'Turning Wi-Fi on…')}
            >
              <Power size={15} /> {wifi?.powered ? 'On' : 'Off'}
            </button>
          </div>

          {!wifi?.available && <div className="notice warn">{wifi?.error ?? 'No Wi-Fi adapter found.'}</div>}
          {wifi?.available && (
            <>
              <div className="conn-current" data-active={!!activeWifi}>
                <div>
                  <span className="dim small">Current connection</span>
                  <b>{activeWifi?.ssid || wifi.connection || (wifi.powered ? 'Not connected' : 'Wi-Fi off')}</b>
                  <span className="dim small">{wifi.device || 'Wi-Fi'}{wifi.ip4 ? ` · ${wifi.ip4}` : ''}</span>
                </div>
                {activeWifi && <Signal value={activeWifi.signal} />}
                {activeWifi && (
                  <button className="btn small" disabled={!!busy} onClick={() => void run('wifi-disconnect', { device: wifi.device }, 'Disconnecting Wi-Fi…')}>Disconnect</button>
                )}
              </div>

              <div className="conn-subhead">
                <b>Nearby networks</b>
                <button className="btn small" disabled={!wifi.powered || !!busy} onClick={() => void run('wifi-scan', {}, 'Scanning Wi-Fi…')}>
                  <RefreshCw size={15} className={busy === 'wifi-scan' ? 'spin' : ''} /> Scan
                </button>
              </div>
              <div className="conn-list">
                {wifi.powered && visibleWifi.length === 0 && <div className="dim small conn-empty">No networks found. Tap Scan.</div>}
                {visibleWifi.map((n) => (
                  <div className="conn-row" key={`${n.ssid}-${n.bssid}`} data-active={n.active || undefined}>
                    <Signal value={n.signal} />
                    <div className="conn-main">
                      <b>{n.ssid}</b>
                      <span className="dim small">{n.security === 'Open' ? 'Open network' : n.security}{n.frequency ? ` · ${n.frequency >= 5000 ? '5 GHz' : '2.4 GHz'}` : ''}</span>
                    </div>
                    {n.saved && <Pill>Saved</Pill>}
                    {n.active ? <Pill tone="good"><Check size={12} /> Connected</Pill> : (
                      <button
                        className="btn primary small"
                        disabled={!!busy}
                        onClick={() => {
                          if (n.savedUuid) void run('wifi-connect', { uuid: n.savedUuid, device: wifi.device }, `Connecting to ${n.ssid}…`);
                          else if (n.security === 'Open') void run('wifi-connect', { ssid: n.ssid, bssid: n.bssid, device: wifi.device }, `Connecting to ${n.ssid}…`);
                          else { setWifiJoin(n); setWifiPassword(''); setActionError(''); }
                        }}
                      >Connect</button>
                    )}
                  </div>
                ))}
              </div>

              {wifi.saved.length > 0 && (
                <details className="conn-saved">
                  <summary>Saved networks <span>{wifi.saved.length}</span></summary>
                  <div className="conn-list">
                    {wifi.saved.map((s) => (
                      <div className="conn-row" key={s.uuid} data-active={s.active || undefined}>
                        <Wifi size={18} />
                        <div className="conn-main">
                          <b>{s.ssid}</b>
                          <span className="dim small">{s.name}{s.autoconnect ? ' · Auto-connect' : ' · Manual connect'}</span>
                        </div>
                        {!s.active && <button className="btn small" disabled={!!busy} onClick={() => void run('wifi-connect', { uuid: s.uuid, device: wifi.device }, `Connecting to ${s.ssid}…`)}>Connect</button>}
                        <button className="icon-btn" aria-label={`Edit ${s.ssid}`} onClick={() => { setEditWifi(s); setEditWifiName(s.name); setEditWifiPassword(''); setEditWifiAuto(s.autoconnect); }}><Pencil size={16} /></button>
                        <button className="icon-btn danger" aria-label={`Forget ${s.ssid}`} disabled={!!busy} onClick={() => void run('wifi-forget', { uuid: s.uuid }, `Forgetting ${s.ssid}…`)}><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <div className="conn-panel">
          <div className="conn-panel-head">
            <div className="conn-panel-name"><Bluetooth size={22} /><b>Bluetooth</b></div>
            <button
              className="btn small"
              data-on={bt?.powered || undefined}
              disabled={!bt?.available || !!busy}
              onClick={() => void run('bt-power', { enabled: !bt?.powered }, bt?.powered ? 'Turning Bluetooth off…' : 'Turning Bluetooth on…')}
            >
              <Power size={15} /> {bt?.powered ? 'On' : 'Off'}
            </button>
          </div>

          {!bt?.available && <div className="notice warn">{bt?.error ?? 'No Bluetooth controller found.'}</div>}
          {bt?.available && (
            <>
              <div className="conn-toolbar">
                <button className="btn" disabled={!bt.powered || !!busy} onClick={() => void run('bt-scan', {}, 'Scanning Bluetooth for 6 seconds…')}>
                  <RefreshCw size={15} className={busy === 'bt-scan' ? 'spin' : ''} /> Scan
                </button>
                <button className="btn" data-on={bt.discoverable || undefined} disabled={!bt.powered || !!busy} onClick={() => void run('bt-discoverable', { enabled: !bt.discoverable }, bt.discoverable ? 'Hiding this head unit…' : 'Making head unit discoverable for 2 minutes…')}>
                  {bt.discoverable ? 'Discoverable' : 'Make discoverable'}
                </button>
              </div>
              <div className="dim small">Pairing uses car-style “Just Works”. Keep the phone’s Bluetooth screen open and confirm the pairing request there if it appears.</div>

              <div className="conn-list bt-list">
                {bt.powered && bt.devices.length === 0 && <div className="dim small conn-empty">No Bluetooth devices found. Make your phone discoverable, then tap Scan.</div>}
                {bt.devices.map((d) => (
                  <div className="conn-row bt-row" key={d.address} data-active={d.connected || undefined}>
                    <Bluetooth size={18} />
                    <div className="conn-main">
                      <b>{d.alias || d.name}</b>
                      <span className="dim small">{d.address}{d.paired ? ' · Paired' : ' · Not paired'}{d.trusted ? ' · Trusted' : ''}</span>
                    </div>
                    {d.connected && <Pill tone="good"><Check size={12} /> Connected</Pill>}
                    {!d.paired ? (
                      <button className="btn primary small" disabled={!!busy} onClick={() => void run('bt-pair', { address: d.address }, `Pairing ${d.alias || d.name}…`)}>Pair</button>
                    ) : d.connected ? (
                      <button className="btn small" disabled={!!busy} onClick={() => void run('bt-disconnect', { address: d.address }, `Disconnecting ${d.alias || d.name}…`)}>Disconnect</button>
                    ) : (
                      <button className="btn primary small" disabled={!!busy} onClick={() => void run('bt-connect', { address: d.address }, `Connecting ${d.alias || d.name}…`)}>Connect</button>
                    )}
                    {d.paired && (
                      <button className="icon-btn" aria-label={`Rename ${d.alias || d.name}`} onClick={() => { setRenameBt(d); setRenameBtValue(d.alias || d.name); }}><Pencil size={16} /></button>
                    )}
                    {d.paired && (
                      <button className="icon-btn danger" aria-label={`Forget ${d.alias || d.name}`} disabled={!!busy} onClick={() => void run('bt-forget', { address: d.address }, `Forgetting ${d.alias || d.name}…`)}><Trash2 size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {wifiJoin && (
        <div className="conn-editor" role="dialog" aria-modal="true" aria-label={`Connect to ${wifiJoin.ssid}`}>
          <div className="conn-editor-card">
            <div className="conn-editor-head"><b>Connect to {wifiJoin.ssid}</b><button className="icon-btn" onClick={() => setWifiJoin(null)}><X size={18} /></button></div>
            <label className="conn-field"><span><Lock size={14} /> Wi-Fi password</span><input autoFocus type="password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="Password" autoComplete="off" /></label>
            <div className="conn-editor-actions"><button className="btn" onClick={() => setWifiJoin(null)}>Cancel</button><button className="btn primary" disabled={!!busy || !wifiPassword} onClick={() => void joinWifi()}>Connect</button></div>
          </div>
        </div>
      )}

      {editWifi && (
        <div className="conn-editor" role="dialog" aria-modal="true" aria-label={`Edit ${editWifi.ssid}`}>
          <div className="conn-editor-card">
            <div className="conn-editor-head"><b>Edit {editWifi.ssid}</b><button className="icon-btn" onClick={() => setEditWifi(null)}><X size={18} /></button></div>
            <label className="conn-field"><span>Connection name</span><input value={editWifiName} onChange={(e) => setEditWifiName(e.target.value)} /></label>
            <label className="conn-field"><span>New password <small className="dim">(leave blank to keep current)</small></span><input type="password" value={editWifiPassword} onChange={(e) => setEditWifiPassword(e.target.value)} autoComplete="off" /></label>
            <label className="conn-check"><input type="checkbox" checked={editWifiAuto} onChange={(e) => setEditWifiAuto(e.target.checked)} /> Auto-connect to this network</label>
            <div className="conn-editor-actions"><button className="btn" onClick={() => setEditWifi(null)}>Cancel</button><button className="btn primary" disabled={!!busy || !editWifiName.trim()} onClick={() => void saveWifiEdit()}>Save</button></div>
          </div>
        </div>
      )}

      {renameBt && (
        <div className="conn-editor" role="dialog" aria-modal="true" aria-label={`Rename ${renameBt.alias || renameBt.name}`}>
          <div className="conn-editor-card">
            <div className="conn-editor-head"><b>Rename Bluetooth device</b><button className="icon-btn" onClick={() => setRenameBt(null)}><X size={18} /></button></div>
            <label className="conn-field"><span>Display name</span><input autoFocus value={renameBtValue} onChange={(e) => setRenameBtValue(e.target.value)} maxLength={64} /></label>
            <label className="conn-check"><input type="checkbox" checked={renameBt.trusted} onChange={(e) => setRenameBt({ ...renameBt, trusted: e.target.checked })} /> Trusted / reconnect automatically when supported</label>
            <div className="conn-editor-actions">
              <button className="btn" onClick={() => setRenameBt(null)}>Cancel</button>
              <button className="btn primary" disabled={!!busy || !renameBtValue.trim()} onClick={async () => {
                if (!renameBt) return;
                const renamed = await run('bt-rename', { address: renameBt.address, alias: renameBtValue }, 'Renaming Bluetooth device…');
                if (renamed) await run('bt-trust', { address: renameBt.address, trusted: renameBt.trusted }, 'Saving Bluetooth settings…');
                if (renamed) setRenameBt(null);
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
