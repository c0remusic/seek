// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The identity verdict decides a word a person reads next to a file they just
 * spent an hour downloading, so the three tones are pinned — especially that
 * "AcoustID has never heard of this" reads as unknown, never as an accusation:
 * that is the ordinary outcome for anything underground.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { identityTone, useIdentify } from './identifyStore.ts';
import type { SidecarClient } from './sidecarClient.ts';

afterEach(cleanup);

describe('identityTone', () => {
  it('confirms when the filename carries the recording AcoustID heard', () => {
    expect(identityTone(
      { matched: true, artist: 'Burial', title: 'Archangel' },
      '02 - Burial - Archangel.flac',
    )).toBe('good');
  });

  it('warns when AcoustID confidently heard something else', () => {
    expect(identityTone(
      { matched: true, artist: 'Burial', title: 'Near Dark' },
      '02 - Burial - Archangel.flac',
    )).toBe('warn');
  });

  it('an unrecognised recording is unknown, not a fault', () => {
    expect(identityTone(
      { matched: false, artist: '', title: '' },
      '02 - Burial - Archangel.flac',
    )).toBe('unknown');
  });

  it('a remix is not confused with the original', () => {
    // fuzzyKey keeps the word "remix", so the containment fails — deliberate.
    expect(identityTone(
      { matched: true, artist: 'Burial', title: 'Archangel (Boreal Remix)' },
      '02 - Burial - Archangel.flac',
    )).toBe('warn');
  });
});

describe('useIdentify', () => {
  function fakeClient() {
    const handlers = new Map<string, (data: unknown) => void>();
    const client = {
      request: (cmd: string) => (cmd === 'discover.fingerprint'
        ? Promise.resolve({ requestId: 'req-1' })
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

  it('correlates the identified event back to the transfer', async () => {
    const { client, fire } = fakeClient();
    const { result } = renderHook(() => useIdentify(client));

    act(() => result.current.identifyTransfer('t-1'));
    expect(result.current.byTransfer.get('t-1')?.state).toBe('running');
    await act(async () => { await Promise.resolve(); });

    act(() => fire('discover.identified', {
      requestId: 'req-1', path: '/dl/a.flac', matched: true,
      artist: 'Burial', title: 'Archangel', album: null, year: null,
      mbid: null, score: 0.98, durationSeconds: 120,
    }));
    const entry = result.current.byTransfer.get('t-1');
    expect(entry?.state).toBe('done');
    expect(entry?.result?.title).toBe('Archangel');
  });

  it('a Dig Bar identification is not mistaken for ours', async () => {
    const { client, fire } = fakeClient();
    const { result } = renderHook(() => useIdentify(client));
    act(() => fire('discover.identified', {
      requestId: 'someone-elses', path: '/x.flac', matched: true,
      artist: 'X', title: 'Y', album: null, year: null,
      mbid: null, score: 1, durationSeconds: 1,
    }));
    expect(result.current.byTransfer.size).toBe(0);
  });

  it('a failure surfaces the missing prerequisite', async () => {
    const { client, fire } = fakeClient();
    const { result } = renderHook(() => useIdentify(client));
    act(() => result.current.identifyTransfer('t-1'));
    await act(async () => { await Promise.resolve(); });

    act(() => fire('discover.parseFailed', {
      requestId: 'req-1', url: '/dl/a.flac',
      reason: 'an AcoustID application key is required', needs: 'acoustidApiKey',
      unreachable: false, unauthorised: false,
    }));
    const entry = result.current.byTransfer.get('t-1');
    expect(entry?.state).toBe('failed');
    expect(entry?.needs).toBe('acoustidApiKey');
  });
});
