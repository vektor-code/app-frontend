import React from 'react';

type Props = {
  children: React.ReactNode;
  /** Label shown on the recovery button, e.g. "Reload Admin". */
  label?: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches lazy-route chunk failures (Safari: "Importing a module script failed")
 * that happen during rolling deploys when index.html and /assets hashes briefly diverge.
 * One hard reload usually picks up the new bundle set.
 */
export default class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[RouteErrorBoundary]', error);
  }

  private reload = () => {
    // Drop any service-worker / bfcache confusion and re-fetch index.html.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'Something went wrong loading this page.';
    const isChunk = /loading chunk|dynamically imported module|importing a module script failed|failed to fetch/i.test(message);

    return (
      <div className="route-error-boundary" role="alert">
        <h2>{isChunk ? 'This page needs a refresh' : 'Something went wrong'}</h2>
        <p>
          {isChunk
            ? 'A newer build was deployed while this tab was open. Reload to load matching assets.'
            : message}
        </p>
        <button type="button" className="btn btn-primary" onClick={this.reload}>
          {this.props.label || 'Reload'}
        </button>
      </div>
    );
  }
}
