import { Bluetooth, Car, Music2, Pause, Play, SkipBack, SkipForward, Smartphone, Usb, Wifi } from 'lucide-react';
import type { DeviceTransport, PhoneDevice } from '@headunit/shared';
import { AlbumArt } from '../components/AlbumArt';
import { BatteryIcon, SignalBars, batteryText } from '../components/Indicators';
import { Badge, Banner, Empty, Page } from '../components/ui';
import { useHeadUnit } from '../store';

const TRANSPORT = {
  bluetooth: { label: 'Bluetooth', icon: Bluetooth },
  wifi: { label: 'Wi-Fi', icon: Wifi },
  usb: { label: 'USB', icon: Usb },
} satisfies Record<DeviceTransport, { label: string; icon: typeof Wifi }>;

const PROJECTION = { 'android-auto': 'Android Auto', carplay: 'CarPlay' } as const;

function BluetoothNowPlaying() {
  const media = useHeadUnit((s) => s.devices?.media);
  const cmd = useHeadUnit((s) => s.device_cmd);
  if (!media || (!media.title && !media.artist)) return null;
  const playing = media.status === 'playing';
  return (
    <section className="card bt-now">
      <div className="bt-now-art">
        <AlbumArt artUrl={media.artUrl} playing={playing} size="sm" fallback={<Music2 />} />
      </div>
      <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
        <span className="eyebrow row" style={{ gap: 6 }}>
          <Bluetooth size={14} /> Bluetooth audio
        </span>
        <b className="truncate" style={{ fontSize: '1.15rem' }}>{media.title ?? 'Phone audio'}</b>
        <span className="dim truncate">{[media.artist, media.album].filter(Boolean).join(' · ') || media.deviceName || 'Connected phone'}</span>
        <div className="row wrap" style={{ gap: 6 }}>
          <Badge tone="info">A2DP</Badge>
          {media.codec && <Badge>{media.codec.replace('_', '-').toUpperCase()}</Badge>}
          <Badge tone={media.routed ? 'ok' : 'warn'}>{media.routed ? 'Head-unit output' : 'Waiting for audio route'}</Badge>
        </div>
      </div>
      <div className="transport" data-size="md">
        <button type="button" className="tp-btn" aria-label="Previous Bluetooth track" onClick={() => cmd({ cmd: 'media', action: 'prev' })}>
          <SkipBack fill="currentColor" />
        </button>
        <button type="button" className="tp-btn tp-main" data-playing={playing} aria-label={playing ? 'Pause Bluetooth' : 'Play Bluetooth'} onClick={() => cmd({ cmd: 'media', action: 'toggle' })}>
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button type="button" className="tp-btn" aria-label="Next Bluetooth track" onClick={() => cmd({ cmd: 'media', action: 'next' })}>
          <SkipForward fill="currentColor" />
        </button>
      </div>
    </section>
  );
}

function DeviceCard({ d, slot }: { d: PhoneDevice; slot: number }) {
  const cmd = useHeadUnit((s) => s.device_cmd);
  const pct = d.battery?.percent;
  return (
    <article className="card device" data-active={d.active} data-offline={!d.connected} style={{ ['--i' as string]: slot }}>
      <div className="row">
        <span className="device-slot num">{slot}</span>
        <span className="device-phone">
          <Smartphone />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="truncate" style={{ display: 'block', fontSize: '1.05rem' }}>{d.name}</b>
          <span className="dim" style={{ fontSize: '0.82rem' }}>{d.platform === 'ios' ? 'iPhone' : d.platform === 'android' ? 'Android' : 'Phone'}</span>
        </div>
        {d.active && <Badge tone="info">In use</Badge>}
        {!d.connected && <Badge>Not connected</Badge>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {d.projection && (
          <Badge tone="info">
            <Car size={13} /> {PROJECTION[d.projection]}
          </Badge>
        )}
        {d.transports.map((t) => {
          const { label, icon: Icon } = TRANSPORT[t];
          return (
            <Badge key={t}>
              <Icon size={13} /> {label}
            </Badge>
          );
        })}
      </div>
      <div className="row">
        <BatteryIcon percent={pct} charging={d.battery?.charging} size={24} />
        <div className="device-batt" data-low={(pct ?? 100) <= 15} data-unknown={pct === undefined}>
          <i style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
        </div>
        <b className="num">{batteryText(pct)}</b>
      </div>
      {d.connected && (
        <div className="row dim" style={{ gap: 8, fontSize: '0.85rem' }}>
          <SignalBars level={d.signal} />
          <span>{d.carrier ?? (d.signal === undefined ? 'No signal info' : 'Mobile')}</span>
        </div>
      )}
      <div className="row wrap">
        {d.connected ? (
          <>
            {!d.active && (
              <button type="button" className="btn small primary" onClick={() => cmd({ cmd: 'activate', id: d.id })}>
                Use this phone
              </button>
            )}
            <button type="button" className="btn small" onClick={() => cmd({ cmd: 'disconnect', id: d.id })}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" className="btn small" onClick={() => cmd({ cmd: 'connect', id: d.id })}>
            Connect
          </button>
        )}
      </div>
    </article>
  );
}

export function DevicesPage() {
  const devices = useHeadUnit((s) => s.devices);
  if (!devices) return null;
  return (
    <Page>
      {devices.error && <Banner tone="warn">{devices.error}</Banner>}
      <BluetoothNowPlaying />
      {devices.devices.length === 0 && !devices.error && (
        <Empty icon={Smartphone} title="No paired phones">
          Pair your phone with the Pi in the system Bluetooth settings and it will appear here with its battery level.
        </Empty>
      )}
      <div className="tile-grid stagger" style={{ ['--tile-min' as string]: '300px' }}>
        {devices.devices.map((d, i) => (
          <DeviceCard key={d.id} d={d} slot={i + 1} />
        ))}
      </div>
      {devices.devices.some((d) => d.connected && d.battery === undefined) && (
        <div className="dim" style={{ fontSize: '0.82rem' }}>
          “—” means the phone doesn’t report a battery level over Bluetooth. Signal and carrier aren’t available from Bluetooth alone.
        </div>
      )}
    </Page>
  );
}
