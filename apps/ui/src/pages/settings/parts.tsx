import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** One card of settings with a heading and an optional line under it. */
export function SetSection({ title, icon: Icon, blurb, children, aside }: { title: string; icon?: LucideIcon; blurb?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card set-section">
      <header className="set-head">
        <h3>
          {Icon && <Icon />}
          {title}
        </h3>
        {aside}
      </header>
      {blurb && <p className="set-blurb">{blurb}</p>}
      {children}
    </section>
  );
}

/** A labelled line: the words on the left, the control on the right (below it on a narrow screen). */
export function Field({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className="set-field" data-stack={stack || undefined}>
      <span className="set-label">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <span className="set-control">{children}</span>
    </div>
  );
}

export interface TileOption<T extends string> {
  value: T;
  label: string;
  blurb?: string;
  /** Drawn above the name: a picture of the choice. */
  preview?: ReactNode;
  /** Attributes and variables for the preview box (a palette, a surface…), so it shows the real thing. */
  previewStyle?: CSSProperties;
  previewAttrs?: Record<string, string>;
}

/** A grid of choices with pictures. A radio group: one is chosen, the arrow keys move along it. */
export function Tiles<T extends string>({ label, value, options, onChange, size = 'md' }: { label: string; value: T; options: ReadonlyArray<TileOption<T>>; onChange(v: T): void; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className="set-tiles stagger" role="radiogroup" aria-label={label} data-size={size}>
      {options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="set-tile" data-active={o.value === value} style={{ ['--i' as string]: i }} onClick={() => onChange(o.value)}>
          {o.preview !== undefined && (
            <span className="set-tile-pic" style={o.previewStyle} {...o.previewAttrs}>
              {o.preview}
            </span>
          )}
          <b>{o.label}</b>
          {o.blurb && <small>{o.blurb}</small>}
        </button>
      ))}
    </div>
  );
}

/** Round colour buttons. */
export function Swatches({ label, value, colours, onChange }: { label: string; value: string; colours: readonly string[]; onChange(c: string): void }) {
  return (
    <div className="swatch-row" role="radiogroup" aria-label={label}>
      {colours.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c.toLowerCase()} aria-label={c} className="swatch-btn" data-active={value.toLowerCase() === c.toLowerCase()} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}
