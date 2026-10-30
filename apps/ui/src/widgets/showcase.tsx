import { CarFront, ChevronLeft, ChevronRight, CloudOff, Flag, Gauge, Heart, Lightbulb, ListMusic, MapPin, Music2, Radio as RadioIcon, Route, Settings as SettingsIcon, Smartphone, Video } from 'lucide-react';
import { AlbumArt } from '../components/AlbumArt';
import { rememberFmState, useFmTuner } from '../components/fm/hooks';
import { LikeButton } from '../components/LikeButton';
import { Transport } from '../components/Transport';
import { Eq } from '../components/ui';
import { appById } from '../apps/registry';
import { fmView, frequencyText, nextFrequency, presetsView, fmCalls } from '../lib/fm';
import { convert, formatClock, formatMs, unitLabel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { openAppDef } from '../lib/nav';
import { useNowPlaying } from '../lib/nowPlaying';
import { celsiusToDisplay } from '../lib/units';
import { describeWeather, weatherIcon } from '../lib/weather';
import { MASCOT_ASSETS } from '../layers/Mascot';
import { useHeadUnit, useSvc } from '../store';
import type { WidgetProps } from './types';
import { MediaNotice } from './media';

const BARS = 28;

/**
 * A spectrum along the bottom of the hero card. With the music meter on (Appearance → Effects → Beat) its height follows the real
 * loudness; without it the bars only sway while something plays. Transform-only, and it stops while driving like every .fx.
 */
function Spectrum({ playing }: { playing: boolean }) {
  return (
    <div className="w-spectrum" data-on={playing} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} className="fx" style={{ ['--i' as string]: i, ['--s' as string]: (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7))).toFixed(2) }} />
      ))}
    </div>
  );
}

/**
 * The hero player: the cover big, what is playing, a seek line and the controls, a spectrum underneath, and (as in the cockpit look)
 * the mascot standing inside the card. `config.mascot` turns the mascot off; `config.layout: 'focus'` is the full-page player.
 */
export function HeroPlayer({ instance }: WidgetProps) {
  const np = useNowPlaying();
  const go = useHeadUnit((s) => s.go);
  const setTab = useHeadUnit((s) => s.setMusicTab);
  const variant = useHeadUnit((s) => s.settings?.mascotVariant ?? 'transparent');
  const showMascot = instance.config?.mascot !== 'off';
  const focus = instance.config?.layout === 'focus';
  if (!np) return <MediaNotice />;
  const pct = np.progressMs !== null && np.durationMs ? Math.min(1, np.progressMs / np.durationMs) : null;
  const open = () => {
    if (np.tab) setTab(np.tab);
    go('nowplaying');
  };
  return (
    <div className="w-hero" data-focus={focus || undefined} data-mascot={showMascot || undefined}>
      {showMascot && <img className="w-hero-mascot" src={MASCOT_ASSETS[variant] ?? MASCOT_ASSETS.transparent} alt="" draggable={false} />}
      <button type="button" className="w-hero-art" onClick={open} aria-label={`Open ${np.title}`} data-no-swipe>
        <AlbumArt artUrl={np.artUrl} playing={np.playing} size={focus ? 'lg' : 'md'} label={np.title} fallback={np.kind === 'radio' ? <RadioIcon /> : <Music2 />} />
      </button>
      <div className="w-hero-info">
        <span className="w-hero-source">
          <Eq on={np.playing} /> {np.sourceLabel}
        </span>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }} key={np.title}>
            <b className="w-hero-title display">{np.title}</b>
            <span className="w-hero-artist truncate">{[np.artist, np.album].filter(Boolean).join(' · ')}</span>
          </div>
          {np.kind === 'media' ? <LikeButton /> : <Heart className="dim" size={20} aria-hidden="true" />}
        </div>
        {pct !== null ? (
          <div className="w-hero-seek">
            <div className="w-np-bar">
              <i style={{ transform: `scaleX(${pct})` }} />
            </div>
            <div className="row num dim" style={{ justifyContent: 'space-between', fontSize: '0.75rem' }}>
              <span>{formatMs(np.progressMs ?? 0)}</span>
              <span>{formatMs(np.durationMs ?? 0)}</span>
            </div>
          </div>
        ) : (
          <div className="dim" style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em' }}>LIVE</div>
        )}
        <div className="w-hero-controls" data-no-swipe>
          <Transport size={focus ? 'lg' : 'md'} />
        </div>
      </div>
      <Spectrum playing={np.playing} />
    </div>
  );
}

/** The clock big, the date, and the weather where you are. */
export function ClockWeather() {
  const now = useNow(1000);
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const w = useSvc('weather');
  const { time, suffix } = formatClock(now, h24);
  const cur = w?.current;
  const today = w?.daily[0];
  const Icon = cur ? weatherIcon(cur.code, cur.isDay) : CloudOff;
  const t = (c: number) => `${Math.round(celsiusToDisplay(c, units))}°`;
  return (
    <div className="w-cw">
      <div className="w-cw-time num">
        {time}
        {suffix && <small>{suffix}</small>}
      </div>
      <div className="w-cw-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      {cur ? (
        <div className="w-cw-wx">
          <Icon className="w-cw-icon fx" />
          <div>
            <b className="num">{t(cur.tempC)}</b>
            {today && (
              <small className="num">
                ↑ {t(today.maxC)} ↓ {t(today.minC)}
              </small>
            )}
          </div>
        </div>
      ) : (
        <div className="dim" style={{ fontSize: '0.8rem' }}>
          <CloudOff size={16} /> No weather yet
        </div>
      )}
      {cur && <div className="w-cw-cond">{describeWeather(cur.code).label}</div>}
      {w?.location?.name && (
        <div className="w-cw-place dim">
          <MapPin size={13} /> {w.location.name}
        </div>
      )}
    </div>
  );
}

/** The FM transmitter at a glance: the frequency, a dial, step buttons and the saved stations. */
export function FmTuner() {
  const view = fmView(useSvc('fm'));
  const { shown, step, jump } = useFmTuner(view.frequency);
  const presets = presetsView(view, shown);
  const span = Math.max(0.1, view.limits.max - view.limits.min);
  const pos = shown === null ? 0.5 : Math.min(1, Math.max(0, (shown - view.limits.min) / span));
  const on = view.status === 'transmitting';
  return (
    <div className="w-fm" data-on={on} data-no-swipe>
      <div className="w-fm-head">
        <button type="button" className="icon-btn" aria-label="Down a tenth" disabled={!view.ready} onClick={() => step(nextFrequency(shown, -1, view.limits))}>
          <ChevronLeft />
        </button>
        <div className="w-fm-freq">
          <span className="w-fm-waves fx" aria-hidden="true" />
          <b className="num">{frequencyText(shown)}</b>
          <small>MHz</small>
        </div>
        <button type="button" className="icon-btn" aria-label="Up a tenth" disabled={!view.ready} onClick={() => step(nextFrequency(shown, 1, view.limits))}>
          <ChevronRight />
        </button>
      </div>
      <div className="w-fm-dial" aria-hidden="true">
        {Array.from({ length: 31 }, (_, i) => (
          <i key={i} data-major={i % 5 === 0} />
        ))}
        <span className="w-fm-needle" style={{ ['--pos' as string]: pos }} />
      </div>
      <div className="w-fm-presets">
        {presets.chips.slice(0, 4).map((c) => (
          <button key={c.frequency} type="button" className="w-fm-preset num" data-active={c.active} onClick={() => jump(c.frequency)}>
            {c.text}
          </button>
        ))}
        {presets.chips.length === 0 && (
          <button
            type="button"
            className="w-fm-preset"
            disabled={shown === null || presets.disabled}
            onClick={() => shown !== null && void fmCalls.preset(shown, true).then(rememberFmState)}
          >
            Save this
          </button>
        )}
      </div>
    </div>
  );
}

const TILES = [
  { key: 'aa', label: 'Android Auto', icon: Smartphone, run: (s: ReturnType<typeof useHeadUnit.getState>) => s.go('aa'), primary: true },
  { key: 'music', label: 'Music', icon: Music2, run: (s: ReturnType<typeof useHeadUnit.getState>) => s.go('media') },
  {
    key: 'ytm',
    label: 'YouTube Music',
    icon: ListMusic,
    run: (s: ReturnType<typeof useHeadUnit.getState>) => {
      s.setMusicTab('youtube-music');
      s.go('media');
    },
  },
  { key: 'lights', label: 'Lights', icon: Lightbulb, app: 'lights' },
  { key: 'dashcam', label: 'Dashcam', icon: Video, app: 'dashcam' },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, run: (s: ReturnType<typeof useHeadUnit.getState>) => s.go('settings') },
] as const;

/** Six big shortcuts: Android Auto, Music, YouTube Music, Lights, Dashcam, Settings. */
export function QuickTiles() {
  return (
    <div className="w-qtiles" data-no-swipe>
      {TILES.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            className="w-qtile"
            data-primary={'primary' in t && t.primary}
            onClick={() => {
              if ('app' in t) {
                const app = appById(t.app);
                if (app) openAppDef(app);
              } else t.run(useHeadUnit.getState());
            }}
          >
            <Icon />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The car itself: a picture, any fault codes, and this drive's numbers. */
export function VehicleCard() {
  const v = useHeadUnit((s) => s.vehicle);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const go = useHeadUnit((s) => s.go);
  const faults = v?.mil?.count ?? 0;
  const speed = (kmh: number) => Math.round(convert('speed', units, kmh));
  return (
    <button type="button" className="w-car" onClick={() => go('vehicle')} data-no-swipe aria-label="Open Vehicle">
      <span className="w-car-pic" aria-hidden="true">
        <svg viewBox="0 0 220 80">
          <defs>
            <linearGradient id="car-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.12" />
            </linearGradient>
          </defs>
          <path d="M14 58 L18 44 Q24 38 46 35 L74 22 Q86 16 112 16 L140 17 Q156 18 172 30 L196 36 Q208 39 208 50 L206 58 Z" fill="url(#car-body)" stroke="currentColor" strokeOpacity="0.6" />
          <path d="M80 34 L96 22 Q106 19 124 19 L138 20 L150 34 Z" fill="currentColor" fillOpacity="0.18" />
          <circle cx="56" cy="58" r="12" fill="#07080b" stroke="currentColor" strokeOpacity="0.5" />
          <circle cx="166" cy="58" r="12" fill="#07080b" stroke="currentColor" strokeOpacity="0.5" />
          <path d="M196 42 L208 44" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      {faults > 0 && (
        <span className="badge w-car-fault" data-tone="warn">
          {faults} fault{faults === 1 ? '' : 's'}
        </span>
      )}
      <span className="w-car-stats">
        <span>
          <Gauge size={15} />
          <b className="num">{v ? speed(v.speedKmh) : '–'}</b>
          <small>{unitLabel('speed', units)}</small>
        </span>
        <span>
          <Route size={15} />
          <b className="num">{v ? convert('dist', units, v.trip.distanceKm).toFixed(1) : '–'}</b>
          <small>{unitLabel('dist', units)}</small>
        </span>
        <span>
          <CarFront size={15} />
          <b className="num">{v ? speed(v.trip.avgSpeedKmh) : '–'}</b>
          <small>avg</small>
        </span>
        <span>
          <Flag size={15} />
          <b className="num">{v ? speed(v.trip.maxSpeedKmh) : '–'}</b>
          <small>top</small>
        </span>
      </span>
    </button>
  );
}
