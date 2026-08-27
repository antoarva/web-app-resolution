import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { Button } from '@/components/ui/primitives';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary, e.g. when the user switches view. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render and lazy-import failures.
 *
 * Without this, a view chunk that fails to load throws through Suspense and
 * React unmounts the whole tree — the app goes blank with nothing on screen
 * explaining why. That is exactly the failure mode a stale offline cache
 * produces, so it needs to be visible rather than silent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Envelop: view failed to render', error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reload = (): void => {
    // A failed chunk usually means the cached build no longer matches the
    // page. Clearing the caches and reloading pulls a consistent set.
    void (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        const registrations = await navigator.serviceWorker?.getRegistrations() ?? [];
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch {
        /* clearing is best effort */
      }
      window.location.reload();
    })();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-destructive/15">
            <Icons.AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          </div>
          <h2 className="mt-3 text-sm font-semibold">This view failed to load</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error.message || 'An unexpected error occurred while rendering.'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            If this happened after an update, the offline cache may be holding an older
            build. Refreshing it usually resolves the problem.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" size="sm" onClick={this.reload}>
              <Icons.RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh the app
            </Button>
            <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
