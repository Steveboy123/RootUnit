import { Component, type ReactNode } from 'react';

interface Props {
  /** What to draw instead, or a function of the error and a way to try the children again. */
  fallback: ReactNode | ((error: unknown, retry: () => void) => ReactNode);
  /** Called once when something below throws (for example to close a panel that cannot open). */
  onError?: (error: unknown) => void;
  children?: ReactNode;
}
interface State {
  failed: boolean;
  error: unknown;
}

/**
 * A real error boundary. A screen that cannot be drawn (a code chunk that failed to load after an update, data an older server did not
 * send) must not take the whole kiosk to a blank page: the part that failed is replaced, and the rest keeps working.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[ui] a part of the screen failed to draw:', error);
    this.props.onError?.(error);
  }

  retry = (): void => this.setState({ failed: false, error: null });

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(this.state.error, this.retry) : fallback;
  }
}

/** Shown when the whole interface fails: say so plainly, and offer the one thing that usually fixes it. */
export function CrashScreen() {
  return (
    <div className="app splash" role="alert">
      <div className="crash">
        <b>Something went wrong</b>
        <span>The head unit hit a problem it could not recover from. Reloading usually fixes it.</span>
        <button type="button" className="btn primary big" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
