import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Background } from '@headunit/shared';
import { backdropArtUrl, cachedArt, loadArt, type ArtAnalysis } from '../lib/art';
import { planBackdrop, type BackdropPlan, type Layer } from '../lib/backdrop';
import type { Palette } from '../lib/themes';
import { wallpaperUrl } from '../lib/wallpapers';
import { selectBackdropArt, useHeadUnit } from '../store';

const ART_MODES: ReadonlySet<Background> = new Set<Background>(['art-blur', 'art-cover', 'art-ambient']);

interface Loaded {
  url: string;
  ok: boolean;
  cors: boolean;
  analysis: ArtAnalysis | null;
}

/** Load (and analyse) a picture; `null` until it is known. A cached picture is known at once, so going back to a track paints immediately. */
function usePicture(url: string | null): Loaded | null {
  const [state, setState] = useState<Loaded | null>(() => {
    if (!url) return null;
    const hit = cachedArt(url);
    return hit ? { url, ok: hit.ok, cors: hit.cors, analysis: hit.analysis } : null;
  });
  useEffect(() => {
    if (!url) return setState(null);
    let live = true;
    const hit = cachedArt(url);
    if (hit) setState({ url, ok: hit.ok, cors: hit.cors, analysis: hit.analysis });
    else void loadArt(url).then((art) => live && setState({ url, ok: art.ok, cors: art.cors, analysis: art.analysis }));
    return () => {
      live = false;
    };
  }, [url]);
  return state && state.url === url ? state : null;
}

function layerStyle(l: Layer): CSSProperties {
  if (l.kind === 'image') return {};
  const s: CSSProperties = { backgroundImage: l.image };
  if (l.size) s.backgroundSize = l.size;
  if (l.position) s.backgroundPosition = l.position;
  if (l.repeat) s.backgroundRepeat = l.repeat;
  if (l.opacity !== undefined) s.opacity = l.opacity;
  if (l.box) Object.assign(s, { left: `${l.box.x}%`, top: `${l.box.y}%`, width: `${l.box.w}%`, height: `${l.box.h}%` });
  if (l.period) s.animationDuration = `calc(${l.period}s * var(--tempo))`;
  if (l.delay) s.animationDelay = `${l.delay}s`;
  return s;
}

function ModeLayers({ plan }: { plan: BackdropPlan }) {
  return (
    <>
      {plan.layers.map((l, i) =>
        l.kind === 'image' ? (
          <img
            key={i}
            className={`bd-img bd-${l.variant}`}
            src={l.url}
            alt=""
            crossOrigin={l.cors ? 'anonymous' : undefined}
            decoding="async"
            draggable={false}
            style={l.variant === 'blur' ? { ['--blur' as string]: `${l.blur}px` } : undefined}
          />
        ) : (
          <div key={i} className={`bd-css${l.shape ? ` bd-${l.shape}` : ''}${l.drift ? ` fx bd-${l.drift}` : ''}`} style={layerStyle(l)} />
        ),
      )}
    </>
  );
}

/**
 * Everything behind the app: the palette's page, the chosen picture or pattern, the scrim that keeps text readable, and a vignette for
 * pictures. When the picture changes (a new song, another wallpaper) the new one fades in over the old.
 */
export const Backdrop = memo(function Backdrop({ palette, accent, accent2 }: { palette: Palette; accent: string; accent2: string }) {
  const background = useHeadUnit((s) => s.settings?.background ?? 'none');
  const effects = useHeadUnit((s) => s.settings?.effects ?? 'balanced');
  const wallpaper = useHeadUnit((s) => s.settings?.wallpaper);
  const bgBlur = useHeadUnit((s) => s.settings?.bgBlur ?? 28);
  const bgDim = useHeadUnit((s) => s.settings?.bgDim ?? 45);
  const art = useHeadUnit((s) => (ART_MODES.has(s.settings?.background ?? 'none') ? selectBackdropArt(s) : undefined));

  const pictureUrl = background === 'wallpaper' ? wallpaperUrl(wallpaper) : art ? backdropArtUrl(art) : null;
  const picture = usePicture(ART_MODES.has(background) || background === 'wallpaper' ? pictureUrl : null);
  const pending = !!pictureUrl && !picture;

  const plan = useMemo(
    () =>
      planBackdrop({
        background,
        effects,
        palette,
        accent,
        accent2,
        artUrl: background !== 'wallpaper' && picture?.ok ? picture.url : null,
        analysis: picture?.analysis ?? null,
        wallpaper,
        wallpaperOk: background !== 'wallpaper' || pending || picture?.ok !== false,
        cors: picture?.cors,
        bgBlur,
        bgDim,
      }),
    [background, effects, palette, accent, accent2, picture, wallpaper, pending, bgBlur, bgDim],
  );

  // Crossfade: the previous mode layer stays a moment while the new one fades in on top of it.
  const [prev, setPrev] = useState<BackdropPlan | null>(null);
  const last = useRef(plan);
  useEffect(() => {
    if (last.current.key === plan.key) {
      last.current = plan;
      return;
    }
    setPrev(last.current);
    last.current = plan;
    const t = window.setTimeout(() => setPrev(null), 900);
    return () => window.clearTimeout(t);
  }, [plan]);

  return (
    <div className="layer backdrop" aria-hidden="true" data-drift={plan.drift}>
      <div className="layer bd-base" style={{ backgroundImage: plan.base }} />
      {prev && (
        <div className="layer bd-mode bd-leaving" key={`p:${prev.key}`}>
          <ModeLayers plan={prev} />
        </div>
      )}
      <div className="layer bd-mode bd-entering" key={plan.key}>
        <ModeLayers plan={plan} />
      </div>
      <div className="layer bd-scrim" style={{ background: plan.scrim.color, opacity: plan.scrim.opacity }} />
      {plan.vignette && <div className="layer bd-vignette" style={{ backgroundImage: plan.vignette }} />}
    </div>
  );
});
