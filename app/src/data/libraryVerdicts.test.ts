/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * verdictsUnder is the bridge between the Downloads-side spectral check and
 * the shelf. Two things must hold: paths from either OS count as "under" a
 * folder (verdict paths come from wherever the sidecar runs, so `\` and `/`
 * both appear in real stores), and one suspect file taints the whole release.
 */

import { describe, expect, it } from 'vitest';
import { verdictsUnder } from './libraryStore.ts';
import type { AnalysisEntry, SpectralAssessment } from './analysisStore.ts';

function entry(assessment: SpectralAssessment): AnalysisEntry {
  return {
    state: 'done',
    verdict: { assessment } as NonNullable<AnalysisEntry['verdict']>,
  };
}

describe('verdictsUnder', () => {
  it('collects files under the folder, both separators, subfolders included', () => {
    const byPath = new Map<string, AnalysisEntry>([
      ['/music/burial/01 archangel.flac', entry('likely_lossless')],
      ['/music/burial/disc1/02 near dark.flac', entry('possible_transcode')],
      ['C:\\music\\burial\\03 ghost hardware.flac', entry('likely_lossless')],
      ['/music/burial-untrue-vinyl/01.flac', entry('strong_signs_of_lossy_source')],
      ['/elsewhere/track.flac', entry('strong_signs_of_lossy_source')],
    ]);

    const posix = verdictsUnder('/music/burial', byPath);
    expect(posix.files.map((f) => f.path)).toEqual([
      '/music/burial/01 archangel.flac',
      '/music/burial/disc1/02 near dark.flac',
    ]);

    const windows = verdictsUnder('C:\\music\\burial', byPath);
    expect(windows.files.map((f) => f.path)).toEqual([
      'C:\\music\\burial\\03 ghost hardware.flac',
    ]);
  });

  it('one suspect file taints the release: worst wins by tone', () => {
    const byPath = new Map<string, AnalysisEntry>([
      ['/m/r/01.flac', entry('likely_lossless')],
      ['/m/r/02.flac', entry('inconclusive')],
      ['/m/r/03.flac', entry('possible_transcode')],
    ]);
    expect(verdictsUnder('/m/r', byPath).worst).toBe('possible_transcode');

    byPath.set('/m/r/04.flac', entry('strong_signs_of_lossy_source'));
    expect(verdictsUnder('/m/r', byPath).worst).toBe('strong_signs_of_lossy_source');
  });

  it('an all-clear release reads as its reassuring verdict', () => {
    const byPath = new Map<string, AnalysisEntry>([
      ['/m/r/01.flac', entry('likely_lossless')],
    ]);
    expect(verdictsUnder('/m/r', byPath).worst).toBe('likely_lossless');
  });

  it('nothing analysed means nothing claimed', () => {
    expect(verdictsUnder('/m/r', new Map()).worst).toBeNull();
    // A running or failed entry is not a verdict.
    const byPath = new Map<string, AnalysisEntry>([
      ['/m/r/01.flac', { state: 'running' }],
      ['/m/r/02.flac', { state: 'failed', reason: 'nope' }],
    ]);
    expect(verdictsUnder('/m/r', byPath)).toEqual({ worst: null, files: [] });
    expect(verdictsUnder('', byPath).files).toEqual([]);
  });
});
