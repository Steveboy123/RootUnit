import type { FmMode, FmStatus } from '@headunit/shared';

/** What the person has asked for. `on` is already gated by the notice: it is false until the notice has been accepted. */
export interface FmWanted {
  on: boolean;
  frequency: number;
  /** When the frequency was last changed by the person (ms, the service's clock). A retune waits for it to stand still. */
  tunedAt: number;
}

/** What the engine saw, in the words of `FmState`. The service adds what the person asked for and publishes the whole. */
export interface FmObserved {
  mode: FmMode;
  status: FmStatus;
  detail: string;
  board: string | null;
  limits: { min: number; max: number };
  level: number;
}

/**
 * The thing that makes the wanted state true: the real one talks to the FM helper and captures the sound, the demo one pretends.
 * It reads `wanted()` whenever it looks, reports through `report`, and never throws into the service.
 */
export interface FmBackend {
  start(wanted: () => FmWanted, report: (observed: FmObserved) => void): void;
  /** The wanted state changed: look at it soon. */
  poke(): void;
  /** Everything stopped, timers and children gone. Resolves when the carrier is off (or after a second at most). */
  stop(): Promise<void>;
}
