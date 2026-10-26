import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ScaleContext = createContext(1);
/** CSS scale applied by the preview frame; drag maths needs it. */
export const useScale = () => useContext(ScaleContext);

export const SCREEN_PRESETS = [
  { id: '800x480', w: 800, h: 480, label: '800×480' },
  { id: '1024x600', w: 1024, h: 600, label: '1024×600' },
  { id: '1280x720', w: 1280, h: 720, label: '1280×720' },
  { id: '1280x400', w: 1280, h: 400, label: '1280×400' },
] as const;

const KEY = 'hu.frame';

/**
 * Which screen size to show: `?frame=800x480` picks one, a bare `?frame` (or an unknown size) keeps the one chosen last time, and
 * the first time it is 1024×600.
 */
export function frameChoice(search: string, stored: string | null): string {
  const known = (id: string | null | undefined): id is string => SCREEN_PRESETS.some((p) => p.id === id);
  const asked = new URLSearchParams(search).get('frame');
  return known(asked) ? asked : known(stored) ? stored : '1024x600';
}

const read = (): string => {
  try {
    return frameChoice(location.search, localStorage.getItem(KEY));
  } catch {
    return '1024x600';
  }
};

/**
 * Desktop preview: the UI at an exact car-screen resolution (scaled down to fit the window) with a resolution picker.
 * On the car itself (a production build without ?frame) it is a no-op.
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  const params = new URLSearchParams(location.search);
  const enabled = (import.meta.env.DEV && !params.has('noframe')) || params.has('frame');
  const [choice, setChoice] = useState(read);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  if (!enabled) return <>{children}</>;
  const pick = (id: string) => {
    setChoice(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode */
    }
  };
  const preset = SCREEN_PRESETS.find((p) => p.id === choice);
  if (!preset) return <>{children}</>;
  const bare = params.has('bare');
  const scale = Math.min(1, (win.w - (bare ? 0 : 48)) / preset.w, (win.h - (bare ? 0 : 96)) / preset.h);
  return (
    <div className="device-frame">
      {!bare && (
        <div className="device-bar">
          {SCREEN_PRESETS.map((p) => (
            <button key={p.id} type="button" data-active={choice === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => pick('fit')}>
            Fit
          </button>
        </div>
      )}
      <div className="device-screen" style={{ width: preset.w, height: preset.h, transform: `scale(${scale})`, borderRadius: bare ? 0 : undefined, boxShadow: bare ? 'none' : undefined }}>
        <ScaleContext.Provider value={scale}>{children}</ScaleContext.Provider>
      </div>
    </div>
  );
}
