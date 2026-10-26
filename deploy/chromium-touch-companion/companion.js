(() => {
  'use strict';

  if (window.__RPI_HEADUNIT_TOUCH_COMPANION__) return;
  window.__RPI_HEADUNIT_TOUCH_COMPANION__ = true;

  const isHeadUnit = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && location.port === '8787';
  if (isHeadUnit) return; // The native React UI already has its own keyboard + Back gesture.

  const isTop = window.top === window;
  const EDITABLE_TYPES = new Set(['', 'text', 'search', 'password', 'email', 'url', 'tel', 'number']);
  let target = null;
  let shift = false;
  let symbols = false;
  let backFallback = 0;

  const host = document.createElement('div');
  host.id = 'rpi-headunit-touch-companion';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .keyboard {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
      display: none; flex-direction: column; gap: 5px; padding: 8px 10px 10px;
      background: rgba(8,12,20,.98); border-top: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 -10px 30px rgba(0,0,0,.36); font-family: system-ui,-apple-system,sans-serif;
      pointer-events: auto; user-select: none; -webkit-user-select: none; touch-action: none;
    }
    .keyboard.show { display: flex; }
    .row { display: flex; gap: 5px; min-width: 0; }
    .key {
      min-width: 0; flex: 1 1 0; height: 52px; border: 1px solid rgba(255,255,255,.13);
      border-radius: 11px; background: #202a38; color: #fff; font: 600 18px/1 system-ui,-apple-system,sans-serif;
      display: grid; place-items: center; padding: 0 8px; -webkit-tap-highlight-color: transparent;
    }
    .key:active, .key.active { background: #3b4a5f; }
    .key.wide { flex: 1.45 1 0; font-size: 15px; }
    .key.space { flex: 3.7 1 0; font-size: 14px; color: #d8e0ea; }
    .key.primary { background: #2f69d9; border-color: #4c81ea; }
    .back {
      position: fixed; left: 8px; top: 10px; z-index: 2147483647; width: 48px; height: 48px;
      border: 1px solid rgba(255,255,255,.22); border-radius: 16px; background: rgba(7,11,18,.88);
      color: white; font: 700 29px/1 system-ui,-apple-system,sans-serif; display: grid; place-items: center;
      pointer-events: auto; -webkit-tap-highlight-color: transparent; box-shadow: 0 4px 16px rgba(0,0,0,.28);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    }
    .back:active { transform: scale(.96); background: rgba(31,45,66,.96); }
    .hint {
      position: fixed; left: 0; top: 22%; width: 8px; height: 76px; border-radius: 0 8px 8px 0;
      background: rgba(255,255,255,.22); pointer-events: none;
    }
    @media (max-height: 560px) {
      .keyboard { gap: 3px; padding: 5px 7px 7px; }
      .row { gap: 3px; }
      .key { height: 44px; border-radius: 9px; font-size: 16px; }
    }
  `;
  root.appendChild(style);

  const keyboard = document.createElement('div');
  keyboard.className = 'keyboard';
  keyboard.setAttribute('role', 'application');
  keyboard.setAttribute('aria-label', 'Touch keyboard');
  root.appendChild(keyboard);

  if (isTop) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back';
    back.setAttribute('aria-label', 'Back');
    back.textContent = '‹';
    back.addEventListener('pointerdown', (event) => event.preventDefault());
    back.addEventListener('click', () => goBack());
    root.appendChild(back);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.setAttribute('aria-hidden', 'true');
    root.appendChild(hint);
  }

  (document.documentElement || document.body).appendChild(host);

  function editableFrom(node) {
    if (!(node instanceof Element)) return null;
    const input = node.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (!input) return null;
    if (input instanceof HTMLInputElement && !EDITABLE_TYPES.has((input.type || '').toLowerCase())) return null;
    if (input instanceof HTMLInputElement && (input.disabled || input.readOnly)) return null;
    if (input instanceof HTMLTextAreaElement && (input.disabled || input.readOnly)) return null;
    return input;
  }

  function activeEditable() {
    return target && target.isConnected ? target : editableFrom(document.activeElement);
  }

  function inputSetter(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selection(el) {
    try {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      return [start, end];
    } catch {
      return [el.value.length, el.value.length];
    }
  }

  function selectAt(el, pos) {
    try { el.setSelectionRange(pos, pos); } catch { /* unsupported input type */ }
  }

  function insertText(text) {
    const el = activeEditable();
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const [start, end] = selection(el);
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      inputSetter(el, next);
      selectAt(el, start + text.length);
      return;
    }
    try {
      document.execCommand('insertText', false, text);
    } catch { /* keep keyboard usable even when a site rejects contenteditable editing */ }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function erase() {
    const el = activeEditable();
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      let [start, end] = selection(el);
      if (start === end && start > 0) {
        const before = Array.from(el.value.slice(0, start));
        const removed = before.pop() || '';
        start -= removed.length;
      }
      if (start === end) return;
      const next = el.value.slice(0, start) + el.value.slice(end);
      inputSetter(el, next);
      selectAt(el, start);
      return;
    }
    try { document.execCommand('delete', false); } catch { /* ignored */ }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  }

  function enter() {
    const el = activeEditable();
    if (!el) return;
    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) {
      insertText('\n');
      return;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    const form = el instanceof HTMLInputElement ? el.form : el.closest?.('form');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  const letterRows = () => [
    'qwertyuiop'.split(''),
    'asdfghjkl'.split(''),
    ['SHIFT', ...'zxcvbnm'.split(''), 'BACK'],
    ['123', '@', 'SPACE', '.', '-', 'ENTER', 'HIDE'],
  ];
  const symbolRows = () => [
    '1234567890'.split(''),
    '@#$%&-+()'.split(''),
    ['*', '/', ':', ';', '!', '?', "'", '"', '_', 'BACK'],
    ['ABC', ',', 'SPACE', '.', '=', 'ENTER', 'HIDE'],
  ];

  function renderKeyboard() {
    keyboard.textContent = '';
    const rows = symbols ? symbolRows() : letterRows();
    for (const values of rows) {
      const row = document.createElement('div');
      row.className = 'row';
      for (const raw of values) {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'key';
        let label = raw;
        if (raw === 'SHIFT') { label = '⇧'; key.classList.add('wide'); if (shift) key.classList.add('active'); }
        else if (raw === 'BACK') { label = '⌫'; key.classList.add('wide'); }
        else if (raw === 'SPACE') { label = 'space'; key.classList.add('space'); }
        else if (raw === 'ENTER') { label = '↵'; key.classList.add('wide', 'primary'); }
        else if (raw === 'HIDE') { label = '⌨'; key.classList.add('wide'); }
        else if (raw === '123' || raw === 'ABC') key.classList.add('wide');
        else if (!symbols && /^[a-z]$/.test(raw)) label = shift ? raw.toUpperCase() : raw;
        key.textContent = label;
        key.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        key.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (raw === 'SHIFT') { shift = !shift; renderKeyboard(); return; }
          if (raw === 'BACK') { erase(); return; }
          if (raw === '123' || raw === 'ABC') { symbols = !symbols; shift = false; renderKeyboard(); return; }
          if (raw === 'SPACE') { insertText(' '); return; }
          if (raw === 'ENTER') { enter(); return; }
          if (raw === 'HIDE') { hideKeyboard(true); return; }
          insertText(!symbols && shift && /^[a-z]$/.test(raw) ? raw.toUpperCase() : raw);
          if (shift && /^[a-z]$/.test(raw)) { shift = false; renderKeyboard(); }
        });
        row.appendChild(key);
      }
      keyboard.appendChild(row);
    }
  }

  function showKeyboard(el) {
    target = el;
    renderKeyboard();
    keyboard.classList.add('show');
    window.setTimeout(() => {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch { /* ignored */ }
    }, 80);
  }

  function hideKeyboard(blur) {
    if (blur && target && target.isConnected) target.blur();
    target = null;
    shift = false;
    keyboard.classList.remove('show');
  }

  document.addEventListener('focusin', (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const el = path.map(editableFrom).find(Boolean) || editableFrom(event.target);
    if (el) showKeyboard(el);
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (keyboard.contains?.(event.target)) return;
    const el = editableFrom(event.target);
    if (el) showKeyboard(el);
  }, true);

  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      const next = editableFrom(document.activeElement);
      if (next) showKeyboard(next);
      else if (!keyboard.matches(':hover')) hideKeyboard(false);
    }, 160);
  }, true);

  function goBack() {
    if (backFallback) window.clearTimeout(backFallback);
    const here = location.href;
    try { history.back(); } catch { /* ignored */ }
    backFallback = window.setTimeout(() => {
      if (location.href === here) location.href = 'http://127.0.0.1:8787/?kiosk=1';
    }, 650);
  }

  if (isTop) {
    let swipe = null;
    let suppressClickUntil = 0;
    window.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.clientX > 34) return;
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY };
    }, true);
    window.addEventListener('pointermove', (event) => {
      if (!swipe || event.pointerId !== swipe.id) return;
      swipe.lastX = event.clientX;
      swipe.lastY = event.clientY;
      const dx = event.clientX - swipe.x;
      const dy = Math.abs(event.clientY - swipe.y);
      if (dx > 18 && dx > dy * 1.25) event.preventDefault();
    }, { capture: true, passive: false });
    window.addEventListener('pointerup', (event) => {
      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = Math.abs(event.clientY - swipe.y);
      swipe = null;
      if (dx >= 86 && dx > dy * 1.35) {
        suppressClickUntil = Date.now() + 450;
        goBack();
      }
    }, true);
    window.addEventListener('pointercancel', () => { swipe = null; }, true);
    window.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }
})();
