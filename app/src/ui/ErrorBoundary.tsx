/*
 * Seek — the wall between one crashing view and a white window.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A class component because it has to be: error boundaries are the one React
 * feature with no hook equivalent — getDerivedStateFromError and
 * componentDidCatch exist only on classes.
 *
 * The diagnostics text is built HERE, from what is already in memory, and
 * deliberately not with domain/bugReport.ts: buildReport() rounds-trips the
 * engine for OS details and a log tail, and this component exists precisely
 * for the moments when the engine — or the render path that talks to it — is
 * the thing that just failed. A crash report that needs the crashed system's
 * help is not a crash report.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copyText } from '../data/clipboard.ts';
import { sidecarDiagnostics } from '../data/sidecarClient.ts';

interface Props {
  /** Where in the app this boundary sits — leads the diagnostics text. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  copied: boolean | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack exists only here; it is not on the Error. Log it or
    // lose it.
    console.error('[seek] crash in', this.props.label, error, info.componentStack);
  }

  private diagnosticsText(): string {
    const { error } = this.state;
    const diag = sidecarDiagnostics();
    return [
      `Seek ${__APP_VERSION__} — crash in ${this.props.label}`,
      error ? `${error.name}: ${error.message}` : '',
      error?.stack ?? '',
      `engine ${diag.sidecarVersion || '?'} · core ${diag.coreVersion || '?'}`,
    ].filter(Boolean).join('\n');
  }

  private copy = () => {
    void copyText(this.diagnosticsText()).then((ok) => this.setState({ copied: ok }));
  };

  /* Clearing the error remounts the children from scratch — while the
   * fallback shows they are unmounted, so no crashed state survives into the
   * retry. */
  private reset = () => this.setState({ error: null, copied: null });

  render() {
    const { error, copied } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="empty empty--section" role="alert">
        <div className="empty__title">This view crashed</div>
        <div className="empty__body">
          <code>{error.message || error.name}</code>
        </div>
        <div className="empty__body">
          The rest of Seek is still running. Try again re-opens the view from
          scratch; if it crashes the same way, copy the diagnostics into a bug
          report.
        </div>
        <div className="crash__actions">
          <button type="button" className="btn btn--primary pressable" onClick={this.reset}>
            Try again
          </button>
          <button type="button" className="btn pressable" onClick={this.copy}>
            {copied === null ? 'Copy diagnostics' : copied ? 'Copied' : 'Copy failed — see console'}
          </button>
        </div>
      </div>
    );
  }
}
