// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Stopped listening" used to be a dead end: the sidecar closes a search on
 * timeout or the result cap and there is no protocol way to extend a live one,
 * so the only honest offer is a fresh run of the same query. This pins the
 * button's gate — the two natural endings only — and that pressing it re-runs
 * through session.run() rather than doing anything cleverer.
 */

import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchView } from './SearchView.tsx';
import type { SearchSession } from '../data/searchStore.ts';
import type { TransferSession } from '../data/transferStore.ts';
import { EMPTY_FILTERS } from '../domain/types.ts';
import { GLOBAL_SCOPE } from '../data/mockSidecar.ts';
import { DEFAULT_COLUMNS } from '../domain/searchColumns.ts';

afterEach(cleanup);

/* jsdom has no ResizeObserver; SegmentedControl and ResultList each create
 * one on mount. An inert stub is all a render test needs. */
class InertResizeObserver {
  observe() {} unobserve() {} disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= InertResizeObserver;

/* Only what SearchView actually reads. A run spy is the point; the rest is a
 * quiet, empty, closed search. */
function fakeSession(over: Partial<SearchSession>): SearchSession {
  return {
    query: 'burial untrue', setQuery() {}, run: vi.fn(), stop() {},
    expectedTracks: null, scope: GLOBAL_SCOPE, setScope() {},
    running: false, closedReason: null,
    rows: [], pendingCount: 0, foldInPending() {}, reportViewport() {},
    totalFiles: 0, matchedFiles: 0, peerCount: 0, tick: 0,
    filters: EMPTY_FILTERS, setFilters() {}, resetFilters() {},
    groupBy: 'release', setGroupBy() {}, sort: 'best', setSort() {},
    expanded: new Set(), toggleExpanded() {},
    availableFormats: [],
    phase: 'open', isMock: true, serverState: null, client: null,
    startupError: null,
    snapshot: () => { throw new Error('unused'); }, restore() {},
    ...over,
  } as SearchSession;
}

function renderView(session: SearchSession) {
  render(
    <SearchView
      session={session}
      searchRef={createRef<HTMLInputElement>()}
      density="comfortable"
      onDensity={() => {}}
      columns={[...DEFAULT_COLUMNS]}
      onColumns={() => {}}
      transfers={{ downloads: [], queue: () => {}, statusFor: () => null } as unknown as TransferSession}
    />,
  );
}

describe('Search again', () => {
  it.each(['timeout', 'result_cap'])('offers a re-run after %s and runs the same query', (reason) => {
    const session = fakeSession({ closedReason: reason });
    renderView(session);
    fireEvent.pointerDown(screen.getByText('Search again'));
    expect(session.run).toHaveBeenCalledWith();
  });

  it('is absent while running, after a manual stop, and offline', () => {
    for (const over of [
      { closedReason: 'timeout', running: true },
      { closedReason: 'stopped' },
      { closedReason: 'disconnected' },
      { closedReason: 'timeout', query: '   ' },
    ]) {
      renderView(fakeSession(over));
      expect(screen.queryByText('Search again')).toBeNull();
      cleanup();
    }
  });
});
