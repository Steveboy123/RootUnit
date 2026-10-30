import { useSyncExternalStore } from 'react';
import { BedDouble, Moon, Square, Volume2, Waves } from 'lucide-react';
import { Banner, Page, Panel, Slider } from '../components/ui';
import { useNow } from '../lib/hooks';
import { countdownText } from '../lib/stopwatch';
import { SLEEP_CHOICES, SOUNDS, sounds, type SoundId } from '../lib/sounds';
import { useHeadUnit } from '../store';

const useSounds = () => useSyncExternalStore(sounds.subscribe, sounds.getState, sounds.getState);

/** Each tile's little moving picture of its sound: a few marks the CSS animates (transform and opacity only). */
function Viz({ id }: { id: SoundId }) {
  const n = id === 'rain' || id === 'stream' ? 9 : id === 'fire' ? 6 : 5;
  return (
    <span className="snd-viz" data-sound={id} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className="fx" style={{ ['--i' as string]: i }} />
      ))}
    </span>
  );
}

/** Rain, waves, wind and noise to rest or focus by, mixed together, with a sleep timer that fades them out. */
export function SoundsApp() {
  const st = useSounds();
  const now = useNow(st.sleepAt ? 1000 : 60_000).getTime();
  const musicPlaying = useHeadUnit((s) => Boolean(s.media?.playing || s.radio?.playing));
  const active = Object.keys(st.playing).length;
  const left = st.sleepAt === null ? null : Math.max(0, (st.sleepAt - now) / 1000);

  return (
    <Page subtitle="Made live on the head unit: nothing to download. Mix as many as you like.">
      {st.unsupported && <Banner tone="warn">This browser cannot make sound here.</Banner>}
      {musicPlaying && active > 0 && <Banner icon={Volume2}>Music is playing too. Pause it for a quieter mix.</Banner>}

      <div className="snd-grid stagger">
        {SOUNDS.map((s, i) => {
          const level = st.playing[s.id];
          const on = level !== undefined;
          return (
            <div key={s.id} className="snd-tile" data-on={on} style={{ ['--i' as string]: i, ['--h' as string]: s.hue }}>
              <button type="button" className="snd-main" aria-pressed={on} onClick={() => sounds.toggle(s.id)}>
                <Viz id={s.id} />
                <b>{s.label}</b>
                <small>{s.hint}</small>
              </button>
              {on && (
                <div className="snd-level" data-no-swipe>
                  <Slider label={`${s.label} level`} min={0} max={100} value={Math.round(level * 100)} onChange={(v) => sounds.play(s.id, v / 100)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Panel title="Mix" icon={Waves} aside={active > 0 ? <span className="dim small">{active} playing</span> : undefined}>
        <div className="row" data-no-swipe>
          <Volume2 size={18} className="dim" />
          <Slider label="Sleep sounds volume" min={0} max={100} value={Math.round(st.master * 100)} onChange={(v) => sounds.setMaster(v / 100)} />
          <button type="button" className="btn small" disabled={active === 0} onClick={() => sounds.stopAll()}>
            <Square size={15} /> Stop all
          </button>
        </div>
        <div className="row wrap">
          <span className="row dim" style={{ gap: 6, fontSize: '0.88rem' }}>
            <Moon size={16} /> Sleep timer
          </span>
          {SLEEP_CHOICES.map((m) => (
            <button key={m} type="button" className="chip" disabled={active === 0} data-active={false} onClick={() => sounds.sleep(m)}>
              {m} min
            </button>
          ))}
          {left !== null && (
            <button type="button" className="chip" data-active onClick={() => sounds.sleep(null)}>
              <BedDouble /> {countdownText(left)} · cancel
            </button>
          )}
        </div>
        <small className="dim">The timer fades everything out over the last 45 seconds, then stops.</small>
      </Panel>
    </Page>
  );
}
