/*
 * Seek — which of the tracks you asked for does this copy actually hold?
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The question only exists when there is an AUTHORITATIVE list to align
 * against — the Discogs release the user chose, carried into the tab as
 * `expectedTracklist`. This is deliberately NOT the per-track matching
 * between copies that bestSources.ts records as tried-three-ways-and-
 * abandoned: copies disagree with each other in every way free text can,
 * but a catalogue tracklist is one fixed set of titles, and "is this title
 * present in this copy" is a much smaller claim than "these two files are
 * the same recording".
 *
 * Conservative on purpose, in the direction that matters: a track reported
 * missing when the copy names its files badly is an inconvenience the UI
 * wording absorbs ("not seen in this copy's filenames"); a track reported
 * present that is not there is a wasted download.
 */

import type { WantTrack } from '../../../shared/protocol.ts';
import type { SourceFile } from './types.ts';
import { fuzzyKey } from './text.ts';

/** Same slop the search grouper allows between sources of one recording. */
const DURATION_SLOP_S = 2;

export interface TrackCoverage {
  track: WantTrack;
  covered: boolean;
  /** The filename that covered it, for the tooltip. Null when not covered. */
  matchedFile: string | null;
}

/**
 * Align a copy's files against the expected tracklist.
 *
 * Each file votes for at most ONE expected track: the one with the longest
 * fuzzy-key it contains. Longest-wins is what keeps a remix from shadowing
 * its original — a file named "Archangel (Boreal Remix)" contains the key of
 * plain "Archangel" too, and the longer remix key is the honest owner. Ties
 * fall to a duration within ±2s when both sides know one; position is NEVER
 * used to match — free-text numbering and catalogue numbering disagree too
 * often for an offset to mean anything (the sidecar's own tracklist comment
 * says as much about "A1" vs "1-1").
 */
export function alignTracklist(
  expected: WantTrack[],
  files: SourceFile[],
): TrackCoverage[] {
  const keyed = expected.map((track) => ({ track, key: fuzzyKey(track.title) }));
  const coveredBy = new Map<number, string>();

  for (const file of files) {
    const title = file.parsed.title?.value ?? file.parsed.stem;
    const fileKey = fuzzyKey(title);
    if (!fileKey) continue;

    let best: { index: number; keyLength: number } | null = null;
    for (let i = 0; i < keyed.length; i += 1) {
      const { track, key } = keyed[i];
      if (!key || !fileKey.includes(key)) continue;
      if (best && best.keyLength > key.length) continue;
      if (best && best.keyLength === key.length) {
        // Equal-length claims: only a duration agreement breaks the tie.
        const close = track.duration !== null && file.duration !== null
          && Math.abs(track.duration - file.duration) <= DURATION_SLOP_S;
        if (!close) continue;
      }
      best = { index: i, keyLength: key.length };
    }
    if (best && !coveredBy.has(best.index)) {
      coveredBy.set(best.index, file.parsed.filename);
    }
  }

  return keyed.map(({ track }, index) => ({
    track,
    covered: coveredBy.has(index),
    matchedFile: coveredBy.get(index) ?? null,
  }));
}
