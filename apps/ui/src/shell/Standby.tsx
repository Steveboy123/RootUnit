import { Music2 } from 'lucide-react';
import type { StandbyStyle } from '@headunit/shared';
import { WORD_GRID, binaryColumns, wordClockCells, wordClockSentence } from '../lib/clockFaces';
import { formatClock } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useNowPlaying } from '../lib/nowPlaying';
import { celsiusToDisplay, tempUnit } from '../lib/units';
import { describeWeather, weatherIcon } from '../lib/weather';
import { useHeadUnit, useSvc } from '../store';

/** Where the clock sits for each minute: a slow wander of a few pixels, so one bright shape never stays on the panel. */
const DRIFT: Array<[number, number]> = [
  [0, 0],
  [14, -8],
  [-12, 10],
  [8, 14],
  [-16, -6],
  [10, -12],
];

/** A flip-card digit: a new value drops in on its hinge. */
function FlipDigits({ value }: { value: string }) {
  return (
    <span className="flip-group">
      {Array.from(value).map((d, i) => (
        <span className="flip-card" key={`${i}-${d}`}>
          <span className="flip-face">{d}</span>
        </span>
      ))}
    </span>
  );
}

function AnalogClock({ now }: { now: Date }) {
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  return (
    <svg className="analog" viewBox="-100 -100 200 200" aria-hidden="true">
      <circle r="96" className="analog-face" />
      {Array.from({ length: 60 }, (_, i) => (
        <line key={i} className={i % 5 === 0 ? 'tick major' : 'tick'} x1="0" y1={i % 5 === 0 ? -80 : -86} x2="0" y2="-91" transform={`rotate(${i * 6})`} />
      ))}
      <line className="hand hour" x1="0" y1="10" x2="0" y2="-48" transform={`rotate(${h * 30})`} />
      <line className="hand minute" x1="0" y1="12" x2="0" y2="-72" transform={`rotate(${m * 6})`} />
      {/* The second hand turns by itself (one CSS turn a minute), started at the right second. */}
      <g className="hand-sweep fx" style={{ animationDelay: `-${s}s` }}>
        <line className="hand second" x1="0" y1="16" x2="0" y2="-82" />
      </g>
      <circle r="5" className="analog-pin" />
    </svg>
  );
}

/** Valve-tube digits: each digit glows inside its own glass tube. */
function NixieDigits({ value }: { value: string }) {
  return (
    <span className="nixie-group">
      {Array.from(value).map((d, i) => (
        <span className="nixie-tube" key={i}>
          <span className="nixie-digit">{d}</span>
        </span>
      ))}
    </span>
  );
}

/** The word clock: a fixed grid of letters, the ones that spell the time lit. */
function WordClock({ now }: { now: Date }) {
  const lit = wordClockCells(now.getHours(), now.getMinutes());
  return (
    <div className="word-clock" role="img" aria-label={wordClockSentence(now.getHours(), now.getMinutes())}>
      {WORD_GRID.map((row, r) => (
        <div key={r} className="word-row" aria-hidden="true">
          {Array.from(row).map((ch, c) => (
            <span key={c} data-on={lit.has(`${r}:${c}`)}>
              {ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The binary clock: each digit of HH MM SS as a column of lit dots (8, 4, 2, 1 from the top). */
function BinaryClock({ now }: { now: Date }) {
  const cols = binaryColumns(now.getHours(), now.getMinutes(), now.getSeconds());
  return (
    <div className="binary-clock" aria-hidden="true">
      {cols.map((bits, i) => (
        <div key={i} className="binary-col" data-gap={i === 2 || i === 4 || undefined}>
          {bits.map((on, b) => (
            <i key={b} data-on={on} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Parked and idle: a quiet screen in one of nine styles, with the weather and what is playing. Touch anywhere to come back. */
export function Standby() {
  const on = useHeadUnit((s) => s.standby);
  return on ? <StandbyBody /> : null;
}

function StandbyBody() {
  const setStandby = useHeadUnit((s) => s.setStandby);
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const style: StandbyStyle = useHeadUnit((s) => s.settings?.standbyStyle ?? 'clock');
  const mascotVariant = useHeadUnit((s) => s.settings?.mascotVariant ?? 'transparent');
  const weather = useSvc('weather');
  const np = useNowPlaying();
  const now = useNow(1000);

  const { time, suffix } = formatClock(now, h24);
  const [dx, dy] = DRIFT[now.getMinutes() % DRIFT.length]!;
  const w = weather?.current;
  const Icon = w ? weatherIcon(w.code, w.isDay) : null;
  const [hh = '', mm = ''] = time.split(':');

  const info = (
    <>
      <div className="standby-date">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      {w && Icon && style !== 'minimal' && (
        <div className="standby-weather">
          <Icon size={26} />
          <b>
            {Math.round(celsiusToDisplay(w.tempC, units))}
            {tempUnit(units)}
          </b>
          <span>{describeWeather(w.code).label}</span>
        </div>
      )}
      {np?.playing && style !== 'minimal' && (
        <div className="standby-np">
          <Music2 size={17} />
          <span className="truncate">
            {np.title} · {np.artist}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="standby" data-style={style} role="button" aria-label="Wake the screen" onPointerDown={() => setStandby(false)} data-no-swipe>
      {style === 'orbit' && (
        <div className="standby-orbits fx" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      {style === 'mascot' && <img className="standby-mascot fx" src={`/mascot/${mascotVariant}.webp`} alt="" />}
      <div className="standby-body" style={{ transform: `translate(${dx}px, ${dy}px)` }}>
        {style === 'analog' ? (
          <AnalogClock now={now} />
        ) : style === 'nixie' ? (
          <div className="standby-time nixie">
            <NixieDigits value={hh} />
            <span className="nixie-colon" aria-hidden="true">
              <i />
              <i />
            </span>
            <NixieDigits value={mm} />
            {suffix && <small>{suffix}</small>}
          </div>
        ) : style === 'words' ? (
          <WordClock now={now} />
        ) : style === 'binary' ? (
          <>
            <BinaryClock now={now} />
            <div className="standby-time binary-time">
              {time}
              {suffix && <small>{suffix}</small>}
            </div>
          </>
        ) : style === 'flip' ? (
          <div className="standby-time flip">
            <FlipDigits value={hh} />
            <span className="flip-colon">:</span>
            <FlipDigits value={mm} />
            {suffix && <small>{suffix}</small>}
          </div>
        ) : (
          <div className="standby-time">
            {time}
            {suffix && <small>{suffix}</small>}
          </div>
        )}
        {info}
        <div className="standby-hint">Touch to wake</div>
      </div>
    </div>
  );
}
