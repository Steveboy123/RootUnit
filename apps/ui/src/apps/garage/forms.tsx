import { useState } from 'react';
import { FUEL_TYPES, type DocItem, type FuelEntry, type FuelType, type GarageState, type ServiceItem } from '@headunit/shared';
import { ConfirmButton, DateField, NumberField, Segment, TextField, Toggle, useAction } from '../../components/ui';
import { apiRequest } from '../../lib/api';
import { todayIso } from '../../lib/dates';
import { displayToKm, displayToLiters, distUnit, kmToDisplay, litersToDisplay, volumeUnit } from '../../lib/units';
import { useHeadUnit } from '../../store';
import { Trash2 } from 'lucide-react';

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const useUnits = () => useHeadUnit((s) => s.settings?.units ?? 'metric');

/** The usual jobs, so a new item is a tap and a tweak rather than a blank form. Intervals are in kilometres and months. */
export const SERVICE_TEMPLATES: Array<{ name: string; everyKm: number | null; everyMonths: number | null }> = [
  { name: 'Oil & filter', everyKm: 15000, everyMonths: 12 },
  { name: 'Brake fluid', everyKm: null, everyMonths: 24 },
  { name: 'Tyre rotation', everyKm: 10000, everyMonths: null },
  { name: 'Air filter', everyKm: 30000, everyMonths: 24 },
  { name: 'Coolant', everyKm: null, everyMonths: 60 },
  { name: 'Brake pads check', everyKm: 20000, everyMonths: null },
  { name: 'Timing belt', everyKm: 100000, everyMonths: 72 },
];
export const DOC_TEMPLATES = ['Insurance', 'Inspection', 'Road tax', 'Registration', 'Breakdown cover'];

export function VehicleForm({ garage, onDone }: { garage: GarageState; onDone: () => void }) {
  const units = useUnits();
  const v = garage.vehicle;
  const { busy, run } = useAction();
  const [name, setName] = useState(v.name);
  const [plate, setPlate] = useState(v.plate);
  const [fuelType, setFuelType] = useState<FuelType | ''>(v.fuelType ?? '');
  const [tank, setTank] = useState<number | null>(v.tankL === null ? null : round(litersToDisplay(v.tankL, units)));
  const [odo, setOdo] = useState<number | null>(v.odometerKm === null ? null : round(kmToDisplay(v.odometerKm, units)));

  const save = async () => {
    const ok = await run(() =>
      apiRequest('/api/garage/vehicle', 'PUT', {
        name,
        plate,
        fuelType: fuelType || null,
        tankL: tank === null ? null : displayToLiters(tank, units),
        odometerKm: odo === null ? null : displayToKm(odo, units),
      }),
    );
    if (ok) onDone();
  };
  return (
    <>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} placeholder="My car" maxLength={40} />
        <TextField label="Number plate" value={plate} onChange={setPlate} maxLength={16} />
        <div className="wide">
          <label className="lbl">Fuel</label>
          <Segment<FuelType | ''>
            label="Fuel type"
            value={fuelType}
            onChange={setFuelType}
            options={[{ value: '' as const, label: 'None' }, ...FUEL_TYPES.map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1) }))]}
          />
        </div>
        <NumberField label="Tank size" unit={volumeUnit(units)} value={tank} onChange={setTank} placeholder="50" />
        <NumberField label="Odometer now" unit={distUnit(units)} value={odo} onChange={setOdo} placeholder="48250" />
      </div>
      <p className="dim small">With the tank size, trips can show how much fuel they used. After you set the odometer, every trip adds to it by itself.</p>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}

export function FuelForm({ garage, entry, onDone }: { garage: GarageState; entry?: FuelEntry; onDone: () => void }) {
  const units = useUnits();
  const { busy, run } = useAction();
  const odoNow = garage.vehicle.odometerKm;
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [odo, setOdo] = useState<number | null>(entry ? round(kmToDisplay(entry.odometerKm, units)) : odoNow === null ? null : round(kmToDisplay(odoNow, units)));
  const [liters, setLiters] = useState<number | null>(entry ? round(litersToDisplay(entry.liters, units), 2) : null);
  const [cost, setCost] = useState<number | null>(entry?.cost ?? null);
  const [full, setFull] = useState(entry?.full ?? true);
  const [note, setNote] = useState(entry?.note ?? '');

  const save = async () => {
    const body = { date, odometerKm: odo === null ? null : displayToKm(odo, units), liters: liters === null ? null : displayToLiters(liters, units), cost, full, note };
    const ok = await run(() => (entry ? apiRequest(`/api/garage/fuel/${entry.id}`, 'PUT', body) : apiRequest('/api/garage/fuel', 'POST', body)), entry ? 'Fill-up saved' : 'Fill-up added');
    if (ok) onDone();
  };
  const remove = () => run(async () => apiRequest(`/api/garage/fuel/${entry!.id}`, 'DELETE'), 'Deleted').then((ok) => ok && onDone());

  return (
    <>
      <div className="form-grid">
        <div className="wide">
          <DateField label="Date" value={date} onChange={setDate} />
        </div>
        <NumberField label="Odometer" unit={distUnit(units)} value={odo} onChange={setOdo} />
        <NumberField label="Fuel added" unit={volumeUnit(units)} value={liters} onChange={setLiters} />
        <NumberField label="Total cost" value={cost} onChange={setCost} placeholder="optional" />
        <TextField label="Note" value={note} onChange={setNote} placeholder="optional" maxLength={80} />
        <label className="check-row wide">
          <Toggle on={full} onChange={setFull} label="Filled to the brim" />
          <span>
            Filled to the brim <small className="dim">(needed to work out consumption)</small>
          </span>
        </label>
      </div>
      <div className="form-actions">
        {entry && <ConfirmButton label="Delete" icon={Trash2} onConfirm={remove} />}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          {entry ? 'Save' : 'Add fill-up'}
        </button>
      </div>
    </>
  );
}

export function ServiceForm({ garage, item, onDone }: { garage: GarageState; item?: ServiceItem; onDone: () => void }) {
  const units = useUnits();
  const { busy, run } = useAction();
  const km = (v: number | null) => (v === null ? null : round(kmToDisplay(v, units), 0));
  const [name, setName] = useState(item?.name ?? '');
  const [everyKm, setEveryKm] = useState<number | null>(km(item?.everyKm ?? null));
  const [everyMonths, setEveryMonths] = useState<number | null>(item?.everyMonths ?? null);
  const [done, setDone] = useState(item ? item.lastDate !== null || item.lastKm !== null : false);
  const [lastKm, setLastKm] = useState<number | null>(km(item?.lastKm ?? garage.vehicle.odometerKm));
  const [lastDate, setLastDate] = useState(item?.lastDate ?? todayIso());
  const [note, setNote] = useState(item?.note ?? '');

  const save = async () => {
    const body = {
      name,
      everyKm: everyKm === null ? null : displayToKm(everyKm, units),
      everyMonths,
      lastKm: done && lastKm !== null ? displayToKm(lastKm, units) : null,
      lastDate: done ? lastDate : null,
      note,
    };
    const ok = await run(() => (item ? apiRequest(`/api/garage/services/${item.id}`, 'PUT', body) : apiRequest('/api/garage/services', 'POST', body)), 'Saved');
    if (ok) onDone();
  };
  const remove = () => run(() => apiRequest(`/api/garage/services/${item!.id}`, 'DELETE'), 'Deleted').then((ok) => ok && onDone());

  return (
    <>
      {!item && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {SERVICE_TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              className="chip"
              data-active={name === t.name}
              onClick={() => {
                setName(t.name);
                setEveryKm(km(t.everyKm));
                setEveryMonths(t.everyMonths);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="form-grid">
        <TextField label="What" value={name} onChange={setName} placeholder="Oil & filter" maxLength={40} className="wide" />
        <NumberField label="Every" unit={distUnit(units)} value={everyKm} onChange={setEveryKm} placeholder="optional" />
        <NumberField label="Or every" unit="months" value={everyMonths} onChange={setEveryMonths} placeholder="optional" />
        <label className="check-row wide">
          <Toggle on={done} onChange={setDone} label="Done before" />
          <span>It has been done before</span>
        </label>
        {done && (
          <>
            <NumberField label="Last done at" unit={distUnit(units)} value={lastKm} onChange={setLastKm} />
            <div className="wide">
              <DateField label="Last done on" value={lastDate} onChange={setLastDate} />
            </div>
          </>
        )}
      </div>
      <div className="form-actions">
        {item && <ConfirmButton label="Delete" icon={Trash2} onConfirm={remove} />}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}

export function DocForm({ doc, onDone }: { doc?: DocItem; onDone: () => void }) {
  const { busy, run } = useAction();
  const [name, setName] = useState(doc?.name ?? '');
  const [expires, setExpires] = useState(doc?.expires ?? todayIso());
  const save = async () => {
    const ok = await run(() => (doc ? apiRequest(`/api/garage/docs/${doc.id}`, 'PUT', { name, expires }) : apiRequest('/api/garage/docs', 'POST', { name, expires })), 'Saved');
    if (ok) onDone();
  };
  const remove = () => run(() => apiRequest(`/api/garage/docs/${doc!.id}`, 'DELETE'), 'Deleted').then((ok) => ok && onDone());
  return (
    <>
      {!doc && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {DOC_TEMPLATES.map((t) => (
            <button key={t} type="button" className="chip" data-active={name === t} onClick={() => setName(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="form-grid">
        <TextField label="Document" value={name} onChange={setName} placeholder="Insurance" maxLength={40} className="wide" />
        <div className="wide">
          <DateField
            label="Expires on"
            value={expires}
            onChange={setExpires}
            jumps={[
              { label: '+6 months', months: 6 },
              { label: '+1 year', months: 12 },
            ]}
          />
        </div>
      </div>
      <div className="form-actions">
        {doc && <ConfirmButton label="Delete" icon={Trash2} onConfirm={remove} />}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}
