import type { MediaCommand, MediaState } from '@headunit/shared';
import type { Observable } from '../observable';
import type { LibraryProvider } from '../library/library';

export interface MediaProvider {
  readonly state: Observable<MediaState>;
  /** Browse, search, queue and like for this service. */
  readonly library: LibraryProvider;
  command(c: MediaCommand): Promise<void>;
  start(): void;
  stop(): void;
}
