// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The archive seam: verdicts persisted by the sidecar come back on connect and
 * populate both maps, but never displace anything this session computed — a
 * full result is a superset of its own archived summary.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { summaryOf, useAnalysis } from './analysisStore.ts';
import type { SpectralAnalysis, SpectralVerdict } from './analysisStore.ts';
import type { SidecarClient } from './sidecarClient.ts';

afterEach(cleanup);

const VERDICT: SpectralVerdict = {
  path: '/music/burial/01 archangel.flac',
  transferId: 't-1',
  assessment: 'strong_signs_of_lossy_source',
  confidence: 0.82,
  cutoffHz: 16400,
  shelfDropDb: 61,
  shelfWidthHz: 500,
  impliedSourceKbps: 160,
  sampleRate: 44100,
  durationSeconds: 231.4,
  declaredLossless: true,
  decodedWith: 'soundfile',
  analysedAt: 1_700_000_000,
  fileSize: 64,
  fileMtime: 1_700_000_000,
};

/** A client that answers analysis.verdicts and lets the test fire events. */
function fakeClient(verdicts: SpectralVerdict[]) {
  const handlers = new Map<string, (data: unknown) => void>();
  const client = {
    request: (cmd: string) => (cmd === 'analysis.verdicts'
      ? Promise.resolve({ verdicts })
      : new Promise(() => {})),
    on: (name: string, cb: (data: unknown) => void) => {
      handlers.set(name, cb);
      return () => handlers.delete(name);
    },
    onGeneration: () => () => {},
    generation: 0,
  } as unknown as SidecarClient;
  return { client, fire: (name: string, data: unknown) => handlers.get(name)?.(data) };
}

describe('verdict reseeding', () => {
  it('populates byPath and byTransfer from the archive', async () => {
    const { client } = fakeClient([VERDICT]);
    const { result } = renderHook(() => useAnalysis(client));
    await act(async () => { await Promise.resolve(); });

    const byPath = result.current.byPath.get(VERDICT.path);
    expect(byPath?.state).toBe('done');
    expect(byPath?.verdict?.assessment).toBe('strong_signs_of_lossy_source');
    expect(byPath?.result).toBeUndefined();
    expect(result.current.byTransfer.get('t-1')?.verdict?.path).toBe(VERDICT.path);
  });

  it('a fresh full result outranks the archived summary', async () => {
    const { client, fire } = fakeClient([VERDICT]);
    const { result } = renderHook(() => useAnalysis(client));
    await act(async () => { await Promise.resolve(); });

    const full = {
      ...VERDICT,
      requestId: 'r1',
      assessment: 'likely_lossless',
      nyquistHz: 22050,
      channels: 2,
      spectrumHz: [20], spectrumDb: [0],
      heatmapDb: [], heatmapTimeBins: 0, heatmapFreqBins: 0,
      fftSize: 8192, windowCount: 4, analysedSeconds: 0.7,
    } as unknown as SpectralAnalysis;
    act(() => fire('analysis.result', full));

    expect(result.current.byPath.get(VERDICT.path)?.result?.assessment)
      .toBe('likely_lossless');
    // And the summary reads from the result, not the stale verdict.
    expect(summaryOf(result.current.byPath.get(VERDICT.path)!)?.assessment)
      .toBe('likely_lossless');
  });

  it('summaryOf derives the Nyquist ceiling the archive does not repeat', () => {
    const summary = summaryOf({ state: 'done', verdict: VERDICT });
    expect(summary?.nyquistHz).toBe(22050);
    expect(summary?.cutoffHz).toBe(16400);
    expect(summaryOf({ state: 'running' })).toBeNull();
  });
});
