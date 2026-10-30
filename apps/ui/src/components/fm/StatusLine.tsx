import { Ban, CircleCheck, Loader2, PowerOff, TriangleAlert, Wrench, WifiOff, type LucideIcon } from 'lucide-react';
import { levelWord, type StatusKind, type StatusLine as StatusLineView } from '../../lib/fm';

/** One shape per state, so the state never rests on colour alone. */
const ICON: Record<StatusKind, LucideIcon> = {
  connecting: Loader2,
  'on-air': CircleCheck,
  starting: Loader2,
  off: PowerOff,
  setup: Wrench,
  unreachable: WifiOff,
  unsupported: Ban,
  problem: TriangleAlert,
};

/** What is going on, as an announcement: the label first, then the head unit's sentence. */
export function StatusLine({ line }: { line: StatusLineView }) {
  const Icon = ICON[line.kind];
  const turning = line.kind === 'connecting' || line.kind === 'starting';
  return (
    <div className="fm-status" role="status" aria-live="polite" aria-atomic="true" data-tone={line.tone} data-kind={line.kind}>
      <span className="fm-status-icon" aria-hidden="true">
        <Icon size={22} className={turning ? 'spin' : undefined} />
      </span>
      <span className="fm-status-text">
        <b>{line.label}</b>
        <span>{line.detail}</span>
      </span>
    </div>
  );
}

/** How loud the sound being sent is. Only the scale changes (a transform), never the size of the box. A word says it too. */
export function LevelMeter({ level }: { level: number }) {
  const word = levelWord(level);
  const value = Math.round(level * 100) / 100;
  return (
    <div className="fm-level">
      <div className="fm-meter" role="meter" aria-label="Sound level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value} aria-valuetext={word}>
        <i style={{ transform: `scaleX(${value})` }} />
      </div>
      <span className="fm-level-word">{word}</span>
    </div>
  );
}
