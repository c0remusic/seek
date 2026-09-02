// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The partial chip could always count ("7 of 10"); with the tracklist riding
 * the session it can now NAME what is not there. Pinned: the names appear only
 * when the tracklist travelled, and the wording stays hedged — filenames are
 * the only evidence.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReleaseCard } from './ReleaseCard.tsx';
import type { Release, SourceFile } from '../domain/types.ts';
import type { WantTrack } from '../../../shared/protocol.ts';

afterEach(cleanup);

function file(name: string, title: string): SourceFile {
  return {
    id: name, path: name, size: 1, score: 0.5, duration: null,
    bitrate: null, sampleRate: null, bitDepth: null, vbr: null,
    parsed: { filename: name, stem: name, title: { value: title, confidence: 0.9 } },
    quality: { tier: 'lossless', label: 'FLAC' },
    transcode: { verdict: 'unchecked' },
    peer: { username: 'peer', freeSlots: true, advertisedSpeed: 0, queueLength: 0 },
  } as unknown as SourceFile;
}

function release(files: SourceFile[]): Release {
  return {
    id: 'r1', user: 'peer', folder: 'Burial - Untrue', folderPath: 'x\\Burial - Untrue',
    artist: 'Burial', title: 'Untrue', year: 2007, catalogue: null,
    files, totalSize: 100, trackCount: files.length,
    dominantTier: 'lossless', dominantLabel: 'FLAC', suspectCount: 0,
    peer: { username: 'peer', freeSlots: true, advertisedSpeed: 0, queueLength: 0 },
  } as unknown as Release;
}

const TRACKS: WantTrack[] = [
  { position: 1, title: 'Archangel', artist: '', duration: null, disc: null, rawPosition: null },
  { position: 2, title: 'Near Dark', artist: '', duration: null, disc: null, rawPosition: null },
  { position: 3, title: 'Ghost Hardware', artist: '', duration: null, disc: null, rawPosition: null },
];

function renderCard(over: { expectedTracklist?: WantTrack[] | null }) {
  render(
    <ReleaseCard
      release={release([file('01 Archangel.flac', 'Archangel')])}
      expanded={false}
      onToggle={() => {}}
      onQueue={() => {}}
      density="comfortable"
      expectedTracks={3}
      {...over}
    />,
  );
}

describe('the partial chip', () => {
  it('names the missing tracks when the tracklist travelled with the search', () => {
    renderCard({ expectedTracklist: TRACKS });
    const chip = screen.getByText('of', { exact: false }).closest('.partial')!;
    const title = chip.getAttribute('title')!;
    expect(title).toContain('Not seen in its filenames');
    expect(title).toContain('Near Dark');
    expect(title).toContain('Ghost Hardware');
    expect(title).not.toContain('Archangel ·');
  });

  it('only counts when the search carried a number alone', () => {
    renderCard({ expectedTracklist: null });
    const chip = screen.getByText('of', { exact: false }).closest('.partial')!;
    const title = chip.getAttribute('title')!;
    expect(title).toContain('3 tracks');
    expect(title).not.toContain('Not seen');
  });
});
