import type { DeviceCommand, DevicesState } from '@headunit/shared';
import type { Observable } from '../observable';

export interface DevicesProvider {
  readonly state: Observable<DevicesState>;
  command(c: DeviceCommand): Promise<void>;
  start(): void;
  stop(): void;
}
