import type {
  CatalogItem,
  CatalogTrack,
  ConnectDevice,
  LibraryErrorBody,
  LibraryHome,
  QueueView,
  SearchResults,
  TrackListing,
} from '@headunit/shared';

export class LibraryError extends Error {
  constructor(
    message: string,
    public code?: LibraryErrorBody['code'],
  ) {
    super(message);
  }
}

/**
 * Browse / search / queue / like for one music service. Spotify implements it against the Web API;
 * the demo catalog implements it offline. Playback itself goes through `MediaProvider.command`.
 */
export interface LibraryProvider {
  home(): Promise<LibraryHome>;
  playlists(): Promise<CatalogItem[]>;
  liked(): Promise<CatalogTrack[]>;
  albums(): Promise<CatalogItem[]>;
  artists(): Promise<CatalogItem[]>;
  search(query: string): Promise<SearchResults>;
  playlist(id: string): Promise<TrackListing>;
  album(id: string): Promise<TrackListing>;
  queue(): Promise<QueueView>;
  /** Where playback can happen (Spotify Connect devices). */
  devices(): Promise<ConnectDevice[]>;
  /** Move playback to a device. */
  transfer(deviceId: string): Promise<void>;
  /** Save/remove a track from the user's library; resolves to the new liked state. */
  setLiked(uri: string, on: boolean): Promise<boolean>;
}
