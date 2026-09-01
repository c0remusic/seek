/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The first test in the repo to drive createSidecarClient over a fake socket.
 * What it pins: the generation counter counts RE-handshakes — 0 across the
 * first hello, then one bump per successful hello after a drop — because
 * that is the contract the stores' resync effects are keyed on.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSidecarClient, type SidecarClient } from './sidecarClient.ts';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /* ---- test-side controls ---- */
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverDrop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  serverReply(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

/** Complete the hello round-trip on `ws` and flush the reply's microtasks. */
async function answerHello(ws: FakeWebSocket) {
  // The hello is sent a microtask AFTER onopen (request() rides whenOpen's
  // promise), so give the queue a turn before reading `sent`.
  await vi.advanceTimersByTimeAsync(0);
  const hello = ws.sent
    .map((raw) => JSON.parse(raw) as { id: string; cmd: string })
    .find((f) => f.cmd === 'hello');
  expect(hello).toBeTruthy();
  ws.serverReply({
    id: hello!.id,
    ok: true,
    result: {
      connection: { status: 'online' },
      sidecarVersion: 'test', coreVersion: 'test', logPath: '',
    },
  });
  // The .then chain behind request() needs two microtask turns.
  await Promise.resolve();
  await Promise.resolve();
}

describe('reconnect generation', () => {
  let client: SidecarClient;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    client.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stays 0 across the first hello, bumps once per reconnect after', async () => {
    const seen: number[] = [];
    client = createSidecarClient({ host: '127.0.0.1', port: 1, token: 't' });
    client.onGeneration((g) => seen.push(g));
    client.open();

    const first = FakeWebSocket.instances[0];
    first.serverOpen();
    await answerHello(first);
    expect(client.generation).toBe(0);
    expect(seen).toEqual([]);

    // Drop the socket; the client schedules a reconnect (500 ms floor).
    first.serverDrop();
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeWebSocket.instances[1];
    expect(second).toBeTruthy();
    second.serverOpen();
    await answerHello(second);
    expect(client.generation).toBe(1);
    expect(seen).toEqual([1]);

    second.serverDrop();
    await vi.advanceTimersByTimeAsync(1_100);
    const third = FakeWebSocket.instances[2];
    third.serverOpen();
    await answerHello(third);
    expect(client.generation).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribe stops the notifications, not the counter', async () => {
    const seen: number[] = [];
    client = createSidecarClient({ host: '127.0.0.1', port: 1, token: 't' });
    const off = client.onGeneration((g) => seen.push(g));
    client.open();

    const first = FakeWebSocket.instances[0];
    first.serverOpen();
    await answerHello(first);

    off();
    first.serverDrop();
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeWebSocket.instances[1];
    second.serverOpen();
    await answerHello(second);

    expect(seen).toEqual([]);
    expect(client.generation).toBe(1);
  });
});
