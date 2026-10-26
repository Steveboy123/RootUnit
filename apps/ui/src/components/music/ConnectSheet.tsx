import { useEffect } from 'react';
import { Car, Cast, Monitor, RotateCw, Smartphone, Speaker, Tv } from 'lucide-react';
import type { ConnectDevice } from '@headunit/shared';
import { apiSend, useApi } from '../../lib/api';
import { ensureSpotifyPlayback, restartSpotifyPlayback, transferSpotifyToHeadunit, useSpotifyPlaybackStatus } from '../../lib/spotifyPlayback';
import { useHeadUnit } from '../../store';
import { Badge, Row, Sheet, Spinner } from '../ui';
import { ErrorNotice } from './ErrorNotice';

const ICONS: Record<string, typeof Cast> = { automobile: Car, avr: Speaker, smartphone: Smartphone, speaker: Speaker, computer: Monitor, tv: Tv, castaudio: Cast, castvideo: Cast };

type NativeStatus = {
  enabled: boolean;
  name: string;
  state: 'disabled' | 'starting' | 'running' | 'error' | 'stopped';
  message?: string;
  bitrateKbps?: number;
  backend?: string;
  device?: string;
  discoverable?: boolean;
  normalization?: boolean;
};

/** Spotify output chooser: native 320 kbps librespot first, the official Web Playback SDK only as a fallback, then any other Connect device. */
export function ConnectSheet({ onClose }: { onClose(): void }) {
  const { data, error, loading, reload } = useApi<ConnectDevice[]>('/api/connect/devices');
  const native = useApi<NativeStatus>('/api/spotify-connect/status');
  const web = useSpotifyPlaybackStatus();
  const toast = useHeadUnit((s) => s.showToast);

  useEffect(() => {
    const t = window.setInterval(() => {
      reload();
      native.reload();
    }, 2500);
    return () => window.clearInterval(t);
  }, [reload, native.reload]);

  const nativeName = native.data?.name ?? 'RPI Headunit';
  const nativeDevice = data?.find((d) => d.name.trim().toLowerCase() === nativeName.trim().toLowerCase());
  const otherDevices = data?.filter((d) => d.id !== nativeDevice?.id && d.name.trim().toLowerCase() !== web.name.trim().toLowerCase());
  const bitrate = native.data?.bitrateKbps ?? 320;

  const restartNative = async () => {
    const r = await apiSend('/api/spotify-connect/restart', {});
    if (r.error) return toast(r.error.message);
    toast('Restarting native Spotify Connect');
    window.setTimeout(() => {
      native.reload();
      reload();
    }, 1000);
  };
  const playNative = async () => {
    if (!nativeDevice) {
      if (native.data?.state === 'error' || native.data?.state === 'stopped') await restartNative();
      else toast('Native receiver is running but Spotify has not discovered it yet. Keep the phone and Pi on the same network, then wait a moment.');
      return;
    }
    const r = await apiSend('/api/connect/transfer', { id: nativeDevice.id });
    if (r.error) return toast(r.error.message);
    toast(`Spotify → RPI Headunit · Native Connect · ${bitrate} kbps`);
    onClose();
  };
  const playWebFallback = async () => {
    if (web.state === 'needs-login') {
      toast('Open Settings → Music services → Spotify, sign out, then sign in once again');
      return;
    }
    try {
      if (web.state === 'error') await restartSpotifyPlayback();
      else await ensureSpotifyPlayback();
      await transferSpotifyToHeadunit();
      toast('Spotify → RPI Headunit · Browser fallback');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start Spotify browser fallback');
    }
  };
  const pick = async (d: ConnectDevice) => {
    const r = await apiSend('/api/connect/transfer', { id: d.id });
    if (r.error) return toast(r.error.message);
    toast(`Playing on ${d.name}`);
    onClose();
  };

  const nativeState = native.data?.state;
  const nativeReady = Boolean(nativeDevice);
  const nativePill = nativeDevice?.active ? 'Playing here' : nativeReady ? `${bitrate} kbps` : nativeState === 'error' ? 'Receiver error' : nativeState === 'running' ? 'Discovering' : nativeState === 'starting' ? 'Starting' : 'Unavailable';
  const webPill = web.state === 'ready' ? 'Ready' : web.state === 'needs-login' ? 'Sign in again' : web.state === 'error' ? 'Retry' : web.state === 'connecting' ? 'Starting' : 'Start fallback';

  return (
    <Sheet title="Play on…" onClose={onClose}>
      {error && <ErrorNotice error={error} onRetry={reload} />}
      {native.error && <ErrorNotice error={native.error} onRetry={native.reload} />}
      {loading && !data && (
        <div className="row dim">
          <Spinner size={20} /> Looking for Spotify devices…
        </div>
      )}
      <div className="list">
        <Row
          icon={Car}
          active={nativeDevice?.active}
          label={nativeName}
          hint={nativeDevice ? `Native Connect · ${bitrate} kbps${native.data?.normalization ? ' · normalization on' : ' · full dynamics'}` : (native.data?.message ?? 'Native Spotify Connect receiver')}
          right={<Badge tone={nativeDevice?.active || nativeReady ? 'info' : undefined}>{nativePill}</Badge>}
          onClick={() => void playNative()}
        />
        {(nativeState === 'error' || (!nativeReady && nativeState === 'running')) && (
          <Row icon={RotateCw} label="Restart native receiver" hint="Use this if RPI Headunit does not appear in Spotify after a few seconds." onClick={() => void restartNative()} />
        )}
        <Row
          icon={Monitor}
          label="RPI Headunit · Browser fallback"
          hint={web.state === 'idle' ? 'Official Spotify player — used only if native Connect is unavailable' : web.message}
          right={<Badge tone={web.state === 'ready' ? 'info' : undefined}>{webPill}</Badge>}
          onClick={() => void playWebFallback()}
        />
        {otherDevices?.map((d) => (
          <Row key={d.id} icon={ICONS[d.type.toLowerCase()] ?? Cast} active={d.active} label={d.name} hint={d.type} right={d.active ? <Badge tone="info">Playing here</Badge> : undefined} onClick={() => void pick(d)} />
        ))}
      </div>
    </Sheet>
  );
}
