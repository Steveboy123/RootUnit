import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Delete, Keyboard, CornerDownLeft } from 'lucide-react';

const kiosk = new URLSearchParams(location.search).has('kiosk');

type Editable = HTMLInputElement | HTMLTextAreaElement;

type KeyDef =
  | { kind: 'text'; value: string; label?: string; wide?: boolean }
  | { kind: 'action'; action: 'shift' | 'backspace' | 'mode' | 'enter' | 'hide'; label?: string; wide?: boolean };

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'password', 'email', 'url', 'tel', 'number']);

function editableFrom(target: EventTarget | null): Editable | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) return target;
  return null;
}

function setNativeValue(el: Editable, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function selection(el: Editable): [number, number] {
  try {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    return [start, end];
  } catch {
    return [el.value.length, el.value.length];
  }
}

function selectAt(el: Editable, pos: number) {
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    // Some HTML input types (notably email/number) do not expose selection ranges.
  }
}

function replaceSelection(el: Editable, text: string) {
  const [start, end] = selection(el);
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setNativeValue(el, next);
  selectAt(el, start + text.length);
}

function backspace(el: Editable) {
  let [start, end] = selection(el);
  if (start === end && start > 0) {
    // Delete one Unicode code point rather than half of a surrogate pair.
    const before = Array.from(el.value.slice(0, start));
    const removed = before.pop() ?? '';
    start -= removed.length;
  }
  if (start === end) return;
  const next = el.value.slice(0, start) + el.value.slice(end);
  setNativeValue(el, next);
  selectAt(el, start);
}

function fireEnter(el: Editable) {
  if (el instanceof HTMLTextAreaElement) {
    replaceSelection(el, '\n');
    return;
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  const form = el.form;
  if (form) form.requestSubmit?.();
}

const letters = (shift: boolean): KeyDef[][] => {
  const row = (s: string) => Array.from(s).map((value) => ({ kind: 'text', value: shift ? value.toUpperCase() : value } as const));
  return [
    row('qwertyuiop'),
    row('asdfghjkl'),
    [
      { kind: 'action', action: 'shift', wide: true },
      ...row('zxcvbnm'),
      { kind: 'action', action: 'backspace', wide: true },
    ],
    [
      { kind: 'action', action: 'mode', label: '123', wide: true },
      { kind: 'text', value: '@' },
      { kind: 'text', value: ' ', label: 'space', wide: true },
      { kind: 'text', value: '.' },
      { kind: 'text', value: '-' },
      { kind: 'action', action: 'enter', wide: true },
      { kind: 'action', action: 'hide', wide: true },
    ],
  ];
};

const symbols: KeyDef[][] = [
  Array.from('1234567890').map((value) => ({ kind: 'text', value } as const)),
  Array.from('@#$%&-+()').map((value) => ({ kind: 'text', value } as const)),
  [
    { kind: 'text', value: '*' },
    { kind: 'text', value: '/' },
    { kind: 'text', value: ':' },
    { kind: 'text', value: ';' },
    { kind: 'text', value: '!' },
    { kind: 'text', value: '?' },
    { kind: 'text', value: "'" },
    { kind: 'text', value: '"' },
    { kind: 'text', value: '_' },
    { kind: 'action', action: 'backspace', wide: true },
  ],
  [
    { kind: 'action', action: 'mode', label: 'ABC', wide: true },
    { kind: 'text', value: ',' },
    { kind: 'text', value: ' ', label: 'space', wide: true },
    { kind: 'text', value: '.' },
    { kind: 'text', value: '=' },
    { kind: 'action', action: 'enter', wide: true },
    { kind: 'action', action: 'hide', wide: true },
  ],
];

/**
 * In-app keyboard for the Raspberry Pi kiosk. Keeping it in the UI avoids the
 * Wayland/fullscreen layering problems that external desktop keyboards can have.
 */
export function TouchKeyboard() {
  const [visible, setVisible] = useState(false);
  const [shift, setShift] = useState(false);
  const [symbolMode, setSymbolMode] = useState(false);
  const target = useRef<Editable | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!kiosk) return;

    const showFor = (el: Editable) => {
      target.current = el;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setVisible(true);
      // Once the keyboard has taken space at the bottom, keep the focused field visible.
      window.setTimeout(() => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }), 80);
    };

    const onFocusIn = (event: FocusEvent) => {
      const el = editableFrom(event.target);
      if (el) showFor(el);
    };
    const onFocusOut = () => {
      hideTimer.current = window.setTimeout(() => {
        const next = editableFrom(document.activeElement);
        if (next) showFor(next);
        else {
          target.current = null;
          setVisible(false);
          setShift(false);
        }
      }, 160);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!kiosk) return;
    document.documentElement.classList.toggle('osk-open', visible);
    return () => document.documentElement.classList.remove('osk-open');
  }, [visible]);

  if (!kiosk || !visible) return null;

  const rows = symbolMode ? symbols : letters(shift);

  const press = (key: KeyDef) => {
    const el = target.current ?? editableFrom(document.activeElement);
    if (key.kind === 'action') {
      if (key.action === 'hide') {
        el?.blur();
        setVisible(false);
        setShift(false);
        return;
      }
      if (key.action === 'shift') return void setShift((v) => !v);
      if (key.action === 'mode') {
        setSymbolMode((v) => !v);
        setShift(false);
        return;
      }
      if (!el) return;
      if (key.action === 'backspace') backspace(el);
      if (key.action === 'enter') fireEnter(el);
      return;
    }
    if (!el) return;
    replaceSelection(el, key.value);
    if (shift && /[A-Z]/.test(key.value)) setShift(false);
  };

  return (
    <div className="touch-keyboard" role="application" aria-label="Touch keyboard" onPointerDown={(e) => e.preventDefault()}>
      {rows.map((row, rowIndex) => (
        <div className="touch-keyboard-row" key={rowIndex}>
          {row.map((key, keyIndex) => {
            let content: ReactNode;
            if (key.kind === 'text') content = key.label ?? (key.value === ' ' ? 'space' : key.value);
            else if (key.action === 'shift') content = <span aria-hidden="true">⇧</span>;
            else if (key.action === 'backspace') content = <Delete size={23} />;
            else if (key.action === 'enter') content = <CornerDownLeft size={23} />;
            else if (key.action === 'hide') content = <Keyboard size={23} />;
            else content = key.label;
            return (
              <button
                type="button"
                className="touch-key"
                data-wide={key.wide ? 'true' : undefined}
                data-active={key.kind === 'action' && key.action === 'shift' && shift ? 'true' : undefined}
                key={keyIndex}
                onPointerDown={(e) => {
                  e.preventDefault();
                  press(key);
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
