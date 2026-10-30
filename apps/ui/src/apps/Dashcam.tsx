import { useEffect, useRef, useState } from 'react';
import { Bookmark, Camera, Circle, Film, HardDrive, ShieldAlert, Square } from 'lucide-react';
import { Badge, Banner, Cols, Empty, Page, Panel, Row, Segment, Stepper, Toggle, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { clipStart, eventTitle } from '../lib/dashcam';
import { whenText } from '../lib/dates';
import { useNow } from '../lib/hooks';
import { useSvc } from '../store';

const act = (action: string, body: Record<string, unknown> = {}) => apiRequest('/api/dashcam/action', 'POST', { action, ...body });

/** Loop recording from a USB camera, in two-minute pieces, with a button to keep the last moment. */
export function DashcamApp() {
  const cam = useSvc('dashcam');
  const now = useNow(30_000).getTime();
  const { busy, run } = useAction();

  // The size limit is a stepper that repeats while held: wait until it settles before telling the recorder.
  const [gb, setGb] = useState<number | null>(null);
  const sent = useRef<number | null>(null);
  const reported = cam?.maxGb;
  useEffect(() => {
    if (reported !== undefined) {
      setGb(reported);
      sent.current = reported;
    }
  }, [reported]);
  useEffect(() => {
    if (gb === null || gb === sent.current) return;
    const id = window.setTimeout(() => {
      sent.current = gb;
      void run(() => act('config', { maxGb: gb }), 'Storage limit saved');
    }, 700);
    return () => window.clearTimeout(id);
  }, [gb, run]);

  if (!cam) return null;

  const canRecord = cam.cameraPresent || cam.recording;

  return (
    <Page subtitle="Records to the Pi’s own storage. The oldest footage is replaced when the limit is reached.">
      {!canRecord && (
        <Banner tone="warn" icon={Camera}>
          {cam.cameras.length > 0
            ? `The selected camera (${cam.camera}) is not there, but ${cam.cameras.join(', ')} ${cam.cameras.length === 1 ? 'is' : 'are'}. Choose it under Settings.`
            : cam.detail}
        </Banner>
      )}

      <Cols min={360}>
        <Panel title="Recorder" icon={Film} aside={<Badge tone={cam.recording ? 'danger' : undefined}>{cam.recording ? 'Recording' : 'Stopped'}</Badge>}>
          <div className="dc-finder" data-rec={cam.recording} aria-hidden>
            <i className="dc-corner" />
            <i className="dc-corner" />
            <i className="dc-corner" />
            <i className="dc-corner" />
            <span className="dc-rec-tag">
              <i className="fx" /> {cam.recording ? 'REC' : 'STANDBY'}
            </span>
            <Camera className="dc-cam" />
            <span className="dc-scan fx" />
          </div>
          <div className="row wrap">
            {cam.recording ? (
              <button type="button" className="btn danger" disabled={busy} onClick={() => void run(() => act('stop'), 'Recording stopped')}>
                <Square size={18} /> Stop recording
              </button>
            ) : (
              <button type="button" className="btn primary" disabled={busy || !canRecord} onClick={() => void run(() => act('start'), 'Recording started')}>
                <Circle size={18} /> Start recording
              </button>
            )}
            <button type="button" className="btn" disabled={busy || (!cam.recording && cam.clips.length === 0)} onClick={() => void run(() => act('protect'), 'Saved. See Saved moments')}>
              <Bookmark size={18} /> Keep this moment
            </button>
          </div>
          <p className="dim small">{cam.recording ? 'Keep this moment copies the last finished piece to a protected folder that is never replaced.' : cam.detail}</p>
        </Panel>

        <Panel title="Settings" icon={HardDrive}>
          {(cam.cameras.length > 1 || (cam.cameras.length === 1 && !cam.cameraPresent)) && (
            <Segment
              label="Camera"
              value={cam.camera}
              options={cam.cameras.map((c) => ({ value: c, label: c.replace('/dev/', '') }))}
              onChange={(c) => void run(() => act('config', { camera: c }), 'Camera changed')}
            />
          )}
          {cam.recording && cam.cameras.length > 1 && <div className="dim small">Stop recording to change the camera.</div>}
          <Row label="Storage limit" hint="Space the loop may use" right={<Stepper label="Storage limit" value={gb ?? cam.maxGb} min={0.5} max={32} step={0.5} format={(v) => `${v} GB`} onChange={setGb} />} />
          <Row
            icon={ShieldAlert}
            label="Record when the sensor trips"
            hint="Needs the ESP32 sensor"
            right={<Toggle label="Record on sensor events" on={cam.parkingEvents} disabled={busy} onChange={(on) => void run(() => act('config', { parkingEvents: on }))} />}
          />
        </Panel>

        <Panel title="Saved moments" icon={Bookmark}>
          {cam.events.length === 0 ? (
            <Empty icon={Bookmark} title="Nothing saved">
              Moments you keep, and anything the sensor catches, are listed here.
            </Empty>
          ) : (
            <div className="list">
              {cam.events.slice(0, 10).map((e) => (
                <Row key={`${e.at}-${e.kind}`} icon={e.kind === 'manual' ? Bookmark : ShieldAlert} label={eventTitle(e.kind)} hint={whenText(new Date(e.at), now)} right={<Badge tone={e.clip ? 'ok' : 'warn'}>{e.clip ? 'Footage kept' : 'No footage yet'}</Badge>} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent footage" icon={Film} aside={cam.clips.length > 0 ? <span className="dim small">{cam.clips.length} pieces</span> : undefined}>
          {cam.clips.length === 0 ? (
            <Empty icon={Film} title="No footage yet">
              Recording is saved in two-minute pieces.
            </Empty>
          ) : (
            <div className="list">
              {cam.clips.slice(0, 8).map((c) => {
                const t = clipStart(c);
                return <Row key={c} icon={Film} label={t ? whenText(t, now) : c} hint="2 minutes" />;
              })}
            </div>
          )}
          {cam.directory && <div className="dim small" style={{ wordBreak: 'break-all' }}>Saved in {cam.directory}</div>}
        </Panel>
      </Cols>
    </Page>
  );
}
