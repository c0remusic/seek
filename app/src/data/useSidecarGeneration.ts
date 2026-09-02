/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * A separate file so sidecarClient.ts stays React-free — it is imported by
 * plain unit tests and must not drag the renderer in with it.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { SidecarClient } from './sidecarClient.ts';

/**
 * The client's reconnect counter as React state.
 *
 * Put it in a snapshot effect's dependency array and the effect re-runs after
 * every re-handshake — which is the only honest response to a reconnect,
 * since events missed while the socket was down are gone. Stays 0 forever in
 * mock mode (no client, no reconnects).
 */
export function useSidecarGeneration(client: SidecarClient | null): number {
  const subscribe = useCallback(
    (cb: () => void) => (client ? client.onGeneration(cb) : () => {}),
    [client],
  );
  return useSyncExternalStore(subscribe, () => client?.generation ?? 0);
}
