import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { Check, Lock, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { MONTHS_SHORT, addMonthsIso, daysInMonth, formatDate, parseIso, todayIso, withPart } from '../lib/dates';
import { useTypingLocked } from '../lib/driving';
import { useHeadUnit } from '../store';

export type Tone = 'ok' | 'warn' | 'danger' | 'info';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** A scrolling page. Every page and app sits in one, so margins and scrolling are the same everywhere. */
export function Page({ title, subtitle, actions, children, className, fixed }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; fixed?: boolean }) {
  return (
    <div className={cx('page', fixed && 'fixed', className)}>
      {(title || subtitle || actions) && (
        <header className="page-head">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {subtitle && <div className="dim" style={{ fontSize: '0.86rem' }}>{subtitle}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  );
}

/** A responsive grid of panels: as many columns of at least `min` px as fit. */
export function Cols({ children, min = 300, className }: { children: ReactNode; min?: number; className?: string }) {
  return (
    <div className={cx('cols', className)} style={{ display: 'grid', gap: 'var(--gap)', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, alignItems: 'start' }}>
      {children}
    </div>
  );
}

/** A card with a title row. */
export function Panel({ title, icon: Icon, aside, children, className, tone, style }: { title?: ReactNode; icon?: LucideIcon; aside?: ReactNode; children: ReactNode; className?: string; tone?: Tone; style?: CSSProperties }) {
  return (
    <section className={cx('card panel', className)} data-tone={tone} style={style}>
      {(title || aside) && (
        <header className="panel-head">
          <h3>
            {Icon && <Icon />}
            {title}
          </h3>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, tone, hint }: { label: ReactNode; value: ReactNode; unit?: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="stat" data-tone={tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Stats({ children, cols }: { children: ReactNode; cols?: number }) {
  return (
    <div className="stats" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {children}
    </div>
  );
}

/** One line of a list: icon, label and hint, something on the right. A button when it does something. */
export function Row({ icon: Icon, label, hint, right, onClick, tone, active, className }: { icon?: LucideIcon; label: ReactNode; hint?: ReactNode; right?: ReactNode; onClick?: () => void; tone?: Tone; active?: boolean; className?: string }) {
  const body = (
    <>
      {Icon && (
        <span className="lr-icon">
          <Icon />
        </span>
      )}
      <span className="lr-text">
        <div className="lr-label truncate">{label}</div>
        {hint && <div className="lr-hint">{hint}</div>}
      </span>
      {right !== undefined && <span className="lr-right">{right}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cx('list-row', className)} data-tone={tone} data-active={active} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cx('list-row', className)} data-tone={tone} data-active={active}>
      {body}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="toggle" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** A row with a switch on the right. */
export function SwitchRow({ icon, label, hint, on, onChange, disabled }: { icon?: LucideIcon; label: string; hint?: ReactNode; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return <Row icon={icon} label={label} hint={hint} right={<Toggle on={on} onChange={onChange} label={label} disabled={disabled} />} />;
}

/** A segmented switch whose highlight slides to the chosen option. */
export function Segment<T extends string>({ value, options, onChange, label, className }: { value: T; options: ReadonlyArray<{ value: T; label: ReactNode; icon?: LucideIcon }>; onChange: (v: T) => void; label?: string; className?: string }) {
  const i = options.findIndex((o) => o.value === value);
  return (
    <div className={cx('seg', className)} role="radiogroup" aria-label={label} data-none={i < 0} style={{ ['--n' as string]: options.length, ['--i' as string]: Math.max(0, i) }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-active={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon size={16} style={{ display: 'inline', verticalAlign: '-3px', marginRight: 5 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chips that pick one value. */
export function ChoiceChips<T extends string>({ value, options, onChange, scroll }: { value: T; options: ReadonlyArray<{ value: T; label: ReactNode; icon?: LucideIcon; swatch?: string }>; onChange: (v: T) => void; scroll?: boolean }) {
  return (
    <div className={cx('chips', scroll && 'scroll')} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="chip" data-active={o.value === value} onClick={() => onChange(o.value)}>
          {o.swatch && <i className="swatch" style={{ ['--sw' as string]: o.swatch }} />}
          {o.icon && <o.icon />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A touch slider: drag anywhere on it. Only transforms move while dragging. `onChange` fires as it moves, `onCommit` once on release
 * (use that for anything sent to the server).
 */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, onCommit, label, disabled, thick }: { value: number; min?: number; max?: number; step?: number; onChange?: (v: number) => void; onCommit?: (v: number) => void; label: string; disabled?: boolean; thick?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const frac = max > min ? (Math.min(max, Math.max(min, shown)) - min) / (max - min) : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const valueAt = (clientX: number) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const f = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    const raw = min + f * (max - min);
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };

  return (
    <div
      ref={ref}
      className={cx('slider', thick && 'thick')}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-dragging={drag !== null}
      style={{ ['--v' as string]: frac, ['--w' as string]: `${width}px` }}
      onPointerDown={(e) => {
        if (disabled || !e.isPrimary) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDrag(v);
        onChange?.(v);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = valueAt(e.clientX);
        if (v !== drag) {
          setDrag(v);
          onChange?.(v);
        }
      }}
      onPointerUp={() => {
        if (drag === null) return;
        onCommit?.(drag);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (disabled) return;
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
        if (!d) return;
        e.preventDefault();
        const v = Math.min(max, Math.max(min, value + d));
        onChange?.(v);
        onCommit?.(v);
      }}
    >
      <div className="slider-track">
        <div className="slider-fill" />
      </div>
      <div className="slider-thumb" />
    </div>
  );
}

/** A labelled slider row with the value on the right. */
export function SliderRow({ icon: Icon, label, value, min = 0, max = 100, step = 1, unit = '', onCommit, disabled, hint }: { icon?: LucideIcon; label: string; value: number; min?: number; max?: number; step?: number; unit?: string; onCommit: (v: number) => void; disabled?: boolean; hint?: ReactNode }) {
  const [live, setLive] = useState<number | null>(null);
  return (
    <div className="slider-row" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 8, fontWeight: 650, fontSize: '0.92rem' }}>
          {Icon && <Icon size={18} className="dim" />}
          {label}
        </span>
        <b className="num">
          {Math.round(live ?? value)}
          {unit}
        </b>
      </div>
      <Slider label={label} value={value} min={min} max={max} step={step} disabled={disabled} onChange={setLive} onCommit={(v) => { setLive(null); onCommit(v); }} />
      {hint && <div className="dim" style={{ fontSize: '0.8rem' }}>{hint}</div>}
    </div>
  );
}

/** [-] value [+] with hold-to-repeat. */
export function Stepper({ value, onChange, min, max, step = 1, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => ReactNode; label: string }) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;
  const stop = () => window.clearInterval(timer.current);
  useEffect(() => stop, []);
  const bump = (d: number) => {
    const next = Math.min(max, Math.max(min, latest.current + d));
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  };
  const hold = (d: number) => ({
    onPointerDown: () => {
      bump(d);
      stop();
      let n = 0;
      timer.current = window.setInterval(() => {
        n++;
        if (n > 3) bump(d);
      }, 110);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  });
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={`Less ${label}`} disabled={value <= min} {...hold(-step)}>
        <Minus />
      </button>
      <output className="num">{format ? format(value) : value}</output>
      <button type="button" className="icon-btn" aria-label={`More ${label}`} disabled={value >= max} {...hold(step)}>
        <Plus />
      </button>
    </div>
  );
}

export function Banner({ tone = 'info', icon: Icon, children, action }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="banner" data-tone={tone} role={tone === 'danger' || tone === 'warn' ? 'alert' : undefined}>
      {Icon && <Icon />}
      <div className="banner-body">{children}</div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon />
      <b>{title}</b>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

/** A thin bar that fills to `value` (0..max). */
export function Meter({ value, max = 100, tone, label }: { value: number; max?: number; tone?: Tone; label: string }) {
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} data-tone={tone}>
      <i style={{ transform: `scaleX(${f})` }} />
    </div>
  );
}

export function Badge({ tone, children, live }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={cx('badge', live && 'live')} data-tone={tone}>
      {children}
    </span>
  );
}

export const Spinner = ({ size = 26 }: { size?: number }) => <span className="spinner" role="status" aria-label="Loading" style={{ width: size, height: size }} />;

/** Equalizer bars that dance while `on`. */
export const Eq = ({ on }: { on: boolean }) => (
  <span className="eq fx fx-drive" data-on={on} aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
  </span>
);

export const CONFIRM_GUARD_MS = 350;

/** What a tap on a confirm button does: the first arms it, a deliberate second one confirms, one that comes too soon is ignored. */
export function confirmStep(armed: boolean, armedAtMs: number, nowMs: number): 'arm' | 'confirm' | 'ignore' {
  if (!armed) return 'arm';
  return nowMs - armedAtMs < CONFIRM_GUARD_MS ? 'ignore' : 'confirm';
}

/** A destructive action needs a second tap: the first turns the button into "Tap again to confirm" for a few seconds. */
export function ConfirmButton({ label, confirmLabel = 'Tap again to confirm', onConfirm, icon: Icon, className = 'btn danger', disabled }: { label: ReactNode; confirmLabel?: ReactNode; onConfirm: () => unknown; icon?: LucideIcon; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const armedAt = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const click = () => {
    const step = confirmStep(armed, armedAt.current, Date.now());
    if (step === 'ignore') return;
    window.clearTimeout(timer.current);
    if (step === 'confirm') {
      setArmed(false);
      void onConfirm();
      return;
    }
    armedAt.current = Date.now();
    setArmed(true);
    timer.current = window.setTimeout(() => setArmed(false), 3500);
  };
  return (
    <button type="button" className={className} data-armed={armed && !disabled} disabled={disabled} onClick={click}>
      {armed && !disabled ? <Check size={17} /> : Icon && <Icon size={17} />}
      {armed && !disabled ? confirmLabel : label}
    </button>
  );
}

/**
 * Runs an async action (a save, a delete) with a busy flag and the server's plain-language error shown as a toast.
 * `run` resolves to true when it worked, so a form can close itself.
 */
export function useAction() {
  const toast = useHeadUnit((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (okMessage) toast(okMessage);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'That did not work.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

/** Distance kept above a field that is scrolled into view, so its label stays visible. */
const FIELD_MARGIN = 72;

/** Where to scroll a sheet body so a focused field sits near its top (clear of the on-screen keyboard). `k`: layout px per screen px. */
export function fieldScrollTop(opts: { scrollTop: number; bodyTop: number; fieldTop: number; k?: number }): number {
  const { scrollTop, bodyTop, fieldTop, k = 1 } = opts;
  return Math.max(0, Math.round(scrollTop + (fieldTop - bodyTop) * k - FIELD_MARGIN));
}

function revealField(e: FocusEvent<HTMLDivElement>) {
  const field = e.target;
  const body = e.currentTarget;
  if (!(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
  window.setTimeout(() => {
    const b = body.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    const k = b.height > 0 ? body.clientHeight / b.height : 1;
    body.scrollTo?.({ top: fieldScrollTop({ scrollTop: body.scrollTop, bodyTop: b.top, fieldTop: f.top, k }), behavior: 'smooth' });
  }, 120);
}

/** Modal sheet: tap the backdrop or ✕ to dismiss. The header stays put; the body scrolls and lifts a focused field above the keyboard. */
export function Sheet({ title, onClose, children, footer, wide }: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="sheet-scrim" onClick={onClose} data-no-swipe data-no-edge-back>
      <div className={cx('sheet', wide && 'wide')} role="dialog" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="sheet-body" onFocusCapture={revealField}>
          {children}
        </div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Wraps anything that needs the keyboard. While the car is moving it shows a lock instead (a passenger can lift it). */
export function DrivingGate({ children, what = 'Typing' }: { children: ReactNode; what?: string }) {
  const locked = useTypingLocked();
  const setPassenger = useHeadUnit((s) => s.setPassenger);
  if (!locked) return <>{children}</>;
  return (
    <Banner tone="warn" icon={Lock} action={<button type="button" className="btn small" onClick={() => setPassenger(true)}>I’m a passenger</button>}>
      <b>{what} is locked while driving.</b> Pull over to use it.
    </Banner>
  );
}

export function TextField({ label, value, onChange, placeholder, maxLength, icon: Icon, type = 'text', className, onEnter, autoFocus }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; icon?: LucideIcon; type?: string; className?: string; onEnter?: () => void; autoFocus?: boolean }) {
  return (
    <div className={className}>
      {label && <label className="lbl">{label}</label>}
      <div className="field">
        {Icon && <Icon />}
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={label ?? placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      </div>
    </div>
  );
}

/**
 * A number typed on the on-screen keyboard. It keeps what is being typed as text (so "3." and "" are allowed mid-entry) and reports
 * a number, or null while the box is empty or not a number.
 */
export function NumberField({ label, value, onChange, unit, placeholder, className }: { label: string; value: number | null; onChange: (v: number | null) => void; unit?: string; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);
  if (value !== last.current && Number(text) !== value) {
    last.current = value;
    setText(value === null ? '' : String(value));
  }
  return (
    <div className={className}>
      <label className="lbl">
        {label}
        {unit && <span> ({unit})</span>}
      </label>
      <div className="field">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            const raw = e.target.value.trim().replace(',', '.');
            const n = raw === '' ? null : Number(raw);
            last.current = n !== null && Number.isFinite(n) ? n : null;
            onChange(last.current);
          }}
        />
      </div>
    </div>
  );
}

/**
 * A date picked with big buttons, no keyboard and no browser calendar: day, month and year each step up and down (hold to repeat),
 * with "Today" and one-tap jumps for things that renew in whole months or years.
 */
export function DateField({ label, value, onChange, jumps = [] }: { label: string; value: string; onChange: (iso: string) => void; jumps?: Array<{ label: string; months: number }> }) {
  const p = parseIso(value) ?? parseIso(todayIso())!;
  return (
    <div role="group" aria-label={label} className="col" style={{ gap: 8 }}>
      <label className="lbl" style={{ margin: 0 }}>{label}</label>
      <div className="row wrap" style={{ gap: 8 }}>
        <Stepper label={`${label} day`} value={p.d} min={1} max={daysInMonth(p.y, p.m)} onChange={(d) => onChange(withPart(value, 'd', d))} />
        <Stepper label={`${label} month`} value={p.m} min={1} max={12} format={(m) => MONTHS_SHORT[m - 1]} onChange={(m) => onChange(withPart(value, 'm', m))} />
        <Stepper label={`${label} year`} value={p.y} min={1990} max={2100} onChange={(y) => onChange(withPart(value, 'y', y))} />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="dim" style={{ fontSize: '0.88rem', minWidth: 110 }}>{formatDate(value)}</span>
        <button type="button" className="chip" onClick={() => onChange(todayIso())}>
          Today
        </button>
        {jumps.map((j) => (
          <button key={j.label} type="button" className="chip" onClick={() => onChange(addMonthsIso(value, j.months))}>
            {j.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="section-title">{children}</div>;
}
