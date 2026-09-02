/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A controllable stand-in for the browser WebSocket, shared by the client
 * tests: install with vi.stubGlobal('WebSocket', FakeWebSocket), then
 * steer each instance through serverOpen/serverReply/serverDrop.
 */

export class FakeWebSocket {
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
