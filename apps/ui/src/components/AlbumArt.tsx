import type { ReactNode } from 'react';
import { Music2 } from 'lucide-react';
import type { AlbumMotion } from '@headunit/shared';
import { useHeadUnit } from '../store';

interface AlbumArtProps {
  artUrl?: string;
  playing: boolean;
  /** Small spots (a widget, a list) get a simpler drawing of the same mode. */
  size?: 'sm' | 'md' | 'lg';
  /** Override the setting (the mode picker previews each one). */
  mode?: AlbumMotion;
  fallback?: ReactNode;
  label?: string;
}

const bg = (url?: string) => (url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined);

/**
 * The cover of what is playing, drawn in the chosen style (Settings → Appearance → Effects → Album artwork). Decorative: the element
 * around it owns taps. A record or reel turns only while music plays; pause freezes it. Everything is CSS transforms (album.css).
 */
export function AlbumArt({ artUrl, playing, size = 'md', mode: forced, fallback, label }: AlbumArtProps) {
  const chosen = useHeadUnit((s) => s.settings?.albumMotion ?? 'vinyl');
  const mode: AlbumMotion = forced ?? (artUrl ? chosen : 'still');
  const cover = (extra = '') => (
    <span className={`art-cover ${extra}`} style={bg(artUrl)}>
      {!artUrl && (fallback ?? <Music2 />)}
      <i className="art-shine" />
    </span>
  );

  let body: ReactNode;
  switch (mode) {
    case 'vinyl':
      body = (
        <>
          <span className="art-record fx fx-drive">
            <span className="art-label" style={bg(artUrl)} />
            <i className="art-hole" />
          </span>
          {size !== 'sm' && <i className="art-tonearm" />}
        </>
      );
      break;
    case 'cd':
      body = (
        <span className="art-cd fx fx-drive">
          <span className="art-cd-print" style={bg(artUrl)} />
          <i className="art-cd-rainbow" />
          <i className="art-hole" />
        </span>
      );
      break;
    case 'cassette':
      body = (
        <span className="art-cassette">
          <span className="art-cassette-label" style={bg(artUrl)} />
          <span className="art-cassette-window">
            <i className="art-reel fx fx-drive" />
            <i className="art-reel fx fx-drive" />
          </span>
          <i className="art-cassette-notch" />
        </span>
      );
      break;
    case 'stack':
      body = (
        <>
          <span className="art-cover art-stack-back b2" style={bg(artUrl)} />
          <span className="art-cover art-stack-back b1" style={bg(artUrl)} />
          {cover('fx art-top')}
        </>
      );
      break;
    case 'polaroid':
      body = (
        <span className="art-polaroid fx">
          {cover()}
          {size !== 'sm' && <span className="art-polaroid-caption truncate">{label ?? ''}</span>}
        </span>
      );
      break;
    case 'glitch':
      body = (
        <span className="art-glitch fx">
          <span className="art-ghost a" style={bg(artUrl)} />
          <span className="art-ghost b" style={bg(artUrl)} />
          {cover()}
        </span>
      );
      break;
    case 'flip':
      // Keyed on the picture, so each new track flips in once.
      body = (
        <span className="art-flip" key={artUrl ?? 'none'}>
          {cover('fx')}
        </span>
      );
      break;
    case 'cube':
      body =
        size === 'sm' ? (
          cover('fx')
        ) : (
          <span className="art-cube fx">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="art-cover art-face" style={{ ...bg(artUrl), ['--i' as string]: i }}>
                {!artUrl && (fallback ?? <Music2 />)}
                <i className="art-face-shade" />
              </span>
            ))}
          </span>
        );
      break;
    case 'mirror':
      body = (
        <>
          {cover('fx art-mirrored')}
          {size !== 'sm' && <span className="art-reflection fx" style={bg(artUrl)} />}
        </>
      );
      break;
    case 'sleeve':
      // The record slides out of its sleeve once per track (keyed on the picture), then turns while the music plays.
      body = (
        <>
          <span className="art-sleeve-disc" key={artUrl ?? 'none'}>
            <span className="art-record fx fx-drive">
              <span className="art-label" style={bg(artUrl)} />
              <i className="art-hole" />
            </span>
          </span>
          {cover('art-sleeve')}
        </>
      );
      break;
    case 'orbit':
    case 'prism':
      body = (
        <>
          <i className="art-ring fx" />
          <i className="art-ring fx r2" />
          {cover('fx')}
        </>
      );
      break;
    default:
      body = cover('fx');
  }

  return (
    <span className="art" data-mode={mode} data-playing={playing} data-size={size} aria-hidden="true">
      <i className="art-glow fx" />
      {body}
      {(mode === 'float' || mode === 'glass' || mode === 'prism' || mode === 'tilt') && <i className="art-floor fx" />}
    </span>
  );
}
