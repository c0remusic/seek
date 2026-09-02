// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scope's whole job is what goes ON THE WIRE: the sidecar validator
 * rejects a frame with missing keys, and a wrong default here is a search
 * that silently looks in the wrong place. So the frames are what gets pinned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSidecarClient, type SidecarClient } from './sidecarClient.ts';
import { FakeWebSocket } from './testing/fakeWebSocket.ts';

async function openAndGreet(client: SidecarClient): Promise<FakeWebSocket> {
  client.open();
  const ws = FakeWebSocket.instances[0];
  ws.serverOpen();
  await vi.advanceTimersByTimeAsync(0);
  const hello = ws.sent.map((r) => JSON.parse(r) as { id: string; cmd: string })
    .find((f) => f.cmd === 'hello');
  ws.serverReply({ id: hello!.id, ok: true, result: {} });
  await Promise.resolve();
  return ws;
}

function startFrame(ws: FakeWebSocket) {
  return ws.sent.map((r) => JSON.parse(r) as { cmd: string; params: Record<string, unknown> })
    .find((f) => f.cmd === 'search.start')?.params;
}

describe('search.start scope on the wire', () => {
  let client: SidecarClient;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    client = createSidecarClient({ host: '127.0.0.1', port: 1, token: 't' });
  });

  afterEach(() => {
    client.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('no scope sends the historical global defaults, every key present', async () => {
    const ws = await openAndGreet(client);
    client.start('burial', { onResult() {}, onClosed() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(startFrame(ws)).toEqual({
      query: 'burial', mode: 'global', room: null, users: [],
      resultCap: null, timeoutSeconds: null,
    });
  });

  it('a user scope reaches the sidecar as given', async () => {
    const ws = await openAndGreet(client);
    client.start('burial', { onResult() {}, onClosed() {} },
      { mode: 'user', room: null, users: ['ldnbass'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(startFrame(ws)).toMatchObject({ mode: 'user', users: ['ldnbass'] });
  });
});
