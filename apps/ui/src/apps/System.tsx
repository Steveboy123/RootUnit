import { AlertTriangle, BatteryCharging, CheckCircle2, Cpu, Gauge, HardDrive, Lightbulb, MemoryStick, Satellite, Smartphone, Thermometer, Video, type LucideIcon } from 'lucide-react';
import { RingGauge } from '../components/charts';
import { Banner, Cols, Empty, Page, Panel, Row, Stat, Stats, type Tone } from '../components/ui';
import { diskTone, loadTone, powerStatus, tempTone, uptimeText } from '../lib/health';
import { celsiusToDisplay, fmt, tempUnit } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';

function Ring({ icon: Icon, label, value, max, display, unit, tone, i }: { icon: LucideIcon; label: string; value: number | null; max: number; display: string; unit: string; tone?: Tone; i: number }) {
  return (
    <div className="sys-ring" style={{ ['--i' as string]: i }}>
      <RingGauge value={value} max={max} tone={tone} label={label} size={104}>
        <b>{display}</b>
        <small>{unit}</small>
      </RingGauge>
      <span>
        <Icon size={15} /> {label}
      </span>
    </div>
  );
}

/** How the Raspberry Pi itself is doing: power, heat, load, memory and storage. Power comes first because it is what goes wrong in a car. */
export function SystemApp() {
  const h = useSvc('health');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const gps = useSvc('gps');
  const dashcam = useSvc('dashcam');
  const lighting = useSvc('lighting');
  const vehicle = useHeadUnit((s) => s.vehicle);
  const devices = useHeadUnit((s) => s.devices);
  const demo = useHeadUnit((s) => s.demo);
  if (!h) return null;
  if (!h.available)
    return (
      <Page>
        <Empty icon={AlertTriangle} title="No system readings">
          The head unit could not read temperature, power or memory here. This page is for the Raspberry Pi itself.
        </Empty>
      </Page>
    );

  const power = powerStatus(h.throttle);
  const usedDisk = h.diskFreeGb !== null && h.diskTotalGb ? Math.max(0, h.diskTotalGb - h.diskFreeGb) : null;

  return (
    <Page subtitle={h.model ?? undefined}>
      <Banner tone={power.tone === 'ok' ? 'ok' : power.tone} icon={power.tone === 'ok' ? CheckCircle2 : BatteryCharging}>
        <b>{power.title}.</b> {power.detail}
      </Banner>

      <Panel title="Vital signs" icon={Cpu}>
        <div className="sys-rings stagger">
          <Ring i={0} icon={Thermometer} label="Temperature" value={h.cpuTempC} max={90} display={h.cpuTempC === null ? '—' : String(Math.round(celsiusToDisplay(h.cpuTempC, units)))} unit={tempUnit(units)} tone={tempTone(h.cpuTempC)} />
          <Ring i={1} icon={Cpu} label="CPU load" value={h.cpuLoadPct} max={100} display={h.cpuLoadPct === null ? '—' : String(Math.round(h.cpuLoadPct))} unit="%" tone={loadTone(h.cpuLoadPct)} />
          <Ring i={2} icon={MemoryStick} label="Memory" value={h.memUsedPct} max={100} display={h.memUsedPct === null ? '—' : String(Math.round(h.memUsedPct))} unit="% used" tone={loadTone(h.memUsedPct)} />
          <Ring i={3} icon={HardDrive} label="Storage" value={usedDisk} max={h.diskTotalGb ?? 1} display={h.diskFreeGb === null ? '—' : fmt(h.diskFreeGb, 1)} unit="GB free" tone={diskTone(h.diskFreeGb, h.diskTotalGb)} />
        </div>
      </Panel>

      <Cols min={320}>
        <Panel title="Details" icon={Cpu}>
          <Stats>
            <Stat label="Running for" value={uptimeText(h.uptimeS)} />
            <Stat label="Memory" value={h.memTotalMb ? `${fmt(h.memTotalMb / 1024, 1)}` : '—'} unit="GB" />
            <Stat label="Storage" value={h.diskTotalGb ? fmt(h.diskTotalGb, 0) : '—'} unit="GB" />
          </Stats>
          {h.throttle && (
            <small className="dim">
              Pi power flags: 0x{h.throttle.raw.toString(16)}. Under-voltage {h.throttle.underVoltageNow ? 'now' : h.throttle.underVoltageSince ? 'earlier' : 'never'}, throttled {h.throttle.throttledNow ? 'now' : h.throttle.throttledSince ? 'earlier' : 'never'}.
            </small>
          )}
        </Panel>

        <Panel title="Connected hardware" icon={CheckCircle2}>
          <div className="list">
            <Row icon={Gauge} label="Car data (OBD-II)" hint={demo ? 'Simulated' : vehicle?.link?.status === 'live' ? 'Live' : (vehicle?.link?.detail ?? 'Not connected')} tone={vehicle?.connected ? 'ok' : 'warn'} right={vehicle?.connected ? 'OK' : '—'} />
            <Row icon={Satellite} label="GPS" hint={gps?.fix ? `${gps.usedSatellites ?? '?'} satellites` : gps?.connected ? 'Waiting for a fix' : 'Receiver not found'} tone={gps?.fix ? 'ok' : 'warn'} right={gps?.fix ? 'Fix' : '—'} />
            <Row icon={Smartphone} label="Phone" hint={devices?.devices.find((d) => d.connected)?.name ?? 'None connected'} tone={devices?.devices.some((d) => d.connected) ? 'ok' : undefined} />
            <Row icon={Video} label="Dashcam" hint={dashcam?.recording ? 'Recording' : dashcam?.cameraPresent ? 'Camera ready' : 'No camera found'} tone={dashcam?.recording ? 'ok' : undefined} />
            <Row icon={Lightbulb} label="Ambient lights" hint={lighting?.connected ? `${lighting.device ?? 'WLED'} online` : lighting?.configured ? 'Not answering' : 'Not set up'} tone={lighting?.connected ? 'ok' : undefined} />
          </div>
        </Panel>
      </Cols>
    </Page>
  );
}
