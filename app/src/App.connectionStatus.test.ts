// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The status branches decide a sentence a person reads and a button they can
 * press. Pinned because the crashed/unreachable distinction — and the offer
 * to restart — is the difference between a recoverable app and one that just
 * says it is broken.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { connectionStatus } from './App.tsx';
import { sameEndpoint } from './data/sidecarClient.ts';
import type { SearchSession } from './data/searchStore.ts';

function session(over: Partial<SearchSession>): SearchSession {
  return { isMock: false, phase: 'open', serverState: 'online', ...over } as SearchSession;
}

describe('connectionStatus', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('mock mode stays mock — no restart offer for an engine that never was', () => {
    const s = connectionStatus(session({ isMock: true }), { exit: null, restart() {} });
    expect(s.label).toContain('mock');
    expect(s.action).toBeUndefined();
  });

  it('a crash outranks "unreachable" and offers a restart under Tauri', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const s = connectionStatus(
      session({ phase: 'closed' }),
      { exit: 9, restart() {} },
    );
    expect(s.label).toBe('Engine crashed');
    expect(s.detail).toContain('code 9');
    expect(s.action?.label).toBe('Restart engine');
  });

  it('unreachable offers a restart under Tauri, and none in a browser tab', () => {
    const inBrowser = connectionStatus(
      session({ phase: 'closed' }),
      { exit: undefined, restart() {} },
    );
    expect(inBrowser.label).toBe('Sidecar unreachable');
    expect(inBrowser.action).toBeUndefined();

    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const inShell = connectionStatus(
      session({ phase: 'closed' }),
      { exit: undefined, restart() {} },
    );
    expect(inShell.action?.label).toBe('Restart engine');
  });
});

describe('sameEndpoint', () => {
  it('any of host, port and token differing means a different sidecar', () => {
    const a = { host: 'h', port: 1, token: 't' };
    expect(sameEndpoint(a, { ...a })).toBe(true);
    expect(sameEndpoint(a, { ...a, port: 2 })).toBe(false);
    expect(sameEndpoint(a, { ...a, token: 'x' })).toBe(false);
    expect(sameEndpoint(a, { ...a, host: 'i' })).toBe(false);
  });
});
