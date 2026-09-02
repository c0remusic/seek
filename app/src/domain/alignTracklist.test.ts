/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The alignment's failure directions are asymmetric on purpose: a false
 * "missing" is a sentence the sheet's wording absorbs, a false "present" is a
 * wasted download. These pin the conservative side — and the longest-wins rule
 * that keeps a remix from covering for its original.
 */

import { describe, expect, it } from 'vitest';
import { alignTracklist } from './alignTracklist.ts';
import type { WantTrack } from '../../../shared/protocol.ts';
import type { SourceFile } from './types.ts';

function track(position: number, title: string, duration: number | null = null): WantTrack {
  return { position, title, artist: '', duration, disc: null, rawPosition: null };
}

function file(name: string, title: string | null, duration: number | null = null): SourceFile {
  return {
    duration,
    parsed: {
      filename: name,
      stem: name.replace(/\.\w+$/, ''),
      title: title === null ? null : { value: title, confidence: 0.9 },
    },
  } as unknown as SourceFile;
}

describe('alignTracklist', () => {
  it('covers the tracks whose titles the copy names, and no others', () => {
    const expected = [track(1, 'Archangel'), track(2, 'Near Dark'), track(3, 'Ghost Hardware')];
    const files = [
      file('01 - Archangel.flac', 'Archangel'),
      file('03 - Ghost Hardware.flac', 'Ghost Hardware'),
    ];
    const result = alignTracklist(expected, files);
    expect(result.map((r) => r.covered)).toEqual([true, false, true]);
    expect(result[0].matchedFile).toBe('01 - Archangel.flac');
    expect(result[1].matchedFile).toBeNull();
  });

  it('a remix does not cover for its original: longest key wins', () => {
    const expected = [track(1, 'Archangel'), track(2, 'Archangel (Boreal Remix)')];
    const files = [file('02 - Archangel (Boreal Remix).flac', 'Archangel (Boreal Remix)')];
    const result = alignTracklist(expected, files);
    expect(result.map((r) => r.covered)).toEqual([false, true]);
  });

  it('falls back to the filename stem when no title parsed', () => {
    const expected = [track(1, 'Hubble')];
    const files = [file('A1 Hubble.flac', null)];
    expect(alignTracklist(expected, files)[0].covered).toBe(true);
  });

  it('position never matches on its own', () => {
    // Track 1 exists and file "01" exists, but the names disagree: not covered.
    const expected = [track(1, 'Archangel')];
    const files = [file('01 - Completely Different.flac', 'Completely Different')];
    expect(alignTracklist(expected, files)[0].covered).toBe(false);
  });

  it('equal-length claims are settled by duration, or not at all', () => {
    // Two untitled variants whose keys are identical: only the one whose
    // duration agrees may claim the file.
    const expected = [track(1, 'Untitled', 180), track(2, 'Untitled', 300)];
    const files = [file('B2 Untitled.flac', 'Untitled', 299)];
    const result = alignTracklist(expected, files);
    expect(result.map((r) => r.covered)).toEqual([false, true]);
  });

  it('an empty expected title claims nothing', () => {
    const expected = [track(1, '')];
    const files = [file('01 - Anything.flac', 'Anything')];
    expect(alignTracklist(expected, files)[0].covered).toBe(false);
  });

  it('non-latin titles align through the fuzzy fallback', () => {
    const expected = [track(1, 'Плагиат')];
    const files = [file('01 - Плагиат.flac', 'Плагиат')];
    expect(alignTracklist(expected, files)[0].covered).toBe(true);
  });
});
