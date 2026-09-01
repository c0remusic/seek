/*
 * Seek — the one connection to the engine, held apart from any one search.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * WHY THIS IS SEPARATE. `useSearchSession` used to own both the socket and the
 * search, which was right while there was exactly one of each. Search tabs make
 * that a problem in the most literal way: a hook that opens a socket, called
 * once per tab, opens a socket per tab — five tabs, five sign-ins, five copies
 * of every event.
 *
 * So the connection is a singleton and the search is what multiplies. Nothing
 * about the socket belongs to a query.
 *
 * ONE SEARCH AT A TIME, and that is the transport's rule rather than a choice
 * made here: `sidecar.start()` replaces the previous search's handlers, because
 * the client models a single running search. Tabs work with that rather than
 * against it — a tab that is not the one you last searched from keeps whatever
 * it collected, and the tab that IS running keeps ingesting while you read
 * another. Only starting a NEW search stops the old one, which is exactly what
 * the single search field did before tabs existed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMockSidecar } from './mockSidecar.ts';
import {
  createSidecarClient, isTauri, requestSidecarRestart, requestTauriEndpoint,
  resolveSidecarEndpoint, sameEndpoint, sidecarStartupError,
} from './sidecarClient.ts';
import type { ConnectionPhase, SidecarClient, SidecarEndpoint } from './sidecarClient.ts';
import type { Sidecar } from './mockSidecar.ts';

export interface SidecarConnection {
  /** Socket state. 'closed' with a null client means deliberate offline/mock. */
  phase: ConnectionPhase;
  /** True when replaying the fixture rather than talking to a real sidecar. */
  isMock: boolean;
  /** Soulseek login state, distinct from the socket. Null until reported. */
  serverState: string | null;
  /** The live client, for everything that is not a search. Null in mock mode. */
  client: SidecarClient | null;
  /** Whichever of the two can run a search — real or fixture replay. */
  sidecar: Sidecar;
  /** Why the Tauri shell could not start a sidecar, if it could not. */
  startupError: string | null;
  /**
   * The engine's exit, when the shell's watchdog saw one die: a code, or null
   * for a death with no code (killed). `undefined` = alive as far as we know.
   * Cleared when a replacement announces itself through `sidecar-ready`.
   */
  engineExit: number | null | undefined;
  /** Ask the shell to kill and relaunch the engine. No-op outside Tauri. */
  restart(): void;
}

export function useSidecarConnection(): SidecarConnection {
  /* A real sidecar if one is advertised, the fixture replay otherwise. Both
   * satisfy the same interface and emit the same wire frames, so nothing above
   * this line knows which it is talking to.
   *
   * URL parameters resolve synchronously; the Tauri shell has to be asked over
   * IPC, so the endpoint can arrive a tick after mount. Nothing auto-searches on
   * mount, so briefly holding a mock that is never started costs nothing. */
  const [endpoint, setEndpoint] = useState(() => resolveSidecarEndpoint());
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    if (endpoint || !isTauri()) return;
    let cancelled = false;
    void (async () => {
      const found = await requestTauriEndpoint();
      if (cancelled) return;
      if (found) setEndpoint(found);
      else setStartupError(await sidecarStartupError());
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  const [engineExit, setEngineExit] = useState<number | null | undefined>(undefined);

  /* The shell's two lifecycle events. `sidecar-died` is the watchdog seeing
   * the engine exit; `sidecar-ready` is a replacement (automatic or manual)
   * announcing its NEW endpoint — every restart mints a new port and token.
   * Swapping the endpoint swaps the client through the memo below, and every
   * store re-runs its snapshot effect on the new client's identity. */
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const offs: Array<() => void> = [];
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const offReady = await listen<SidecarEndpoint>('sidecar-ready', (e) => {
        setEngineExit(undefined);
        setStartupError(null);
        // The setup-time emit and a restart both land here; only a CHANGED
        // endpoint may swap the client, or the startup event would tear down
        // the very connection it announced.
        setEndpoint((cur) => (cur && sameEndpoint(cur, e.payload) ? cur : e.payload));
      });
      const offDied = await listen<number | null>('sidecar-died', (e) => {
        setEngineExit(e.payload);
      });
      if (cancelled) { offReady(); offDied(); } else { offs.push(offReady, offDied); }
    })();
    return () => { cancelled = true; for (const off of offs) off(); };
  }, []);

  const restart = useCallback(() => {
    void requestSidecarRestart().then((problem) => {
      if (problem) setStartupError(problem);
    });
  }, []);

  const [client, sidecar] = useMemo(() => {
    if (!endpoint) return [null, createMockSidecar()] as const;
    const real = createSidecarClient(endpoint);
    return [real, real] as const;
  }, [endpoint]);

  const [phase, setPhase] = useState<ConnectionPhase>(client ? 'connecting' : 'closed');
  const [serverState, setServerState] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const offPhase = client.onPhase(setPhase);
    // The socket being open says nothing about whether we are logged in to
    // Soulseek — that is a separate state, and searching before it is ready
    // returns `not_connected`. Track it so the UI can be honest.
    const offState = client.on('connection.state', (data) => {
      // The field is `status`, not `state` — see ConnectionState in the schema.
      // Reading the wrong key here silently pinned this to null, which made the
      // app report "Not signed in" forever even after a successful login.
      const d = data as { status?: string };
      setServerState(d.status ?? null);
    });
    return () => {
      offPhase();
      offState();
    };
  }, [client]);

  // Open on mount, close on unmount. `open()` revives a closed client so
  // StrictMode's mount/unmount/mount cycle reconnects instead of latching shut.
  useEffect(() => {
    if (!client) return;
    client.open();
    return () => client.close();
  }, [client]);

  return useMemo(
    () => ({
      phase, isMock: client === null, serverState, client, sidecar,
      startupError, engineExit, restart,
    }),
    [phase, client, serverState, sidecar, startupError, engineExit, restart],
  );
}
