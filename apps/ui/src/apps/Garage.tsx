import { useState } from 'react';
import { CalendarClock, CarFront, CheckCircle2, FileText, Fuel, Gauge, PencilLine, Plus, Wrench } from 'lucide-react';
import type { DocItem, DueItem, FuelEntry, GarageState, ServiceItem } from '@headunit/shared';
import { LineChart } from '../components/charts';
import { Badge, Banner, Cols, Empty, Page, Panel, Row, Segment, Sheet, Stat, Stats, useAction, type Tone } from '../components/ui';
import { apiRequest } from '../lib/api';
import { formatDate, formatDateShort } from '../lib/dates';
import { useTypingLocked } from '../lib/driving';
import { distUnit, economyToDisplay, economyUnit, fmt, kmToDisplay, litersToDisplay, volumeUnit } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';
import { DocForm, FuelForm, ServiceForm, VehicleForm } from './garage/forms';

type Tab = 'overview' | 'fuel' | 'service' | 'docs';
type Editing = { kind: 'vehicle' } | { kind: 'fuel'; entry?: FuelEntry } | { kind: 'service'; item?: ServiceItem } | { kind: 'doc'; doc?: DocItem } | null;

const TONE: Record<DueItem['status'], Tone> = { ok: 'ok', soon: 'warn', overdue: 'danger' };
const STATUS_TEXT: Record<DueItem['status'], string> = { ok: 'OK', soon: 'Due soon', overdue: 'Overdue' };

/** The car's logbook: fuel, service reminders and documents that expire. Reading is always fine; typing waits until parked. */
export function GarageApp() {
  const garage = useSvc('garage');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState<Editing>(null);
  const locked = useTypingLocked();
  const toast = useHeadUnit((s) => s.showToast);
  if (!garage) return null;

  const edit = (e: Editing) => (locked ? toast('Entering data is locked while driving. Pull over, or tap "I’m a passenger" in the Quick Panel.') : setEditing(e));
  const close = () => setEditing(null);
  const v = garage.vehicle;
  const odo = v.odometerKm === null ? null : Math.round(kmToDisplay(v.odometerKm, units));
  const attention = garage.due.filter((d) => d.status !== 'ok').length;

  return (
    <Page>
      <section className="card garage-hero">
        <span className="garage-hero-icon">
          <CarFront />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="display truncate">{v.name || 'My car'}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            {v.plate && <span className="plate">{v.plate}</span>}
            {v.fuelType && <Badge>{v.fuelType[0]!.toUpperCase() + v.fuelType.slice(1)}</Badge>}
            {attention > 0 ? <Badge tone="warn">{attention} need attention</Badge> : <Badge tone="ok">All good</Badge>}
          </div>
        </div>
        <div className="odo" aria-label={odo === null ? 'Odometer not set' : `Odometer ${odo} ${distUnit(units)}`}>
          {(odo === null ? '------' : String(odo).padStart(6, '0'))
            .split('')
            .map((c, i) => (
              <i key={i} style={{ ['--i' as string]: i }}>
                {c}
              </i>
            ))}
          <small>{distUnit(units)}</small>
        </div>
        <button type="button" className="icon-btn filled" aria-label="Edit vehicle" onClick={() => edit({ kind: 'vehicle' })}>
          <PencilLine />
        </button>
      </section>

      <Segment<Tab>
        label="Garage section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview', icon: Gauge },
          { value: 'fuel', label: 'Fuel', icon: Fuel },
          { value: 'service', label: 'Service', icon: Wrench },
          { value: 'docs', label: 'Documents', icon: FileText },
        ]}
      />
      <div className="tab-body col" key={tab}>
        {tab === 'overview' && <Overview garage={garage} onEdit={edit} onTab={setTab} />}
        {tab === 'fuel' && <FuelTab garage={garage} onEdit={edit} />}
        {tab === 'service' && <ServiceTab garage={garage} onEdit={edit} />}
        {tab === 'docs' && <DocsTab garage={garage} onEdit={edit} />}
      </div>

      {editing && (
        <Sheet title={sheetTitle(editing)} onClose={close}>
          {editing.kind === 'vehicle' && <VehicleForm garage={garage} onDone={close} />}
          {editing.kind === 'fuel' && <FuelForm garage={garage} entry={editing.entry} onDone={close} />}
          {editing.kind === 'service' && <ServiceForm garage={garage} item={editing.item} onDone={close} />}
          {editing.kind === 'doc' && <DocForm doc={editing.doc} onDone={close} />}
        </Sheet>
      )}
    </Page>
  );
}

function sheetTitle(e: NonNullable<Editing>): string {
  switch (e.kind) {
    case 'vehicle':
      return 'Vehicle';
    case 'fuel':
      return e.entry ? 'Edit fill-up' : 'Add a fill-up';
    case 'service':
      return e.item ? 'Edit service item' : 'Add a service item';
    case 'doc':
      return e.doc ? 'Edit document' : 'Add a document';
  }
}

function AddButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="btn small primary" onClick={onClick}>
      <Plus size={16} /> {label}
    </button>
  );
}

function Overview({ garage, onEdit, onTab }: { garage: GarageState; onEdit: (e: Editing) => void; onTab: (t: Tab) => void }) {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const s = garage.stats;
  const econ = (v: number | null) => (v === null ? '—' : fmt(economyToDisplay(v, units) ?? 0, 1));
  const attention = garage.due.filter((d) => d.status !== 'ok');

  return (
    <>
      {garage.vehicle.odometerKm === null && (
        <Banner
          tone="info"
          icon={CarFront}
          action={
            <button type="button" className="btn small primary" onClick={() => onEdit({ kind: 'vehicle' })}>
              Set odometer
            </button>
          }
        >
          Tell the Garage where the odometer stands, and every trip will add to it by itself.
        </Banner>
      )}
      <Cols min={320}>
        <Panel title="Coming up" icon={CalendarClock} aside={attention.length ? <Badge tone={attention.some((d) => d.status === 'overdue') ? 'danger' : 'warn'}>{attention.length}</Badge> : <Badge tone="ok">All good</Badge>}>
          {garage.due.length === 0 ? (
            <Empty icon={CheckCircle2} title="Nothing to track yet">
              Add the services your car needs, and the documents that expire, and the Garage will tell you before they are due.
            </Empty>
          ) : (
            <div className="list stagger">
              {garage.due.slice(0, 5).map((d, i) => (
                <div key={`${d.kind}${d.id}`} style={{ ['--i' as string]: i }}>
                  <Row icon={d.kind === 'doc' ? FileText : Wrench} tone={TONE[d.status]} label={d.name} hint={d.detail} right={<Badge tone={TONE[d.status]}>{STATUS_TEXT[d.status]}</Badge>} onClick={() => onTab(d.kind === 'doc' ? 'docs' : 'service')} />
                </div>
              ))}
              {garage.due.length > 5 && <small className="dim">and {garage.due.length - 5} more in Service and Documents</small>}
            </div>
          )}
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => onEdit({ kind: 'service' })}>
              <Plus size={16} /> Service item
            </button>
            <button type="button" className="btn small" onClick={() => onEdit({ kind: 'doc' })}>
              <Plus size={16} /> Document
            </button>
          </div>
        </Panel>

        <Panel title="Fuel economy" icon={Fuel} aside={<AddButton label="Fill-up" onClick={() => onEdit({ kind: 'fuel' })} />}>
          <Stats>
            <Stat label="Last fill" value={econ(s.lastLPer100)} unit={economyUnit(units)} />
            <Stat label="Average (last 5)" value={econ(s.avgLPer100)} unit={economyUnit(units)} />
            <Stat label="Spent this year" value={fmt(s.spentThisYear, 2)} hint={s.costPerKm !== null ? `${fmt(s.costPerKm * (units === 'metric' ? 1 : 1.609344), 3)} per ${distUnit(units)}` : undefined} />
          </Stats>
          {s.series.length < 2 && <small className="dim">Fill the tank to the brim at least twice, and log both, to see your consumption.</small>}
        </Panel>
      </Cols>
    </>
  );
}

function FuelTab({ garage, onEdit }: { garage: GarageState; onEdit: (e: Editing) => void }) {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const series = garage.stats.series;
  const points = series.map((p) => ({ label: formatDateShort(p.date), title: formatDate(p.date), value: economyToDisplay(p.lPer100, units) ?? p.lPer100 }));

  return (
    <Cols min={340}>
      <Panel title={`Consumption · ${economyUnit(units)}`} icon={Gauge} aside={<AddButton label="Fill-up" onClick={() => onEdit({ kind: 'fuel' })} />}>
        {series.length >= 2 ? (
          <LineChart points={points} unit={economyUnit(units)} format={(v) => fmt(v, 1)} />
        ) : (
          <Empty icon={Fuel} title="Not enough fill-ups yet">
            Consumption is measured between two fill-ups to the brim. Log your next two and a chart appears here.
          </Empty>
        )}
      </Panel>
      <Panel title="Fill-ups" icon={Fuel}>
        {garage.fuel.length === 0 ? (
          <Empty icon={Fuel} title="No fill-ups logged">
            Tap Fill-up the next time you fuel up.
          </Empty>
        ) : (
          <div className="list stagger">
            {garage.fuel.slice(0, 40).map((f, i) => (
              <div key={f.id} style={{ ['--i' as string]: i }}>
                <Row
                  icon={Fuel}
                  label={formatDate(f.date)}
                  hint={`${fmt(kmToDisplay(f.odometerKm, units))} ${distUnit(units)}${f.full ? '' : ' · part fill'}${f.note ? ` · ${f.note}` : ''}`}
                  right={
                    <span className="col num" style={{ gap: 0, alignItems: 'flex-end' }}>
                      <b>
                        {fmt(litersToDisplay(f.liters, units), 1)} {volumeUnit(units)}
                      </b>
                      {f.cost !== null && <small className="dim">{fmt(f.cost, 2)}</small>}
                    </span>
                  }
                  onClick={() => onEdit({ kind: 'fuel', entry: f })}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Cols>
  );
}

function ServiceTab({ garage, onEdit }: { garage: GarageState; onEdit: (e: Editing) => void }) {
  const { run } = useAction();
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  const dueOf = (id: string) => garage.due.find((d) => d.kind === 'service' && d.id === id);
  return (
    <Panel title="Service reminders" icon={Wrench} aside={<AddButton label="Add" onClick={() => onEdit({ kind: 'service' })} />}>
      {garage.services.length === 0 ? (
        <Empty icon={Wrench} title="No service items">
          Add oil changes, tyre rotations and the rest, with how often each is due.
        </Empty>
      ) : (
        <div className="list stagger">
          {garage.services.map((s, i) => {
            const d = dueOf(s.id);
            return (
              <div key={s.id} className="row" style={{ ['--i' as string]: i }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Row icon={Wrench} tone={d ? TONE[d.status] : undefined} label={s.name} hint={d?.detail} right={d && <Badge tone={TONE[d.status]}>{STATUS_TEXT[d.status]}</Badge>} onClick={() => onEdit({ kind: 'service', item: s })} />
                </div>
                <button type="button" className="btn small" onClick={() => (locked ? toast('Locked while driving') : void run(() => apiRequest(`/api/garage/services/${s.id}/done`, 'POST', {}), `${s.name}: done today`))}>
                  <CheckCircle2 size={16} /> Done
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function DocsTab({ garage, onEdit }: { garage: GarageState; onEdit: (e: Editing) => void }) {
  const dueOf = (id: string) => garage.due.find((d) => d.kind === 'doc' && d.id === id);
  return (
    <Panel title="Documents" icon={FileText} aside={<AddButton label="Add" onClick={() => onEdit({ kind: 'doc' })} />}>
      {garage.docs.length === 0 ? (
        <Empty icon={FileText} title="No documents">
          Insurance, inspection and road tax: add their expiry dates and get a warning before they lapse.
        </Empty>
      ) : (
        <div className="list stagger">
          {[...garage.docs]
            .sort((a, b) => a.expires.localeCompare(b.expires))
            .map((doc, i) => {
              const d = dueOf(doc.id);
              return (
                <div key={doc.id} style={{ ['--i' as string]: i }}>
                  <Row icon={FileText} tone={d ? TONE[d.status] : undefined} label={doc.name} hint={`${d?.detail ?? ''} · ${formatDate(doc.expires)}`} right={d && <Badge tone={TONE[d.status]}>{STATUS_TEXT[d.status]}</Badge>} onClick={() => onEdit({ kind: 'doc', doc })} />
                </div>
              );
            })}
        </div>
      )}
    </Panel>
  );
}
