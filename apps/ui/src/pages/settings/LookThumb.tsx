import { useMemo } from 'react';
import { paletteOf, previewOf, type Preset } from '../../lib/themes';
import { wallpaperUrl } from '../../lib/wallpapers';

/**
 * A look's gallery tile: its wallpaper (or its palette's colours), with a small card and a dock drawn in the look's own colours on top,
 * so the tile shows what the screen will look like rather than a name.
 */
export function LookThumb({ preset }: { preset: Pick<Preset, 'patch' | 'thumb'> }) {
  const { vars, attrs } = useMemo(() => previewOf(preset.patch), [preset]);
  const pal = paletteOf(preset.patch.theme);
  const url = preset.thumb ? wallpaperUrl(preset.thumb) : null;
  const bg = url ? `center / cover no-repeat url("${url}")` : `linear-gradient(135deg, ${pal.preview[0]}, ${pal.preview[1]} 60%, ${pal.preview[2]})`;
  return (
    <span className="look-thumb" style={{ ...vars, background: bg }} {...attrs}>
      <span className="look-thumb-dock" />
      <span className="look-thumb-card card">
        <i />
        <span>
          <b />
          <em />
        </span>
      </span>
      <span className="look-thumb-dot" />
    </span>
  );
}
