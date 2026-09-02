// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What reconnection means to the stores: the snapshot effects are keyed on
 * the client's generation, so a re-handshake refetches the state that events
 * could not deliver while the socket was down. One hook stands in for the
 * nine that share the pattern; transferStore gets its own case because it is
 * the one store that accretes into a ref and must also SWEEP what the new
 * snapshot no longer lists.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SidecarClient } from './sidecarClient.ts';
import { useLibrary } from './libraryStore.ts';
import { useTransfers, type Transfer } from './transferStore.ts';

interface FakeClient {
  client: SidecarClient;
  calls: string[];
  /** Deliver an event to every subscriber of `name`. */
  emit(name: string, data: unknown): void;
  /** Resolve the next / all pending requests of `cmd` with `result`. */
  resolve(cmd: string, result: unknown): Promise<void>;
  /** Simulate a completed re-handshake. */
  bump(): void;
}

function fakeClient(): FakeClient {
  const calls: string[] = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const waiting = new Map<string, Array<(value: unknown) => void>>();
  let generation = 0;
  const genListeners = new Set<(g: number) => void>();

  const client: SidecarClient = {
    request<T>(cmd: string) {
      calls.push(cmd);
      return new Promise<T>((res) => {
        const q = waiting.get(cmd) ?? [];
        q.push(res as (value: unknown) => void);
        waiting.set(cmd, q);
      });
    },
    on(event, fn) {
      const set = listeners.get(event) ?? new Set();
      // Same erasure the real client performs: one untyped registry.
      set.add(fn as (data: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(fn as (data: unknown) => void);
    },
    onPhase: () => () => {},
    phase: 'open',
    get generation() { return generation; },
    onGeneration(fn) {
      genListeners.add(fn);
      return () => genListeners.delete(fn);
    },
    open() {}, close() {}, start() {}, stop() {}, setRate() {},
    running: false,
  };

  return {
    client,
    calls,
    emit(name, data) {
      for (const fn of listeners.get(name) ?? []) fn(data);
    },
    async resolve(cmd, result) {
      const q = waiting.get(cmd) ?? [];
      waiting.set(cmd, []);
      await act(async () => {
        for (const res of q) res(result);
        await Promise.resolve();
      });
    },
    bump() {
      act(() => {
        generation += 1;
        for (const fn of genListeners) fn(generation);
      });
    },
  };
}

function mkTransfer(id: string, over: Partial<Transfer> = {}): Transfer {
  return {
    id, direction: 'download', username: 'u', path: `music\\${id}.flac`,
    localFolder: null, size: 100, bytesDone: 0, state: 'queued', speed: 0,
    averageSpeed: 0, queuePosition: null, secondsLeft: null, secondsElapsed: 0,
    stalled: false, secondsSinceProgress: 0, finishedAt: null, error: null,
    ...over,
  };
}

describe('store resync on reconnect', () => {
  afterEach(cleanup);

  it('useLibrary refetches its snapshot when the generation bumps', () => {
    const fake = fakeClient();
    renderHook(() => useLibrary(fake.client));

    const before = fake.calls.filter((c) => c === 'library.state').length;
    expect(before).toBeGreaterThan(0);

    fake.bump();
    expect(fake.calls.filter((c) => c === 'library.state').length)
      .toBe(before + 1);
    expect(fake.calls.filter((c) => c === 'library.owned').length)
      .toBeGreaterThan(1);
  });

  it('useTransfers sweeps what the reconnect snapshot no longer lists', async () => {
    // The sweep compares seenAt stamps against the request time; in a test
    // everything lands in the same millisecond, so make the clock move.
    let now = 1_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
    try {
    const fake = fakeClient();
    const { result } = renderHook(() => useTransfers(fake.client));

    // First snapshot: one transfer, plus one that arrives by event only.
    await fake.resolve('transfer.list', { transfers: [mkTransfer('a')] });
    act(() => fake.emit('transfer.added', mkTransfer('b')));
    // The event path publishes on a timer; the reconnect publish below will
    // fold it in, so no need to wait for the tick here.

    // Reconnect: the engine now only knows about `a` — `b` was removed while
    // the socket was down and its transfer.removed event is gone forever.
    fake.bump();
    await fake.resolve('transfer.list', { transfers: [mkTransfer('a')] });

    await waitFor(() => {
      const ids = result.current.all.map((t) => t.id);
      expect(ids).toEqual(['a']);
    });
    } finally {
      clock.mockRestore();
    }
  });
});
