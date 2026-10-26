import { useEffect, useMemo, useState } from 'react';
import { OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { computeAlerts } from '../lib/alerts';
import { useHeadUnit, useSvc } from '../store';

/** One slim banner for the most severe active alert. Dismissed alerts stay away until they clear and recur. */
export function AlertStrip() {
  const vehicle = useHeadUnit((s) => s.vehicle);
  const devices = useHeadUnit((s) => s.devices);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const active = devices?.devices.find((d) => d.connected && d.active);
  const health = useSvc('health');
  const garage = useSvc('garage');
  const weather = useSvc('weather');
  const alerts = useMemo(() => computeAlerts(vehicle, active, units, { health, garage, weather }), [vehicle, active, units, health, garage, weather]);

  // Forget dismissals for conditions that have cleared, so they can alert again next time.
  useEffect(() => {
    setDismissed((prev) => {
      const ids = new Set(alerts.map((a) => a.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [alerts]);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  const top = visible[0];
  if (!top) return null;
  const Icon = top.level === 'danger' ? OctagonAlert : TriangleAlert;
  return (
    <div className="alert-strip" data-level={top.level} role="alert" data-no-swipe key={top.id}>
      <Icon className="fx" />
      <span className="grow truncate">{top.text}</span>
      {visible.length > 1 && <span className="more">+{visible.length - 1} more</span>}
      <button type="button" className="icon-btn" style={{ width: 38, height: 38 }} aria-label="Dismiss alert" onClick={() => setDismissed((d) => new Set([...d, top.id]))}>
        <X />
      </button>
    </div>
  );
}
