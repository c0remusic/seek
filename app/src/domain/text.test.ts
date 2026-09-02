/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * fuzzyKey is the identity every grouping and want-list match hangs off, so
 * its two contracts get pinned here: latin keys never change (or every
 * existing group re-buckets), and non-latin text stops keying to '' (which
 * matched nothing and silently dropped whole catalogues).
 */

import { describe, expect, it } from 'vitest';
import { fuzzyKey } from './text.ts';

describe('fuzzyKey', () => {
  it('latin keys are unchanged — the regression tripwire', () => {
    expect(fuzzyKey('Burial — Untrue')).toBe('burial untrue');
    expect(fuzzyKey('The Chemical Brothers')).toBe('chemical brothers');
    expect(fuzzyKey('Señor Coconut (Original Mix)')).toBe('senor coconut');
  });

  it('a non-latin title keys to itself, not to the empty string', () => {
    const kino = fuzzyKey('Кино');
    expect(kino).not.toBe('');
    expect(fuzzyKey('кино')).toBe(kino);
    expect(fuzzyKey('坂本龍一')).not.toBe('');
  });

  it('mixed-script strings keep the latin-only key, so nothing regroups', () => {
    // Any latin content at all means the historical key survives.
    expect(fuzzyKey('Кино — Kino')).toBe('kino');
  });
});
