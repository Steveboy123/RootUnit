import { useEffect, useState } from 'react';
import { Cable, Home, Smartphone, TriangleAlert, Usb } from 'lucide-react';
import type { ProjectionState } from '@headunit/shared';
import { Badge, Banner, Cols, Page, Panel, Row, Spinner, type Tone } from '../components/ui';
import { apiRequest } from '../lib/api';
import { useHeadUnit } from '../store';

/** Which of the page's four faces to show for the projection receiver's state. Kept pure so it can be tested on its own. */
export type AaView = 'running' | 'starting' | 'booting' | 'error' | 'ready';

export function aaView(p: ProjectionState): AaView {
  const resident = p.provider === 'external' && p.mode === 'resident';
  if (p.status === 'active') return 'running';
  if (p.status === 'starting') return 'starting';
  if (p.status === 'error') return 'error';
  if (resident && p.status === 'idle' && !p.running) return 'booting';
  return 'ready';
}

export interface WiredState {
  mode: string;
  connected: boolean;
  phones: Array<{ label: string; port: string }>;
  receiverConfigured: boolean;
  detail: string;
}

type Cmd = (c: 'launch' | 'stop') => void;

/** The receiver owns the screen: all this page can do is say so, and offer the way back. */
function OnScreen({ view, cmd }: { view: 'running' | 'starting'; cmd: Cmd }) {
  return (
    <div className="page">
      <div className="aa-onscreen">
        <div className="aa-pulse fx" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>{view === 'starting' ? <Spinner size={40} /> : <Smartphone size={44} />}</span>
        </div>
        <h2 className="display">{view === 'running' ? 'Android Auto is on screen' : 'Starting USB Android Auto…'}</h2>
        <p className="dim">{view === 'running' ? 'Using the configured native projection receiver.' : 'Waiting for the wired-capable receiver to open.'}</p>
        <button type="button" className="btn danger" onClick={() => cmd('stop')}>
          <Home /> Back to dashboard
        </button>
      </div>
    </div>
  );
}

/** The three things that have to be true before projection can start, each with where it stands. */
function Checklist({ usb }: { usb?: WiredState | null }) {
  const phone = usb?.connected === true;
  const receiver = usb?.receiverConfigured === true;
  const step = (n: number, label: string, hint: string, state: { tone: Tone | undefined; text: string }) => (
    <Row key={n} icon={n === 1 ? Usb : n === 2 ? Cable : Smartphone} label={`${n} · ${label}`} hint={hint} tone={state.tone === 'ok' ? 'ok' : undefined} right={<Badge tone={state.tone}>{state.text}</Badge>} />
  );
  return (
    <div className="list">
      {step(1, 'Phone on a USB cable', usb?.phones.length ? usb.phones.map((x) => `${x.label} (${x.port})`).join(', ') : (usb?.detail ?? 'Checking connected USB ports…'), phone ? { tone: 'ok', text: 'Detected' } : { tone: undefined, text: 'Not detected' })}
      {step(2, 'Wired Android Auto receiver', receiver ? 'External receiver command configured.' : 'Not installed or configured. A native wired USB projection engine is still required.', receiver ? { tone: 'ok', text: 'Ready' } : { tone: 'warn', text: 'Missing' })}
      {step(3, 'Start the projection', 'Tap Start once the phone and receiver are ready. Picture and sound run through the receiver.', phone && receiver ? { tone: 'info', text: 'Ready to start' } : { tone: undefined, text: 'Waiting' })}
    </div>
  );
}

/** Wired Android Auto. No developer mode, no ADB and no phone hotspot: a phone, a data cable and a native receiver. */
export function AndroidAutoView({ p, cmd, usb }: { p: ProjectionState; cmd: Cmd; usb?: WiredState | null }) {
  const view = aaView(p);
  if (view === 'running' || view === 'starting') return <OnScreen view={view} cmd={cmd} />;
  return (
    <Page title="Android Auto · Wired USB" subtitle="Connect your Android phone to a Pi USB host port with a DATA cable. No developer mode, no ADB, no phone hotspot." actions={usb?.connected ? <Badge tone="ok">USB device detected</Badge> : undefined}>
      {view === 'error' && (
        <Banner
          tone="warn"
          icon={TriangleAlert}
          action={
            <button type="button" className="btn small" onClick={() => cmd('stop')}>
              Dismiss
            </button>
          }
        >
          {p.detail || 'Projection receiver failed.'}
        </Banner>
      )}
      <Cols min={400}>
        <Panel title="Get connected" icon={Usb}>
          <p className="dim">Plug the phone into a USB-A port on the Raspberry Pi 5 with a quality data cable, and unlock it.</p>
          <Checklist usb={usb} />
          {usb?.detail && <p className="dim">{usb.detail}</p>}
          <button type="button" className="btn primary" disabled={!usb?.connected || !usb.receiverConfigured} onClick={() => cmd('launch')}>
            <Smartphone /> Start USB Android Auto
          </button>
          <p className="dim" style={{ fontSize: '0.82rem' }}>A detected phone does not yet prove that projection, audio, calls and touch work with your receiver: that depends on the receiver itself.</p>
        </Panel>
        <Panel title="Install a receiver" icon={Cable}>
          <p className="dim">The head unit can launch LIVI, a separate open-source wired Android Auto receiver, without letting its installer replace your dashboard.</p>
          <p>
            Run <code>./deploy/install-livi-wired.sh</code> from the head-unit directory as your desktop user. It downloads a pinned arm64 AppImage, checks its SHA-256 and registers it. The Chromium kiosk is left alone.
          </p>
          <p>
            Or use your own wired receiver: set <code>PROJECTION_COMMAND</code> in <code>.env</code>.
          </p>
          <p className="dim">
            Useful checks: <code>lsusb</code> and <code>ls -l /dev/bus/usb</code>. Reboot after changing udev or device permissions.
          </p>
        </Panel>
      </Cols>
    </Page>
  );
}

export function AndroidAutoPage() {
  const p = useHeadUnit((s) => s.projection);
  const cmd = useHeadUnit((s) => s.projection_cmd);
  const [usb, setUsb] = useState<WiredState | null>(null);
  // USB detection runs by itself, apart from the projection: poll while this page is open.
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const d = await apiRequest<WiredState>('/api/android-auto/usb');
        if (live) setUsb(d);
      } catch {
        if (live) setUsb(null);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2400);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return p ? <AndroidAutoView p={p} cmd={cmd} usb={usb} /> : null;
}
