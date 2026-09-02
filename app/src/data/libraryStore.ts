/*
 * Seek — what you already own.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The vision note §13. Two things fall out of an index immediately: "you
 * already have this" while searching, which is the daily win, and eventually
 * "which releases am I missing".
 *
 * THE COUPLING THAT MATTERS. Owned keys are produced by `sidecar/library.py`
 * and matched here. The two normalisers must agree exactly, or every result
 * reads as unowned and the feature silently does nothing — the worst kind of
 * failure, because it looks like an empty collection rather than a bug. The
 * regexes below are a deliberate mirror of that file; change one, change both.
 *
 * Matching is client-side over a set sent once. Asking the sidecar per result
 * would be thousands of round trips for a membership test.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SidecarClient } from './sidecarClient.ts';
import { useSidecarGeneration } from './useSidecarGeneration.ts';

import { ASSESSMENT_TONE } from './analysisStore.ts';
import type { AnalysisEntry, SpectralAssessment } from './analysisStore.ts';

export interface LibraryState {
  scannedAt: number;
  roots: string[];
  releaseCount: number;
  trackCount: number;
  scanning: boolean;
}

export interface LibraryRelease {
  key: string;
  artist: string;
  release: string;
  folder: string;
  trackCount: number;
  bytes: number;
  /** Extension counts as JSON: the schema has no map type. */
  formats: string;
  year: number;
  genre: string;
}

/* --- mirror of sidecar/library.py. Keep in step. --- */
const BRACKETS = /[[(][^\])]*[\])]/g;
const NOISE = /\b(remaster(ed)?|deluxe|expanded|explicit|bonus|reissue|mono|stereo|web|vinyl|cd|flac|mp3|wav|aiff|24bit|16bit|\d{3,4}kbps|va)\b/gi;
const PUNCT = /[^\w\s]+/g;

export function normalise(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(BRACKETS, ' ')
    .replace(NOISE, ' ')
    .replace(PUNCT, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function releaseKey(artist: string | null, release: string): string {
  return `${normalise(artist)}|${normalise(release)}`.replace(/^\||\|$/g, '');
}

export function trackKey(artist: string | null, title: string): string {
  return `${normalise(artist)}|${normalise(title)}`.replace(/^\||\|$/g, '');
}

/**
 * The spectral verdicts sitting under one release's folder.
 *
 * Pure over the analysis map so LibraryView can call it per row and the tests
 * need no React. Paths come from the OS the SIDECAR runs on — `\` on Windows,
 * `/` on mac — so containment is tested against both separators rather than
 * whatever this webview's platform would guess. `worst` uses the tone order
 * bad > warn > unknown > good: one suspect file taints the release, which is
 * the direction a collector actually cares about.
 */
export function verdictsUnder(
  folder: string,
  byPath: Map<string, AnalysisEntry>,
): { worst: SpectralAssessment | null; files: Array<{ path: string; assessment: SpectralAssessment }> } {
  const files: Array<{ path: string; assessment: SpectralAssessment }> = [];
  if (folder) {
    for (const [path, entry] of byPath) {
      if (!path.startsWith(folder + '/') && !path.startsWith(folder + '\\')) continue;
      const assessment = entry.result?.assessment ?? entry.verdict?.assessment;
      if (assessment) files.push({ path, assessment });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const rank: Record<'bad' | 'warn' | 'unknown' | 'good', number> = {
    bad: 3, warn: 2, unknown: 1, good: 0,
  };
  let worst: SpectralAssessment | null = null;
  for (const f of files) {
    if (worst === null || rank[ASSESSMENT_TONE[f.assessment]] > rank[ASSESSMENT_TONE[worst]]) {
      worst = f.assessment;
    }
  }
  return { worst, files };
}

export interface LibraryGap {
  position: number;
  title: string;
  artist: string;
  have: boolean;
}

export interface LibraryGaps {
  key: string;
  matched: boolean;
  releaseTitle: string;
  releaseArtist: string;
  score: number;
  tracks: LibraryGap[];
}

export interface LibrarySession {
  state: LibraryState;
  releases: LibraryRelease[];
  /** True when this release is already on disk. */
  hasRelease(artist: string | null, release: string): boolean;
  /** The raw release keys, for bulk work like peer overlap. */
  ownedReleases: Set<string>;
  hasTrack(artist: string | null, title: string): boolean;
  scan(roots?: string[], readTags?: boolean): void;
  /** Ask which tracks of one release are missing. Result arrives via `gaps`. */
  findGaps(key: string, artist: string, release: string): void;
  gaps: Map<string, LibraryGaps | 'looking'>;
  loadReleases(): void;
  available: boolean;
}

const EMPTY: LibraryState = {
  scannedAt: 0, roots: [], releaseCount: 0, trackCount: 0, scanning: false,
};

export function useLibrary(client: SidecarClient | null): LibrarySession {
  const [state, setState] = useState<LibraryState>(EMPTY);
  const [owned, setOwned] = useState<{ releases: Set<string>; tracks: Set<string> }>(
    () => ({ releases: new Set(), tracks: new Set() }),
  );
  const [releases, setReleases] = useState<LibraryRelease[]>([]);
  const [gaps, setGaps] = useState<Map<string, LibraryGaps | 'looking'>>(() => new Map());

  const refreshOwned = useCallback(() => {
    if (!client) return;
    void client.request<{ releases: string[]; tracks: string[] }>('library.owned')
      .then((r) => setOwned({
        releases: new Set(r.releases ?? []),
        tracks: new Set(r.tracks ?? []),
      }))
      .catch(() => {});
  }, [client]);

  const gen = useSidecarGeneration(client);

  useEffect(() => {
    if (!client) return;
    const off = client.on('library.state', (d) => {
      const s = d as LibraryState;
      setState(s);
      // A finished scan invalidates the owned set; a progress tick does not.
      if (!s.scanning) refreshOwned();
    });
    const offGaps = client.on('library.gaps', (d) => {
      const g = d as LibraryGaps;
      setGaps((prev) => new Map(prev).set(g.key, g));
    });
    void client.request<LibraryState>('library.state').then(setState).catch(() => {});
    refreshOwned();
    return () => { off(); offGaps(); };
  // `gen` re-runs this after a reconnect: events missed while the socket
  // was down are gone, so the snapshot has to be asked for again.
  }, [client, refreshOwned, gen]);

  const findGaps = useCallback((key: string, artist: string, release: string) => {
    if (!client) return;
    setGaps((prev) => new Map(prev).set(key, 'looking'));
    void client.request('library.gaps', { key, artist, release })
      .catch(() => setGaps((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      }));
  }, [client]);

  const loadReleases = useCallback(() => {
    if (!client) return;
    void client.request<{ items: LibraryRelease[] }>('library.releases')
      .then((r) => setReleases(r.items ?? []))
      .catch(() => {});
  }, [client]);

  const scan = useCallback((roots: string[] = [], readTags = true) => {
    if (!client) return;
    setState((s) => ({ ...s, scanning: true }));
    void client.request<LibraryState>('library.scan', { roots, readTags })
      .then(setState)
      .catch(() => setState((s) => ({ ...s, scanning: false })));
  }, [client]);

  return {
    state,
    releases,
    hasRelease: (artist, release) => owned.releases.has(releaseKey(artist, release)),
    ownedReleases: owned.releases,
    hasTrack: (artist, title) => owned.tracks.has(trackKey(artist, title)),
    scan,
    findGaps,
    gaps,
    loadReleases,
    available: Boolean(client),
  };
}
