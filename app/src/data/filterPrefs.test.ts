// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Stored filters outlive the code that wrote them — a saved search from an
 * older build, a hand-edited localStorage, a truncated write. What's pinned
 * here is that nothing read back can smuggle a wrong type into the filter
 * checks, and that remembering is strictly best-effort: broken storage means
 * empty filters, never a crash.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EMPTY_FILTERS, normaliseFilters } from '../domain/types.ts';
import { loadLastFilters, saveLastFilters } from './filterPrefs.ts';
import { deserialiseFilters, serialiseFilters } from '../ui/DiscoveryViews.tsx';
import { useSearchSession } from './searchStore.ts';
import type { SidecarConnection } from './connectionStore.ts';

afterEach(() => localStorage.clear());

describe('normaliseFilters', () => {
  it('garbage in, the empty filter out', () => {
    for (const raw of [null, undefined, 42, 'flac', [], true]) {
      const f = normaliseFilters(raw);
      expect(f).toEqual({ ...EMPTY_FILTERS, formats: new Set() });
      // A fresh Set every time — never the shared EMPTY_FILTERS instance,
      // which a caller could then mutate for everyone.
      expect(f.formats).not.toBe(EMPTY_FILTERS.formats);
    }
  });

  it('drops wrongly-typed fields one by one, keeping the rest', () => {
    const f = normaliseFilters({
      formats: ['FLAC', 7, 'WAV'],
      losslessOnly: 'yes',
      minBitrate: '320',
      sizeMin: Infinity,
      maxQueue: 5,
      include: 42,
      exclude: 'remaster',
      unknownFromTheFuture: true,
    });
    expect([...f.formats]).toEqual(['FLAC', 'WAV']);
    expect(f.losslessOnly).toBe(false);
    expect(f.minBitrate).toBeNull();
    expect(f.sizeMin).toBeNull();
    expect(f.maxQueue).toBe(5);
    expect(f.include).toBe('');
    expect(f.exclude).toBe('remaster');
    expect('unknownFromTheFuture' in f).toBe(false);
  });

  it('a legacy saved-search blob round-trips through deserialiseFilters', () => {
    const saved = serialiseFilters({ ...EMPTY_FILTERS, formats: new Set(['FLAC']), minSpeed: 100 });
    const back = deserialiseFilters(saved);
    expect([...back.formats]).toEqual(['FLAC']);
    expect(back.minSpeed).toBe(100);
    expect(deserialiseFilters('{not json')).toEqual(EMPTY_FILTERS);
  });
});

describe('last-used filters', () => {
  it('round-trips, Set included', () => {
    saveLastFilters({ ...EMPTY_FILTERS, formats: new Set(['AIFF']), excludeTranscodes: true });
    const back = loadLastFilters();
    expect([...back.formats]).toEqual(['AIFF']);
    expect(back.excludeTranscodes).toBe(true);
  });

  it('corrupt storage reads as empty filters', () => {
    localStorage.setItem('seek.filters.v1', '{truncated');
    expect(loadLastFilters()).toEqual({ ...EMPTY_FILTERS, formats: new Set() });
  });

  it('seeds the first search session, and setFilters writes through', () => {
    saveLastFilters({ ...EMPTY_FILTERS, formats: new Set(['FLAC']), freeSlotsOnly: true });

    const conn = {
      phase: 'open', isMock: true, serverState: 'online',
      client: null, startupError: null,
      sidecar: { start() {}, stop() {}, setRate() {} },
    } as unknown as SidecarConnection;
    const { result } = renderHook(() => useSearchSession(conn));

    expect([...result.current.filters.formats]).toEqual(['FLAC']);
    expect(result.current.filters.freeSlotsOnly).toBe(true);

    act(() => result.current.setFilters({ ...EMPTY_FILTERS, formats: new Set(), minSpeed: 250 }));
    expect(loadLastFilters().minSpeed).toBe(250);
    expect(loadLastFilters().freeSlotsOnly).toBe(false);
  });
});
