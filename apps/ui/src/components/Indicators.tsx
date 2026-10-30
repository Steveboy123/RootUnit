import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning } from 'lucide-react';

interface BatteryProps {
  percent?: number;
  charging?: boolean;
  size?: number;
}

/** Battery glyph that matches the level. Unknown level renders a dimmed empty battery, never a guess. */
export function BatteryIcon({ percent, charging, size = 20 }: BatteryProps) {
  if (percent === undefined) return <Battery size={size} className="batt unknown" />;
  if (charging) return <BatteryCharging size={size} className="batt ok" />;
  const Icon = percent <= 10 ? BatteryWarning : percent <= 25 ? BatteryLow : percent <= 60 ? BatteryMedium : BatteryFull;
  return <Icon size={size} className={`batt ${percent <= 15 ? 'danger' : percent <= 30 ? 'warn' : 'ok'}`} />;
}

/** 0–4 bars; `undefined` shows all bars dim. */
export function SignalBars({ level }: { level?: number }) {
  return (
    <span className="signal" role="img" aria-label={level === undefined ? 'Signal unknown' : `Signal ${level} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} style={{ height: `${25 + i * 18}%` }} data-on={level !== undefined && i <= level} />
      ))}
    </span>
  );
}

export const batteryText = (percent?: number) => (percent === undefined ? '—' : `${Math.round(percent)}%`);
