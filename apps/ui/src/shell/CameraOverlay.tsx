import { useEffect, useRef, useState } from 'react';
import { CameraOff, X } from 'lucide-react';
import { useHeadUnit } from '../store';

/** Parking guide lines in a 100×60 viewBox: green / yellow / red distance bands, with a slow scanning sweep. */
function Guides() {
  return (
    <svg className="cam-guides" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
      <g fill="none" strokeWidth="0.8" strokeLinecap="round">
        <path d="M22 58 L36 30" stroke="#ef4444" />
        <path d="M78 58 L64 30" stroke="#ef4444" />
        <path d="M36 30 L40 20" stroke="#fbbf24" />
        <path d="M64 30 L60 20" stroke="#fbbf24" />
        <path d="M40 20 L43 13" stroke="#34d399" />
        <path d="M60 20 L57 13" stroke="#34d399" />
        <path d="M24 52 L76 52" stroke="#ef4444" />
        <path d="M32 36 L68 36" stroke="#fbbf24" />
        <path d="M38 24 L62 24" stroke="#34d399" />
      </g>
    </svg>
  );
}

/**
 * Fullscreen reverse-camera view. Shown whenever the server says the camera is active — from the UI button, or from anything calling
 * POST /api/camera/show (e.g. a GPIO script on the reverse light).
 */
export function CameraOverlay() {
  const active = useHeadUnit((s) => s.camera?.active ?? false);
  const mirror = useHeadUnit((s) => s.settings?.cameraMirror ?? false);
  const guides = useHeadUnit((s) => s.settings?.cameraGuides ?? true);
  const cmd = useHeadUnit((s) => s.camera_cmd);
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    setError('');
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e: Error) => setError(e.name === 'NotFoundError' ? 'No camera found' : e.name === 'NotAllowedError' ? 'Camera permission denied' : e.message));
    if (!navigator.mediaDevices) setError('Camera not available in this browser');
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop()); // release the device as soon as we hide
    };
  }, [active]);

  if (!active) return null;
  return (
    <div className="camera" role="dialog" aria-label="Rear camera" data-no-swipe>
      <video ref={video} autoPlay playsInline muted style={mirror ? { transform: 'scaleX(-1)' } : undefined} data-testid="camera-video" />
      {guides && !error && <Guides />}
      {!error && <div className="cam-sweep fx" aria-hidden="true" />}
      {error && (
        <div className="cam-error">
          <CameraOff size={40} />
          {error}
        </div>
      )}
      <span className="cam-tag">REAR</span>
      <button type="button" className="cam-close" aria-label="Close camera" onClick={() => cmd('hide')}>
        <X size={30} />
      </button>
    </div>
  );
}
