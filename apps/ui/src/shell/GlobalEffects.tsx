import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { TimerItem } from '@headunit/shared';
import { apiRequest } from '../lib/api';
import { shouldEnterStandby, shouldLeaveStandby, stepDriveAuto, type DriveAutoState } from '../lib/autoModes';
import { playChime } from '../lib/chime';
import { isEditLocked, liveSpeedKmh } from '../lib/driving';
import { useNow } from '../lib/hooks';
import { DEFAULT_NAV } from '@headunit/shared';
import { browserHintStorage, NAV_HINT_DELAY_MS, NAV_HINT_TEXT, takeNavHint } from '../lib/nav/hint';
import { sameNav } from '../lib/navEdit';
import { useHeadUnit, useSvc } from '../store';
import { useAction } from '../components/ui';

/**
 * Things that happen without being asked: the standby clock after idle time, the Drive screen when the car sets off, and the
 * alarm when a timer runs out. It draws only the alarm; the rest changes the store.
 */
export function GlobalEffects() {
  useStandbyEffects();
  useDriveAuto();
  useNavHint();
  return <TimerAlarm />;
}

/** One tip, once per browser, a while after start: only on Home, parked, with the navigation still as it came and nothing open over it. */
function useNavHint() {
  const ready = useHeadUnit((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const st = useHeadUnit.getState();
      const untouched = st.settings !== null && sameNav(st.settings.nav, DEFAULT_NAV);
      if (st.route !== 'home' || st.quickPanel || st.navEditor || st.standby || !untouched || isEditLocked()) return;
      if (takeNavHint(browserHintStorage())) st.showToast(NAV_HINT_TEXT);
    }, NAV_HINT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [ready]);
}

function useSpeed(): number | null {
  const vehicle = useHeadUnit((s) => s.vehicle);
  const gps = useSvc('gps');
  return liveSpeedKmh(vehicle, gps);
}

/** Standby comes up after the configured idle time while parked, and goes away when the car moves, the camera or Android Auto starts. */
function useStandbyEffects() {
  const standbyMin = useHeadUnit((s) => s.settings?.standbyMin ?? 0);
  const standby = useHeadUnit((s) => s.standby);
  const route = useHeadUnit((s) => s.route);
  const cameraActive = useHeadUnit((s) => s.camera?.active ?? false);
  const projectionActive = useHeadUnit((s) => s.projection?.status === 'active');
  const setStandby = useHeadUnit((s) => s.setStandby);
  const speed = useSpeed();
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    const touch = () => (lastTouch.current = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, touch, { capture: true, passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
    };
  }, []);

  // Music keeps the screen "in use" no more than a touch does; a parked car with a playing song still gets its clock.
  const input = { standbyMin, standby, route, cameraActive, projectionActive, speedKmh: speed };
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    const id = window.setInterval(() => {
      const i = latest.current;
      if (shouldLeaveStandby(i)) setStandby(false);
      else if (shouldEnterStandby({ ...i, idleMs: Date.now() - lastTouch.current })) setStandby(true);
    }, 5000);
    return () => window.clearInterval(id);
  }, [setStandby]);
  useEffect(() => {
    if (shouldLeaveStandby(input)) setStandby(false);
  });
}

/** Opens the Drive screen when the car sets off, once per journey, and only from Home (never yanking someone out of another page). */
function useDriveAuto() {
  const enabled = useHeadUnit((s) => s.settings?.driveAuto ?? false);
  const route = useHeadUnit((s) => s.route);
  const go = useHeadUnit((s) => s.go);
  const speed = useSpeed();
  const state = useRef<DriveAutoState>({ movingSince: null, armed: true });
  const now = useNow(1000);
  useEffect(() => {
    const r = stepDriveAuto(state.current, enabled ? speed : null, now.getTime());
    state.current = r.state;
    if (r.trigger && route === 'home') go('drive');
  }, [now, speed, enabled, route, go]);
}

/** A card with a chime when a timer, the parking meter or any countdown has run out. It stays until it is answered. */
function TimerAlarm() {
  const timers = useSvc('timers');
  const toast = useHeadUnit((s) => s.showToast);
  const now = useNow(1000).getTime();
  const { run } = useAction();
  const rung = useRef(new Map<string, number>());
  const [ringing, setRinging] = useState<TimerItem[]>([]);

  useEffect(() => {
    const due = (timers?.items ?? []).filter((t) => t.kind !== 'sleep' && t.endsAt <= now);
    setRinging((prev) => (prev.length === due.length && prev.every((p, i) => p.id === due[i]?.id) ? prev : due));
    for (const t of due) {
      // First ring at once, then every 4 seconds for a minute; after that the card waits quietly.
      const last = rung.current.get(t.id);
      if (last === undefined || (now - last >= 4000 && now - t.endsAt < 60_000)) {
        rung.current.set(t.id, now);
        playChime();
      }
    }
    for (const id of [...rung.current.keys()]) if (!timers?.items.some((t) => t.id === id)) rung.current.delete(id);
  }, [timers, now]);

  if (ringing.length === 0) return null;
  const t = ringing[0]!;
  const dismiss = () => run(() => apiRequest(`/api/timers/${t.id}`, 'DELETE'));
  const snooze = () =>
    run(async () => {
      await apiRequest('/api/timers', 'POST', { seconds: 300, kind: t.kind, label: t.label });
      await apiRequest(`/api/timers/${t.id}`, 'DELETE');
      toast('Snoozed for 5 minutes');
    });

  return (
    <div className="alarm" role="alertdialog" aria-label="Timer finished" data-no-swipe>
      <span className="alarm-bell fx">
        <Bell size={30} />
      </span>
      <div className="alarm-text">
        <b>{t.kind === 'parking' ? 'Parking time is up' : `${t.label}: time is up`}</b>
        <span>
          {t.kind === 'parking' ? `${t.label} has run out.` : 'The timer has finished.'}
          {ringing.length > 1 ? ` (+${ringing.length - 1} more)` : ''}
        </span>
      </div>
      <button type="button" className="btn" onClick={() => void snooze()}>
        +5 min
      </button>
      <button type="button" className="btn primary" onClick={() => void dismiss()}>
        Dismiss
      </button>
    </div>
  );
}
