/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Tier-1 filters PRODUCT §3 promised and the bar never had. Two things are
 * pinned hard: the null rule for the proof floors is the OPPOSITE of
 * minBitrate's (a file silent about its sample rate or bit depth FAILS a
 * floor — asking for 24-bit means keeping only what is proven 24-bit), and
 * stored blobs from before these fields existed degrade to "filter off".
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filtersActive, normaliseFilters } from './types.ts';
import type { Filters, SourceFile } from './types.ts';
import { matches } from './group.ts';

function file(over: Partial<{
  sampleRate: number | null; bitDepth: number | null; compilation: boolean;
}> = {}): SourceFile {
  return {
    size: 1_000_000, bitrate: null, duration: 240,
    sampleRate: over.sampleRate ?? null,
    bitDepth: over.bitDepth ?? null,
    quality: { lossless: true, label: 'FLAC' },
    peer: { freeSlots: true, advertisedSpeed: 1000, queueLength: 0 },
    transcode: { suspect: false },
    parsed: { compilation: over.compilation ?? false },
    needle: 'x',
  } as unknown as SourceFile;
}

const filters = (p: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...p });

describe('the proof floors', () => {
  it('keep only what is proven, and silence fails them', () => {
    const f = filters({ bitDepthMin: 24 });
    expect(matches(file({ bitDepth: 24 }), f, [], [])).toBe(true);
    expect(matches(file({ bitDepth: 16 }), f, [], [])).toBe(false);
    // The opposite of minBitrate's rule: no claim is a fail, not a pass.
    expect(matches(file({ bitDepth: null }), f, [], [])).toBe(false);
  });

  it('sample rate floors work in Hz', () => {
    const f = filters({ sampleRateMin: 88_200 });
    expect(matches(file({ sampleRate: 96_000 }), f, [], [])).toBe(true);
    expect(matches(file({ sampleRate: 44_100 }), f, [], [])).toBe(false);
    expect(matches(file({ sampleRate: null }), f, [], [])).toBe(false);
  });

  it('hide compilations uses the parser verdict', () => {
    const f = filters({ hideCompilations: true });
    expect(matches(file({ compilation: true }), f, [], [])).toBe(false);
    expect(matches(file({ compilation: false }), f, [], [])).toBe(true);
  });
});

describe('the new fields ride the existing plumbing', () => {
  it('count as active', () => {
    expect(filtersActive(filters({ bitDepthMin: 24 }))).toBe(true);
    expect(filtersActive(filters({ sampleRateMin: 44_100 }))).toBe(true);
    expect(filtersActive(filters({ hideCompilations: true }))).toBe(true);
    expect(filtersActive(filters({ minFolderTracks: 4 }))).toBe(true);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it('normalise: wrong types are dropped, absent reads as off', () => {
    const f = normaliseFilters({
      bitDepthMin: '24', sampleRateMin: 96_000,
      hideCompilations: 'yes', minFolderTracks: 4,
    });
    expect(f.bitDepthMin).toBeNull();
    expect(f.sampleRateMin).toBe(96_000);
    expect(f.hideCompilations).toBe(false);
    expect(f.minFolderTracks).toBe(4);
    // A blob saved before these fields existed simply has them off.
    const legacy = normaliseFilters({ losslessOnly: true });
    expect(legacy.bitDepthMin).toBeNull();
    expect(legacy.hideCompilations).toBe(false);
  });
});
