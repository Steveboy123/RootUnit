import { useEffect, useState } from 'react';
import { ArrowLeftRight, Calculator, Clock, Fuel, Globe2, Plus, Receipt, X } from 'lucide-react';
import { ChoiceChips, Cols, NumberField, Page, Panel, Segment, Stat, Stats, Stepper } from '../components/ui';
import { QUANTITIES, WORLD_CITIES, convertUnit, shownNumber, tipSplit, tripCost, zoneTime, type Quantity } from '../lib/convert';
import { useNow } from '../lib/hooks';
import { displayToKm, displayToLiters, distUnit, economyFromDisplay, economyUnit, fmt, litersToDisplay, volumeUnit } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';

type Tool = 'convert' | 'split' | 'trip' | 'clocks';

/** Small sums for a parked car: unit conversion, splitting the bill, what a journey costs, and the time elsewhere. */
export function ToolsApp() {
  const [tool, setTool] = useState<Tool>('convert');
  return (
    <Page>
      <Segment<Tool>
        label="Tool"
        value={tool}
        onChange={setTool}
        options={[
          { value: 'convert', label: 'Convert', icon: ArrowLeftRight },
          { value: 'split', label: 'Split bill', icon: Receipt },
          { value: 'trip', label: 'Trip cost', icon: Fuel },
          { value: 'clocks', label: 'World clocks', icon: Globe2 },
        ]}
      />
      <div className="tab-body col" key={tool}>
        {tool === 'convert' ? <Converter /> : tool === 'split' ? <SplitBill /> : tool === 'trip' ? <TripCostTool /> : <WorldClocks />}
      </div>
    </Page>
  );
}

function Converter() {
  const [q, setQ] = useState<Quantity>('length');
  const def = QUANTITIES.find((x) => x.id === q)!;
  const [from, setFrom] = useState(def.units[0]!.id);
  const [value, setValue] = useState<number | null>(100);
  useEffect(() => setFrom(def.units[0]!.id), [def]);

  return (
    <Cols min={320}>
      <Panel title="Convert" icon={Calculator}>
        <ChoiceChips value={q} onChange={setQ} scroll options={QUANTITIES.map((x) => ({ value: x.id, label: x.label }))} />
        <NumberField label="Amount" value={value} onChange={setValue} />
        <ChoiceChips value={from} onChange={setFrom} options={def.units.map((u) => ({ value: u.id, label: u.label }))} />
      </Panel>
      <Panel title="Is" icon={ArrowLeftRight}>
        <div className="conv-out stagger" key={`${q}${from}`}>
          {def.units
            .filter((u) => u.id !== from)
            .map((u, i) => (
              <div key={u.id} className="conv-row" style={{ ['--i' as string]: i }}>
                <b className="num">{value === null ? '—' : shownNumber(convertUnit(q, value, from, u.id))}</b>
                <span className="dim">{u.label}</span>
              </div>
            ))}
        </div>
      </Panel>
    </Cols>
  );
}

const TIPS = ['0', '10', '12.5', '15', '20'] as const;

function SplitBill() {
  const [bill, setBill] = useState<number | null>(null);
  const [tip, setTip] = useState<(typeof TIPS)[number]>('10');
  const [people, setPeople] = useState(2);
  const s = bill === null ? null : tipSplit(bill, Number(tip), people);
  return (
    <Cols min={320}>
      <Panel title="The bill" icon={Receipt}>
        <NumberField label="Bill total" value={bill} onChange={setBill} placeholder="0.00" />
        <label className="lbl">Tip</label>
        <ChoiceChips value={tip} onChange={setTip} options={TIPS.map((t) => ({ value: t, label: `${t}%` }))} />
        <div className="row">
          <span className="grow">People</span>
          <Stepper label="People" value={people} min={1} max={20} onChange={setPeople} />
        </div>
      </Panel>
      <Panel title="Each pays" icon={Calculator}>
        <div className="big-answer num" key={s?.perPerson ?? 'none'}>
          {s ? fmt(s.perPerson, 2) : '—'}
        </div>
        <Stats cols={2}>
          <Stat label="Tip" value={s ? fmt(s.tip, 2) : '—'} />
          <Stat label="Total" value={s ? fmt(s.total, 2) : '—'} />
        </Stats>
        <small className="dim">Each share is rounded up to the cent, so the bill is always covered.</small>
      </Panel>
    </Cols>
  );
}

function TripCostTool() {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const avg = useSvc('garage')?.stats.avgLPer100 ?? null;
  const [dist, setDist] = useState<number | null>(100);
  const [econ, setEcon] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [people, setPeople] = useState(1);
  const l100 = econ === null ? avg : economyFromDisplay(econ, units);
  const perLitre = price === null ? null : price / displayToLiters(1, units);
  const r = dist !== null && l100 !== null && perLitre !== null ? tripCost(displayToKm(dist, units), l100, perLitre, people) : null;
  return (
    <Cols min={320}>
      <Panel title="The journey" icon={Fuel}>
        <NumberField label="Distance" unit={distUnit(units)} value={dist} onChange={setDist} />
        <NumberField label="Fuel economy" unit={economyUnit(units)} value={econ} onChange={setEcon} placeholder={avg !== null ? 'your average' : undefined} />
        <NumberField label={`Fuel price per ${volumeUnit(units) === 'L' ? 'litre' : 'gallon'}`} value={price} onChange={setPrice} />
        <div className="row">
          <span className="grow">Sharing the cost</span>
          <Stepper label="People" value={people} min={1} max={9} onChange={setPeople} />
        </div>
        {econ === null && avg !== null && <small className="dim">Using your average from the Garage.</small>}
      </Panel>
      <Panel title="It costs" icon={Calculator}>
        <div className="big-answer num" key={r?.cost ?? 'none'}>
          {r ? fmt(r.cost, 2) : '—'}
        </div>
        <Stats cols={2}>
          <Stat label="Fuel" value={r ? fmt(litersToDisplay(r.litres, units), 1) : '—'} unit={volumeUnit(units)} />
          <Stat label="Each" value={r && people > 1 ? fmt(r.perPerson, 2) : '—'} />
        </Stats>
      </Panel>
    </Cols>
  );
}

const CLOCKS_KEY = 'rootunit.clocks';
const readClocks = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(CLOCKS_KEY) ?? 'null') as unknown;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.slice(0, 6);
  } catch {
    /* private window or blocked storage: the defaults */
  }
  return ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
};

function WorldClocks() {
  const now = useNow(15_000);
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const [zones, setZones] = useState<string[]>(readClocks);
  const [adding, setAdding] = useState(false);
  const save = (z: string[]) => {
    setZones(z);
    try {
      localStorage.setItem(CLOCKS_KEY, JSON.stringify(z));
    } catch {
      /* not kept, still shown */
    }
  };
  return (
    <Panel
      title="World clocks"
      icon={Clock}
      aside={
        zones.length < 6 && (
          <button type="button" className="btn small" onClick={() => setAdding((a) => !a)}>
            <Plus size={16} /> City
          </button>
        )
      }
    >
      {adding && (
        <div className="chips">
          {WORLD_CITIES.filter((c) => !zones.includes(c.zone)).map((c) => (
            <button
              key={c.zone}
              type="button"
              className="chip"
              onClick={() => {
                save([...zones, c.zone]);
                setAdding(false);
              }}
            >
              {c.city}
            </button>
          ))}
        </div>
      )}
      <div className="clock-grid stagger">
        {zones.map((z, i) => {
          const t = zoneTime(z, now, h24);
          const city = WORLD_CITIES.find((c) => c.zone === z)?.city ?? z.split('/').pop()!.replace(/_/g, ' ');
          return (
            <div key={z} className="world-clock" style={{ ['--i' as string]: i }}>
              <b className="num">{t.time}</b>
              <span>{city}</span>
              <small className="dim">
                {t.day} · {t.offset}
              </small>
              <button type="button" className="icon-btn" aria-label={`Remove ${city}`} onClick={() => save(zones.filter((x) => x !== z))}>
                <X />
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
