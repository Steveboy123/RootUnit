import { useMemo } from 'react';
import { makeQr, QUIET_ZONE } from '../lib/qr';

/**
 * A QR code as inline SVG. Always dark modules on a white square with a quiet zone, whatever the theme — phone
 * cameras need that contrast. The size comes from CSS (.qr), so it can grow where there is room.
 */
export function QrCode({ value, label = 'QR code' }: { value: string; label?: string }) {
  const qr = useMemo(() => makeQr(value), [value]);
  if (!qr) {
    return <div className="notice warn">This address is too long to show as a QR code. Copy it below and open it on your phone instead.</div>;
  }
  const side = qr.size + QUIET_ZONE * 2;
  return (
    <svg className="qr" viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={side} height={side} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}
