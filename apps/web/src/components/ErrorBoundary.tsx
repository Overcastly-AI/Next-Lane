import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error anywhere below this boundary shows a
 * recoverable screen instead of a blank white page.
 *
 * Mounted ABOVE every provider (router, auth, query) so it keeps working when
 * one of them is what threw — which is why the recovery actions use plain
 * `window.location` rather than router hooks.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in the console for bug reports; no remote reporting by design
    // (self-hosted, your data stays yours).
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className="flex min-h-screen items-center justify-center bg-ink-50 px-4"
      >
        <div className="w-full max-w-md text-center">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">
            Something went off the rails
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Next Lane hit an unexpected error while drawing this screen. Your data is safe —
            reloading usually clears it.
          </p>
          <details className="mt-5 rounded-lg border border-ink-200 bg-surface p-3 text-left">
            <summary className="cursor-pointer text-xs font-semibold text-ink-600">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink-600">
              {error.message || String(error)}
            </pre>
          </details>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={() => window.location.reload()} data-testid="error-reload">
              Reload page
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.assign('/')}
              data-testid="error-home"
            >
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
