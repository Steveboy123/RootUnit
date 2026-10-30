import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogTrack, MediaState } from '@headunit/shared';
import { useHeadUnit } from '../../store';
import { PhoneLinkSheet, TIDAL_NATIVE_NOTE, tidalTrackUrl, TidalPlayerCard, TidalSearchBar, whenProviderIsTidal } from './TidalMusic';

// The real lock reads the car's speed from the live store, which server-side rendering cannot change; the rule itself
// (speed, setting, passenger) is lib/driving.ts and is tested in lib/driving.test.ts. Here: what the TIDAL page does with it.
const car = vi.hoisted(() => ({ locked: false }));
vi.mock('../../lib/driving', () => ({ useTypingLocked: () => car.locked }));

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const track = (n: number, over: Partial<CatalogTrack> = {}): CatalogTrack => ({
  id: String(100 + n),
  uri: `tidal:track:${100 + n}`,
  title: `Song ${n}`,
  artist: `Artist ${n}`,
  album: `Album ${n}`,
  durationMs: 200_000,
  playable: true,
  ...over,
});

beforeEach(() => {
  car.locked = false;
});

describe('TidalSearchBar: typing is locked while driving, like Spotify, radio and YouTube Music', () => {
  const render = () => renderToStaticMarkup(<TidalSearchBar text="" onText={() => {}} onSearch={() => {}} searching={false} />);

  it('shows the search box when the car is not moving', () => {
    const html = render();
    expect(html).toContain('aria-label="Search TIDAL"');
    expect(html).toContain('class="tidal-searchbar"');
    expect(html).toContain('class="tidal-search-field"');
    expect(html).not.toContain('class="searchbar ytm-search"');
    expect(text(html)).toContain('Search');
    expect(html).not.toContain('class="gate"');
  });

  it('replaces the box with the lock notice and the passenger override while it is', () => {
    car.locked = true;
    const html = render();
    expect(text(html)).toContain('TIDAL search is locked while driving');
    expect(text(html)).toContain('I’m a passenger');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
  });
});

describe('TidalPlayerCard', () => {
  const noop = () => {};
  const card = (over: Partial<Parameters<typeof TidalPlayerCard>[0]> = {}) =>
    renderToStaticMarkup(<TidalPlayerCard current={track(1)} queue={[track(1)]} index={0} onStep={noop} onPhone={noop} onSettings={noop} {...over} />);

  it('renders the native head-unit player and never an iframe', () => {
    const html = card();
    expect(html).toContain('class="ytm-player-card tidal-native-player"');
    expect(html).toContain('aria-label="Play TIDAL"');
    expect(html).toContain('aria-label="TIDAL seek"');
    expect(html).toContain('aria-label="TIDAL player volume"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('embed.tidal.com');
  });

  it('has no link that would open a window inside the kiosk: "Open on phone" is a button that shows a QR code', () => {
    const html = card();
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('Open in TIDAL');
    expect(html).toMatch(/<button class="btn tidal-phone-btn">[^]*?Open on phone/); // enabled
    expect(html).not.toContain('<button class="btn tidal-phone-btn" disabled="">');
  });

  it('explains that playback is native and TIDAL controls full-track entitlement', () => {
    const t = text(card());
    expect(t).toContain('Native TIDAL player');
    expect(t).toContain('full-track access depends on the playback access TIDAL grants');
    expect(TIDAL_NATIVE_NOTE).not.toMatch(/iframe|embed/i);
  });

  it('shows the cover as the same 3D artwork as Home and Now Playing (vinyl until another style is chosen)', () => {
    const html = card({ current: track(1, { artUrl: 'https://resources.tidal.com/cover.jpg' }) });
    expect(html).toContain('<div class="tidal-native-art"><span class="art" data-mode="vinyl" data-playing="false"');
    expect(html).toContain('class="art-record');
    expect(html).toContain('url(&quot;https://resources.tidal.com/cover.jpg&quot;)');
    // Without a cover there is nothing to animate: the plain placeholder.
    expect(card({ current: null, queue: [], index: -1 })).toContain('data-mode="still"');
  });

  it('with nothing chosen: no embed, nothing to open on a phone', () => {
    const html = card({ current: null, queue: [], index: -1 });
    expect(html).not.toContain('<iframe');
    expect(text(html)).toContain('Search TIDAL and tap a track');
    expect(html).toContain('<button class="btn tidal-phone-btn" disabled="">');
    expect(html).not.toContain('class="ytm-queue"');
  });

  it('previous / next follow the queue, and the queue lists every track with its number', () => {
    const queue = [track(1), track(2), track(3)];
    const first = card({ queue, index: 0 });
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous TIDAL track"/);
    expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next TIDAL track"/);
    expect(text(first)).toContain('Queue · 3');
    expect(first).toContain('<span>3</span><span class="ellip">Song 3<small>Artist 3</small></span>');
    const last = card({ current: queue[2]!, queue, index: 2 });
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next TIDAL track"/);
    expect(last).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous TIDAL track"/);
  });

  it('marks the playing queue row', () => {
    const queue = [track(1), track(2)];
    const html = card({ current: queue[1]!, queue, index: 1 });
    expect(html).toMatch(/<button data-on="true"[^>]*><span>2<\/span>/);
    expect(html).toMatch(/<button data-on="false"[^>]*><span>1<\/span>/);
  });
});

describe('PhoneLinkSheet: the track address for the driver’s phone', () => {
  const html = renderToStaticMarkup(<PhoneLinkSheet track={track(7, { title: 'A & B' })} onClose={() => {}} />);

  it('shows a QR code and the address as text, with a Copy button', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Open on your phone"');
    expect(html).toMatch(/<svg class="qr"[^>]*aria-label="QR code to open A &amp; B on TIDAL"/);
    expect(html).toContain('<div class="copy-box copy-long">https://tidal.com/browse/track/107</div>');
    expect(html).toContain('aria-label="Copy TIDAL track address"');
    expect(text(html)).toContain('Point your phone’s camera at the code');
  });

  it('is not a link: nothing in it can navigate the kiosk away', () => {
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('target=');
  });
});

describe('addresses', () => {
  it('builds only the phone address from the track id, escaped', () => {
    expect(tidalTrackUrl('123')).toBe('https://tidal.com/browse/track/123');
    expect(tidalTrackUrl('a/b?c')).toBe('https://tidal.com/browse/track/a%2Fb%3Fc');
  });
});

describe('whenProviderIsTidal: browsing waits for the hub to be on TIDAL', () => {
  const provider = (p: MediaState['provider']) => useHeadUnit.setState({ media: { provider: p } as unknown as MediaState });

  beforeEach(() => {
    vi.useFakeTimers();
    provider('spotify');
  });
  afterEach(() => vi.useRealTimers());

  it('answers at once when TIDAL is already the active provider', async () => {
    provider('tidal');
    await expect(whenProviderIsTidal()).resolves.toBe(true);
  });

  it('answers as soon as the server reports TIDAL', async () => {
    const p = whenProviderIsTidal(4000);
    provider('spotify');
    provider('tidal');
    await expect(p).resolves.toBe(true);
  });

  it('gives up after the timeout when the hub never switches (offline), so the search can say so', async () => {
    const p = whenProviderIsTidal(4000);
    await vi.advanceTimersByTimeAsync(3999);
    provider('spotify');
    await vi.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toBe(false);
  });
});
