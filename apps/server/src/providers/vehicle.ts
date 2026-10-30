import type { DiagnosticsState, VehicleState } from '@headunit/shared';
import type { Observable } from '../observable';

/** Real vehicle data from an OBD-II connection. */
export interface VehicleProvider {
  readonly state: Observable<VehicleState>;
  readonly diagnostics: Observable<DiagnosticsState>;
  /** Read stored + pending fault codes. */
  readDtcs(): Promise<void>;
  /** Clear fault codes (and turn the check-engine lamp off). Resets the car's readiness monitors. */
  clearDtcs(): Promise<void>;
  start(): void;
  stop(): void;
}
