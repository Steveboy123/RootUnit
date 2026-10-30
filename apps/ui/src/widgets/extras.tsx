import { useEffect, useRef, useState } from 'react';
import { Activity, Bookmark, Dices } from 'lucide-react';
import { QUIET, microphoneIsOn, readMicrophoneMeter, type MeterReading } from '../audio/reactive';
import { isoWeek, monthGrid } from '../lib/calendar';
import { useTypingLocked } from '../lib/driving';
import { useNow } from '../lib/hooks';
import { surpriseLook } from '../lib/surprise';
import { useHeadUnit } from '../store';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** This month at a glance: today lit, the week number, the days either side faded. */
export function CalendarWidget() {
  const now = useNow(60_000);
  const weeks = monthGrid(now.getFullYear(), now.getMonth(), now);
  return (
    <div className="w-cal">
      <div className="w-cal-head">
        <b>{now.toLocaleDateString(undefined, { month: 'long' })}</b>
        <span className="dim">
          {now.getFullYear()} · week {isoWeek(now)}
        </span>
      </div>
      <div className="w-cal-grid" role="grid" aria-label={now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
        {WEEKDAYS.map((d, i) => (
          <span key={`h${i}`} className="w-cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {weeks.flat().map((d, i) => (
          <span key={i} className="w-cal-day num" data-out={!d.inMonth || undefined} data-today={d.today || undefined} aria-current={d.today ? 'date' : undefined}>
            {d.day}
          </span>
        ))}
      </div>
      <div className="w-cal-big num" aria-hidden="true">
        {now.getDate()}
        <small>{now.toLocaleDateString(undefined, { weekday: 'short' })}</small>
      </div>
    </div>
  );
}

/** Your saved looks, one tap each, and a surprise. Changing the look waits until you are parked (or a passenger says so). */
export function LookSwitcherWidget() {
  const looks = useHeadUnit((s) => s.settings?.myLooks ?? []);
  const theme = useHeadUnit((s) => s.settings?.theme);
  const patch = useHeadUnit((s) => s.patchSettings);
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  return (
    <div className="w-looks" data-no-swipe>
      <div className="w-looks-head">
        <Bookmark size={16} />
        <b>My looks</b>
        {locked && <span className="dim small">Park to change</span>}
      </div>
      <div className="w-looks-chips">
        {looks.length === 0 && <span className="dim small">Save looks in Settings → Looks &amp; layouts.</span>}
        {looks.map((l) => (
          <button
            key={l.id}
            type="button"
            className="chip"
            data-active={l.look.theme === theme || undefined}
            disabled={locked}
            onClick={() => {
              patch(l.look);
              toast(`${l.name} look`);
            }}
          >
            <i className="w-looks-dot" style={{ background: l.look.accent }} />
            {l.name}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          disabled={locked}
          onClick={() => {
            patch(surpriseLook());
            toast('A surprise look');
          }}
        >
          <Dices size={15} /> Surprise me
        </button>
      </div>
    </div>
  );
}

const HISTORY = 32;

/**
 * The music as it really sounds: loudness over the last few seconds and a dot that swells with the bass. It reads the same meter as the
 * music-reactive light (the Pi's audio monitor, or the microphone once it is started), and says so plainly when there is none: it never
 * invents a level.
 */
export function SoundMeterWidget() {
  const source = useHeadUnit((s) => s.settings?.beatSource ?? 'system');
  const [reading, setReading] = useState<MeterReading>(QUIET);
  const history = useRef<number[]>(Array(HISTORY).fill(0));
  useEffect(() => {
    let live = true;
    const tick = async () => {
      if (document.hidden) return;
      let r: MeterReading = QUIET;
      if (source === 'microphone') r = microphoneIsOn() ? readMicrophoneMeter() : { ...QUIET, error: 'Start the microphone in Settings → Music reactive.' };
      else {
        try {
          r = { ...QUIET, ...((await (await fetch('/api/audio/meter', { cache: 'no-store' })).json()) as Partial<MeterReading>) };
        } catch {
          r = { ...QUIET, error: 'The audio monitor cannot be reached.' };
        }
      }
      if (!live) return;
      history.current = [...history.current.slice(1), r.available ? r.level : 0];
      setReading(r);
    };
    const timer = window.setInterval(() => void tick(), 140);
    void tick();
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [source]);

  if (!reading.available)
    return (
      <div className="w-empty">
        <Activity className="w-empty-icon" />
        <b>Sound meter</b>
        <span>{reading.error ?? 'Shows the real music level once the audio monitor is set up (Settings → Music reactive).'}</span>
      </div>
    );
  return (
    <div className="w-meter" role="img" aria-label={`Music level ${Math.round(reading.level * 100)} percent`}>
      <div className="w-meter-bars" aria-hidden="true">
        {history.current.map((v, i) => (
          <i key={i} style={{ transform: `scaleY(${Math.max(0.03, v)})` }} />
        ))}
      </div>
      <div className="w-meter-side" aria-hidden="true">
        <i className="w-meter-bass" style={{ transform: `scale(${0.6 + reading.bass * 0.8})` }} />
        <span className="dim small">bass</span>
      </div>
    </div>
  );
}
