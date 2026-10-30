import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrashScreen, ErrorBoundary } from './ErrorBoundary';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('ErrorBoundary', () => {
  it('draws its children while nothing is wrong', () => {
    expect(renderToStaticMarkup(<ErrorBoundary fallback={<i>broken</i>}>fine</ErrorBoundary>)).toBe('fine');
  });

  it('turns a throw below it into a failed state carrying the error', () => {
    const boom = new Error('chunk failed');
    expect(ErrorBoundary.getDerivedStateFromError(boom)).toEqual({ failed: true, error: boom });
  });

  it('draws the fallback once failed, and a function fallback gets the error and a retry', () => {
    const boom = new Error('x');
    const plain = new ErrorBoundary({ fallback: <b>sorry</b> });
    plain.state = { failed: true, error: boom };
    expect(renderToStaticMarkup(<>{plain.render()}</>)).toBe('<b>sorry</b>');

    const seen: unknown[] = [];
    const fn = new ErrorBoundary({ fallback: (error, retry) => (seen.push(error, typeof retry), <u>{String((error as Error).message)}</u>) });
    fn.state = { failed: true, error: boom };
    expect(renderToStaticMarkup(<>{fn.render()}</>)).toBe('<u>x</u>');
    expect(seen).toEqual([boom, 'function']);
  });

  it('reports the error once and logs it', () => {
    const onError = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('x');
    new ErrorBoundary({ fallback: null, onError }).componentDidCatch(boom);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('retry clears the failure so the children are tried again', () => {
    const b = new ErrorBoundary({ fallback: 'sorry', children: 'back' });
    let state: unknown = { failed: true, error: new Error('x') };
    b.setState = ((s: unknown) => void (state = s)) as never;
    b.retry();
    expect(state).toEqual({ failed: false, error: null });
  });
});

describe('CrashScreen', () => {
  it('says what happened in plain words and offers a Reload button', () => {
    const html = renderToStaticMarkup(<CrashScreen />);
    expect(text(html)).toContain('Something went wrong');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*>\s*Reload\s*<\/button>/);
  });
});
