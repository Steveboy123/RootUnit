import { useState } from 'react';
import { Radio, RadioTower } from 'lucide-react';
import { Banner, Cols, Page, Panel, useAction } from '../components/ui';
import { rememberFmState, useFmTuner } from '../components/fm/hooks';
import { FmNotice } from '../components/fm/Notice';
import { PowerSwitch } from '../components/fm/PowerSwitch';
import { Presets } from '../components/fm/Presets';
import { Rules } from '../components/fm/Rules';
import { SetupHelp } from '../components/fm/SetupHelp';
import { LevelMeter, StatusLine } from '../components/fm/StatusLine';
import { Tuner } from '../components/fm/Tuner';
import { acceptNoticeAndSwitchOn, fmCalls, fmView, frequencyText, helpFor, nextFrequency, presetsView, pressSwitch, statusLine, switchView, transmitterLine, tunerView } from '../lib/fm';
import { useSvc } from '../store';

/**
 * Play the head unit's sound on the car radio, through a weak FM transmitter. The transmitter itself runs on a Pi that can (a second
 * Pi, or this one when it is a Pi 4 or older); this page tunes it, switches it on and says plainly how it is doing. Nothing sends
 * until the notice has been read and accepted. Tuning is like the volume: it is not locked while driving.
 */
export function FmApp() {
  const view = fmView(useSvc('fm'));
  const { busy, run } = useAction();
  const [notice, setNotice] = useState(false);
  const { shown, step, jump } = useFmTuner(view.frequency);

  const tuner = tunerView(view, shown);
  const presets = presetsView(view, shown);
  const power = switchView(view);
  const line = statusLine(view);
  const help = helpFor(view);
  const where = transmitterLine(view);

  const press = () => void run(async () => rememberFmState(await pressSwitch(view, fmCalls, () => setNotice(true))));
  const accept = () =>
    void run(() =>
      acceptNoticeAndSwitchOn(fmCalls, (state) => {
        rememberFmState(state);
        setNotice(false);
      }).then(rememberFmState),
    );
  const togglePreset = () => {
    if (shown !== null) void run(async () => rememberFmState(await fmCalls.preset(shown, !presets.saved)));
  };

  return (
    <Page
      subtitle="Play the head unit’s sound on a car radio."
      actions={
        view.demo && (
          <span className="badge" data-tone="warn" title="The server is running with simulated hardware">
            DEMO
          </span>
        )
      }
    >
      {view.demo && (
        <Banner tone="info" icon={Radio}>
          This is a demonstration. Nothing is sent over the air.
        </Banner>
      )}

      <Cols min={320}>
        <Panel title="Station" icon={Radio}>
          <FmDial min={view.limits.min} max={view.limits.max} at={shown} on={view.status === 'transmitting'} />
          <Tuner view={tuner} pending={shown !== view.frequency} onStep={(steps) => view.ready && step(nextFrequency(shown, steps, view.limits))} />
          <Presets view={presets} current={shown === null ? null : frequencyText(shown)} busy={busy} onTune={jump} onToggle={togglePreset} />
        </Panel>

        <Panel title="Transmitter" icon={RadioTower}>
          <PowerSwitch view={power} busy={busy} onPress={press} />
          <StatusLine line={line} />
          {view.status === 'transmitting' && <LevelMeter level={view.level} />}
          {where && <p className="fm-note">{where}</p>}
        </Panel>
      </Cols>

      {help && <SetupHelp help={help} />}
      <Rules />

      {notice && <FmNotice busy={busy} onAccept={accept} onCancel={() => setNotice(false)} />}
    </Page>
  );
}

/** An old-radio dial across the band, its needle at the frequency on the readout. Decoration: the readout above says the same in words. */
function FmDial({ min, max, at, on }: { min: number; max: number; at: number | null; on: boolean }) {
  const span = Math.max(0.1, max - min);
  const pos = at === null ? 0.5 : Math.min(1, Math.max(0, (at - min) / span));
  const marks: number[] = [];
  for (let f = Math.ceil(min); f <= Math.floor(max); f += 2) marks.push(f);
  return (
    <div className="fm-dial" data-on={on} aria-hidden="true">
      <div className="fm-dial-scale">
        {Array.from({ length: 41 }, (_, i) => (
          <i key={i} data-major={i % 5 === 0} />
        ))}
      </div>
      <div className="fm-dial-marks">
        {marks.map((f) => (
          <span key={f} style={{ left: `${((f - min) / span) * 100}%` }}>
            {f}
          </span>
        ))}
      </div>
      <i className="fm-needle" style={{ ['--pos' as string]: pos }} />
    </div>
  );
}
