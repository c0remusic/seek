// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Albums only" is a claim about FOLDERS, so it is applied where folders
 * exist — the release-row derivation — and not in the per-file matches().
 * Pinned here: a short folder disappears from the Release view at the
 * threshold, and the same filter is inert in the Track view, which has no
 * folders to be short.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTERS } from '../domain/types.ts';
import { TICK_MS, useSearchSession } from './searchStore.ts';
import type { SidecarConnection } from './connectionStore.ts';
import type { Sidecar, SidecarHandlers } from './mockSidecar.ts';
import type { WireSearchResultData } from './adapt.ts';

afterEach(cleanup);

/** One peer, one release folder of `n` FLACs. */
function batch(n: number): WireSearchResultData {
  return {
    searchId: 1,
    private: false,
    receivedAt: 0,
    peer: {
      username: 'a-peer', freeSlots: true, advertisedSpeed: 800_000, queueLength: 0,
      files: null, folders: null, country: null,
    },
    files: Array.from({ length: n }, (_, i) => ({
      path: `music\\Burial - Untrue\\0${i + 1} track ${i + 1}.flac`,
      size: 40_000_000, bitrate: null, duration: 240,
      sampleRate: 44_100, bitDepth: 16, isVbr: null,
    })),
  };
}

function connection(n: number): SidecarConnection {
  let live = false;
  const sidecar: Sidecar = {
    start(_q: string, h: SidecarHandlers) {
      live = true;
      // On its own turn, as against a real transport (see searchInTab.test).
      setTimeout(() => { if (live) h.onResult(batch(n)); }, 10);
    },
    stop() { live = false; },
    setRate() {},
  } as unknown as Sidecar;
  return {
    phase: 'open', isMock: true, serverState: 'online',
    client: null, sidecar, startupError: null,
  } as unknown as SidecarConnection;
}

describe('Albums only', () => {
  it('hides a short folder in the Release view, and only there', () => {
    vi.useFakeTimers();
    try {
      // One connection object, created OUTSIDE the render: a fresh sidecar
      // per render would be stopped by the effect cleanup before its fake
      // network timer ever fired (searchInTab.test holds it in state for the
      // same reason).
      const conn = connection(3);
      const { result } = renderHook(() => useSearchSession(conn));
      act(() => result.current.run('burial'));
      act(() => { vi.advanceTimersByTime(TICK_MS * 2); });
      expect(result.current.rows.filter((r) => r.kind === 'release')).toHaveLength(1);

      // Threshold above the folder's 3 files: the release disappears...
      act(() => result.current.setFilters({ ...EMPTY_FILTERS, minFolderTracks: 5 }));
      expect(result.current.rows.filter((r) => r.kind === 'release')).toHaveLength(0);
      // ...its files are NOT excluded per-file (the count still says 3)...
      expect(result.current.matchedFiles).toBe(3);

      // ...and the Track view, which has no folders, is untouched.
      act(() => result.current.setGroupBy('track'));
      expect(result.current.rows.filter((r) => r.kind === 'track')).toHaveLength(3);

      // At or under the threshold the folder is a real album again.
      act(() => result.current.setGroupBy('release'));
      act(() => result.current.setFilters({ ...EMPTY_FILTERS, minFolderTracks: 3 }));
      expect(result.current.rows.filter((r) => r.kind === 'release')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
