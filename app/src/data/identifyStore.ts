/*
 * Seek — "is this file actually the track it claims to be?"
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The acoustic identification the Dig Bar already had (fpcalc + AcoustID —
 * the sift path), pointed at a finished download. Nothing new happens on the
 * sidecar: `discover.fingerprint` now takes a transferId, and the answer
 * arrives on the same `discover.identified` event. This store only correlates
 * requests to transfers, the way analysisStore does for spectral checks.
 *
 * The JUDGEMENT lives here, not in Python — the same seam rule as the want
 * list's "found": deciding that AcoustID's answer contradicts a filename is
 * fuzzy matching over parsed text, and that is a TypeScript problem.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SidecarClient } from './sidecarClient.ts';
import type { DiscoverIdentified } from '../../../shared/protocol.ts';
import { fuzzyKey } from '../domain/text.ts';

export type { DiscoverIdentified } from '../../../shared/protocol.ts';

export interface IdentifyEntry {
  state: 'running' | 'done' | 'failed';
  result?: DiscoverIdentified;
  /** Displayable when the failure names a missing prerequisite. */
  reason?: string;
  /** 'acoustidApiKey' | 'fpcalc' | '' — which Settings field is missing. */
  needs?: string;
}

export type IdentityTone = 'good' | 'warn' | 'unknown';

/**
 * Does AcoustID's answer agree with what the file calls itself?
 *
 * 'good'   — the recording AcoustID heard shares its title (or artist+title)
 *            with the parsed filename. The download is what it claims.
 * 'warn'   — AcoustID confidently heard SOMETHING ELSE. The one finding that
 *            pays for this feature: a mislabelled file sounds fine and reads
 *            fine, and only the audio itself can contradict the name.
 * 'unknown'— AcoustID does not know this recording. The ordinary outcome for
 *            anything underground, and explicitly NOT a fault.
 *
 * `score` is AcoustID's confidence that the FINGERPRINT matched — never a
 * judgement about the metadata being right. It decorates the tooltip only.
 */
export function identityTone(
  result: Pick<DiscoverIdentified, 'matched' | 'artist' | 'title'>,
  parsedName: string,
): IdentityTone {
  if (!result.matched) return 'unknown';
  const name = fuzzyKey(parsedName);
  const title = fuzzyKey(result.title);
  if (!name || !title) return 'unknown';
  if (name.includes(title)) return 'good';
  // Some rips put only the artist in the filename ("Burial - Untrue A2"):
  // an artist agreement without the title is still weak — stay honest.
  return 'warn';
}

export interface IdentifySession {
  byTransfer: Map<string, IdentifyEntry>;
  identifyTransfer(transferId: string): void;
  available: boolean;
}

export function useIdentify(client: SidecarClient | null): IdentifySession {
  const [byTransfer, setByTransfer] = useState<Map<string, IdentifyEntry>>(() => new Map());
  /** requestId -> transferId. The event echoes the request, not the transfer. */
  const pending = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!client) return;

    const offIdentified = client.on('discover.identified', (data) => {
      const d = data as DiscoverIdentified;
      const tid = pending.current.get(d.requestId);
      if (!tid) return; // A Dig Bar identification, not one of ours.
      pending.current.delete(d.requestId);
      setByTransfer((prev) => new Map(prev).set(tid, { state: 'done', result: d }));
    });

    const offFailed = client.on('discover.parseFailed', (data) => {
      const d = data as { requestId: string; reason: string; needs: string };
      const tid = pending.current.get(d.requestId);
      if (!tid) return;
      pending.current.delete(d.requestId);
      setByTransfer((prev) => new Map(prev).set(tid, {
        state: 'failed', reason: d.reason, needs: d.needs,
      }));
    });

    return () => { offIdentified(); offFailed(); };
  }, [client]);

  const identifyTransfer = useCallback((transferId: string) => {
    if (!client) return;
    setByTransfer((prev) => (prev.get(transferId)?.state === 'running'
      ? prev : new Map(prev).set(transferId, { state: 'running' })));
    void client.request<{ requestId: string }>('discover.fingerprint', {
      path: null, transferId, durationLimit: null,
    })
      .then((r) => pending.current.set(r.requestId, transferId))
      .catch((e: Error) => {
        setByTransfer((prev) => new Map(prev).set(transferId, {
          state: 'failed', reason: e.message,
        }));
      });
  }, [client]);

  return { byTransfer, identifyTransfer, available: Boolean(client) };
}
