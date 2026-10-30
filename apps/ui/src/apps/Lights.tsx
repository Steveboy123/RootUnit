import { useEffect, useState } from 'react';
import { Lightbulb, Palette, Power, Sparkles, Wifi } from 'lucide-react';
import type { LightingMode } from '@headunit/shared';
import { Badge, Banner, Cols, Empty, Page, Panel, Row, Segment, Slider, Stat, Stats, TextField, Toggle, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { briToPercent, checkLightsHost, COLOR_PRESETS, listEffects, MODE_INFO, normalizeHex, percentToBri } from '../lib/lights';
import { useHeadUnit, useSvc } from '../store';

const SHOWN_EFFECTS = 36;

type Patch = { host?: string; enabled?: boolean; brightness?: number; color?: string; mode?: LightingMode; effect?: number };
const send = (patch: Patch) => apiRequest('/api/lighting/update', 'POST', patch);

/** The address box, shared by first-time setup and later changes. */
function HostForm({ current, first }: { current: string; first: boolean }) {
  const [host, setHost] = useState(current);
  const { busy, run } = useAction();
  const problem = host.trim() === current ? null : checkLightsHost(host);
  const unchanged = host.trim() === current;
  return (
    <>
      <TextField label="ESP32 address on your Wi-Fi" value={host} onChange={setHost} placeholder="192.168.1.50" maxLength={15} />
      {problem && <Banner tone="warn">{problem}</Banner>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || unchanged || problem !== null} onClick={() => void run(() => send({ host: host.trim() }), host.trim() ? 'Address saved' : 'Address removed')}>
          {first ? 'Connect' : 'Save address'}
        </button>
      </div>
    </>
  );
}

/** Ambient lighting through a WLED controller (an ESP32 on the car’s Wi-Fi). */
export function LightsApp() {
  const lights = useSvc('lighting');
  const { busy, run } = useAction();
  const [bri, setBri] = useState(100);
  const [hex, setHex] = useState('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const follow = useHeadUnit((s) => s.settings?.lightsFollowAccent ?? false);
  const patchSettings = useHeadUnit((s) => s.patchSettings);

  // Follow the controller: it is the truth, and it may also be changed from its own app or button.
  const reportedBri = lights?.brightness;
  useEffect(() => {
    if (reportedBri !== undefined) setBri(briToPercent(reportedBri));
  }, [reportedBri]);
  const reportedColor = lights?.color;
  useEffect(() => {
    if (reportedColor) setHex(reportedColor);
  }, [reportedColor]);

  if (!lights) return null;

  if (!lights.configured) {
    return (
      <Page subtitle="Colour the inside of the car from the screen.">
        <Panel title="Connect your lights" icon={Lightbulb}>
          <Empty icon={Lightbulb} title="No lights connected yet">
            Flash an ESP32 with WLED, join it to the same Wi-Fi as the head unit, and type the address WLED shows. It stays on your own network, nothing goes to the internet.
          </Empty>
          <HostForm current="" first />
        </Panel>
      </Page>
    );
  }

  const effects = listEffects(lights.effects, query);
  const shown = all || query ? effects : effects.slice(0, SHOWN_EFFECTS);
  const color = normalizeHex(hex);
  const changeHex = (v: string) => {
    setHex(v);
    // Only a complete colour is sent: "#f80" on the way to "#f80000" must not flash orange.
    const n = /^#?[0-9a-f]{6}$/i.test(v.trim()) ? normalizeHex(v) : null;
    if (n) void run(() => send({ color: n }));
  };

  return (
    <Page subtitle={lights.connected ? `${lights.device ?? 'WLED'}${lights.leds ? ` · ${lights.leds} LEDs` : ''}` : undefined}>
      {!lights.connected && (
        <Banner tone="warn" icon={Wifi}>
          Can’t reach the lights at {lights.host}. {lights.detail} Is the ESP32 powered and on the same Wi-Fi?
        </Banner>
      )}

      <Cols min={360}>
        <Panel title="Lights" icon={Power} aside={<Badge tone={lights.connected ? 'ok' : 'warn'}>{lights.connected ? (lights.enabled ? 'On' : 'Off') : 'Not connected'}</Badge>}>
          <div className="lt-strip" data-on={lights.enabled && lights.connected} data-mode={lights.mode} style={{ ['--lt' as string]: color ?? '#ffffff', ['--lt-k' as string]: bri / 100 }} aria-hidden>
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} className="fx" style={{ ['--i' as string]: i }} />
            ))}
          </div>
          <Row icon={Power} label="Lights" hint={lights.enabled ? 'Shining' : 'Switched off'} right={<Toggle label="Lights on" on={lights.enabled} disabled={busy || !lights.connected} onChange={(on) => void run(() => send({ enabled: on }))} />} />
          <div className="row" data-no-swipe>
            <span className="dim" style={{ fontSize: '0.85rem', width: 84 }}>Brightness</span>
            <Slider label="Brightness" min={1} max={100} value={bri} throttleMs={250} onChange={(v) => { setBri(v); void run(() => send({ brightness: percentToBri(v) })); }} />
            <b className="num" style={{ width: 48, textAlign: 'right' }}>{bri}%</b>
          </div>
          <Segment<LightingMode>
            label="Light mode"
            value={lights.mode}
            options={(Object.keys(MODE_INFO) as LightingMode[]).map((m) => ({ value: m, label: MODE_INFO[m].label }))}
            onChange={(m) => void run(() => send({ mode: m }))}
          />
          <p className="dim small">{MODE_INFO[lights.mode].hint}</p>
          {lights.mode === 'pi-audio' && !lights.audioCapture && lights.enabled && (
            <Banner tone="warn">The music link is not running. Check that the Pi has PulseAudio or PipeWire tools (parec) installed.</Banner>
          )}
        </Panel>

        {lights.mode === 'manual' && (
          <Panel title="Colour" icon={Palette}>
            <label className="check-row">
              <Toggle on={follow} onChange={(lightsFollowAccent) => patchSettings({ lightsFollowAccent })} label="Match the screen" />
              <span>
                <b>Match the screen.</b> The lights take the interface’s accent colour, and the album’s colour while the accent follows the album art.
              </span>
            </label>
            <div className="lt-swatches" role="radiogroup" aria-label="Colour">
              {COLOR_PRESETS.map((p) => (
                <button key={p.hex} type="button" role="radio" aria-checked={color === p.hex} aria-label={p.name} className="lt-swatch" data-on={color === p.hex} style={{ background: p.hex }} onClick={() => changeHex(p.hex)} />
              ))}
            </div>
            <TextField label="Any colour (hex)" value={hex} onChange={changeHex} placeholder="#30a5ff" maxLength={7} />
            {hex !== '' && !color && <div className="dim small">Six letters or numbers 0–9 and A–F, like 30A5FF.</div>}
          </Panel>
        )}

        <Panel title="Effects" icon={Sparkles} aside={effects.length > 0 ? <span className="dim small">{effects.length}</span> : undefined}>
          {lights.effects.length === 0 ? (
            <Banner tone="info">The effect list shows when the lights are connected.</Banner>
          ) : (
            <>
              <TextField label="Find an effect" value={query} onChange={setQuery} placeholder="rainbow, fire, chase…" maxLength={40} />
              <div className="chips">
                {shown.map((e) => (
                  <button key={e.index} type="button" className="chip" disabled={busy || !lights.connected} onClick={() => void run(() => send({ effect: e.index }), e.name)}>
                    {e.name}
                  </button>
                ))}
                {shown.length === 0 && <span className="dim">No effect has that name.</span>}
              </div>
              {!all && !query && effects.length > SHOWN_EFFECTS && (
                <button type="button" className="btn small" onClick={() => setAll(true)}>
                  Show all {effects.length}
                </button>
              )}
            </>
          )}
        </Panel>

        <Panel title="The ESP32" icon={Wifi}>
          <Stats cols={2}>
            <Stat label="Address" value={lights.host} />
            <Stat label="State" value={lights.connected ? 'Connected' : 'Not reachable'} tone={lights.connected ? 'ok' : 'warn'} />
          </Stats>
          <HostForm current={lights.host} first={false} />
        </Panel>
      </Cols>
    </Page>
  );
}
