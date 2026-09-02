/*
 * Seek — the one file that knows both the wire and the domain.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The seam: `shared/protocol.ts` is core's; `app/src/domain/` is ours; this
 * adapter is the only join. Keep it thin and keep it honest — if the wire
 * changes shape, it changes HERE and nowhere else.
 */

import type { PeerStats, SourceFile } from '../domain/types.ts';
import { toSourceFile } from '../domain/ingest.ts';
import type { RawFile } from '../domain/ingest.ts';

/* The generated protocol IS the wire shape — these used to be hand-copied
 * mirrors "so the app builds whether or not the sibling package is on the
 * path", but shared/ lives in this repo, is checked in, and is already
 * imported elsewhere (domain/playlistImport.ts), so restating it only left
 * room for drift. The Wire* aliases keep every call site readable: at a
 * glance, `WirePeerStats` is the network's claim and `PeerStats` is ours. */

import type {
  FileRef as WireFileRef,
  PeerStats as WirePeerStats,
  SearchResultEvent as WireSearchResultData,
  SearchClosedEvent as WireSearchClosedData,
  SearchCloseReason,
} from '../../../shared/protocol.ts';

export type {
  WireFileRef, WirePeerStats, WireSearchResultData, WireSearchClosedData,
  SearchCloseReason,
};

export type WireFrame =
  | { ev: 'search.started'; data: { searchId: number; query: string } }
  | { ev: 'search.result'; data: WireSearchResultData }
  | { ev: 'search.closed'; data: WireSearchClosedData }
  | { ev: string; data: unknown };

/**
 * Historical success rate with a peer. Persisted in SQLite via Tauri in a later
 * phase; until then every peer gets the neutral prior, which is what
 * `reliabilityFrom(0, 0)` returns.
 */
export type ReliabilityLookup = (username: string) => number;

export function adaptPeer(p: WirePeerStats, reliability: ReliabilityLookup): PeerStats {
  return {
    username: p.username,
    // Forwarded raw. Upstream's GTK client rewrites queueLength to 0 whenever
    // freeSlots is true; core deliberately does not, and neither do we — a peer
    // with a free slot and 30 people queued is a real and useful distinction.
    freeSlots: p.freeSlots,
    advertisedSpeed: p.advertisedSpeed,
    queueLength: p.queueLength,
    reliability: reliability(p.username),
    // `?? null` rather than a default: the field is absent on the fixture
    // replay and null on the wire for an unresolvable peer, and both mean the
    // same thing — no flag.
    country: p.country ?? null,
  };
}

export function adaptFile(f: WireFileRef, user: string): RawFile {
  return {
    user,
    path: f.path,
    size: f.size,
    bitrate: f.bitrate,
    duration: f.duration,
    sampleRate: f.sampleRate,
    bitDepth: f.bitDepth,
    // `null` means "the peer did not say", which is NOT the same as "constant
    // bitrate". The domain type is nullable precisely so this stays visible.
    vbr: f.isVbr,
  };
}

export function adaptSearchResult(
  data: WireSearchResultData,
  tick: number,
  reliability: ReliabilityLookup,
): SourceFile[] {
  const peer = adaptPeer(data.peer, reliability);
  const out: SourceFile[] = [];
  for (const f of data.files) {
    out.push(toSourceFile(adaptFile(f, data.peer.username), peer, tick));
  }
  return out;
}

/** Non-audio files ride along in real search responses; the list should not show them. */
const AUDIO = /\.(flac|wav|wave|aiff?|alac|ape|wv|m4a|mp3|aac|ogg|oga|opus|wma|mpc|shn|dsf|dff)$/i;

export function isAudioPath(path: string): boolean {
  return AUDIO.test(path);
}
