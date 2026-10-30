import { AlertTriangle, CircleCheck, CircleHelp, Gauge as GaugeIcon, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { Banner, Badge, ConfirmButton, Cols, Page, Panel, Row, Spinner } from '../components/ui';
import { convert, unitLabel } from '../lib/format';
import { METRICS, metricLevel, reading } from '../lib/metrics';
import { useHeadUnit } from '../store';

const STATUS = {
  live: { text: 'Live', tone: 'ok' },
  'ecu-off': { text: 'Car not answering', tone: 'warn' },
  connecting: { text: 'Connecting…', tone: 'warn' },
  error: { text: 'Adapter problem', tone: 'danger' },
} as const;

function Connection() {
  const v = useHeadUnit((s) => s.vehicle);
  if (!v) return null;
  const st = STATUS[v.link?.status ?? 'connecting'];
  return (
    <Panel title="Connection" icon={Plug} aside={<Badge tone={st.tone} live={st.tone === 'ok'}>{st.text}</Badge>}>
      <div className="list">
        <Row label="Source" right={<b>OBD-II adapter</b>} />
        {v.link?.adapter && <Row label="Adapter" right={<b>{v.link.adapter}</b>} />}
        {v.link?.protocol && <Row label="Protocol" right={<b>{v.link.protocol}</b>} />}
      </div>
      {v.link?.detail && <Banner tone="warn">{v.link.detail}</Banner>}
    </Panel>
  );
}

function Sensors() {
  const v = useHeadUnit((s) => s.vehicle);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  if (!v) return null;
  return (
    <Panel title="What your car reports" icon={GaugeIcon}>
      <div className="sensor-grid stagger">
        {METRICS.map((m, i) => {
          const r = reading(v, m);
          const unsupported = v.unsupported?.includes(m.key);
          const level = r === null ? 'ok' : metricLevel(m, r);
          return (
            <div key={m.id} className="sensor" data-off={r === null} data-level={level} style={{ ['--i' as string]: i }}>
              <span className="eyebrow">{m.label}</span>
              <b className="num">
                {r === null ? '—' : convert(m.kind, units, r).toFixed(m.decimals)}
                {r !== null && <small>{unitLabel(m.kind, units)}</small>}
              </b>
              {unsupported && <em>not provided</em>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Faults() {
  const v = useHeadUnit((s) => s.vehicle);
  const d = useHeadUnit((s) => s.diagnostics);
  const cmd = useHeadUnit((s) => s.diagnostics_cmd);
  if (!v || !d) return null;
  const busy = d.status === 'reading' || d.status === 'clearing';
  const stored = d.codes.filter((c) => c.kind === 'stored');
  const nothing = d.readAt !== null && d.codes.length === 0;
  const unknown = v.mil === undefined || !v.connected;
  return (
    <Panel title="Check engine & fault codes" icon={AlertTriangle}>
      <div className="mil" data-state={unknown ? 'unknown' : v.mil!.on ? 'on' : 'off'}>
        <span className="mil-icon fx">{unknown ? <CircleHelp /> : v.mil!.on ? <AlertTriangle /> : <CircleCheck />}</span>
        <b>{unknown ? 'Check-engine status unknown' : v.mil!.on ? `Light is ON — ${v.mil!.count} stored code${v.mil!.count === 1 ? '' : 's'}` : 'Light is off'}</b>
      </div>
      {d.status === 'error' && <Banner tone="warn">{d.error}</Banner>}
      {nothing && !busy && <Banner tone="ok">No fault codes stored.</Banner>}
      {d.codes.length > 0 && (
        <ul className="dtcs stagger">
          {d.codes.map((c, i) => (
            <li key={`${c.kind}-${c.code}`} style={{ ['--i' as string]: i }}>
              <b className="dtc-code num">{c.code}</b>
              <span className="grow">{c.description ?? 'Manufacturer-specific code — search it for your make and model'}</span>
              <Badge tone={c.kind === 'stored' ? 'warn' : undefined}>{c.kind}</Badge>
            </li>
          ))}
        </ul>
      )}
      {d.readAt === null && !busy && d.status !== 'error' && <div className="dim">Codes haven’t been read yet.</div>}
      <div className="row wrap">
        <button type="button" className="btn" disabled={busy || !v.connected} onClick={() => cmd('read')}>
          {d.status === 'reading' ? <Spinner size={18} /> : <RefreshCw />} Read codes
        </button>
        <ConfirmButton label="Clear codes" icon={Trash2} confirmLabel="Tap again to clear" disabled={busy || !v.connected || stored.length === 0} onConfirm={() => cmd('clear')} />
      </div>
      <div className="dim" style={{ fontSize: '0.82rem' }}>
        Clearing turns the light off and resets the car’s emissions readiness monitors: it can take days of driving before an inspection will pass. Fix the cause first. Most cars only accept it with the engine off.
      </div>
    </Panel>
  );
}

export function VehiclePage() {
  return (
    <Page className="vehicle">
      <Cols min={380}>
        <Faults />
        <div className="col">
          <Connection />
          <Sensors />
        </div>
      </Cols>
    </Page>
  );
}
