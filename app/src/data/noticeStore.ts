/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * Seek — the one fixed address for failures that have no on-screen home.
 *
 * Most writes fire from context menus, the command palette, inline toggles
 * and the chat send box — places with nowhere to render an alert row. Their
 * `.catch(() => {})` made every rejection invisible: pressing Follow against
 * a sidecar that refused produced NOTHING. Screens that already own an error
 * surface (Downloads, Labels, the profile panel, transfers) keep it; this is
 * for everything that does not.
 *
 * A module singleton, deliberately not React state: the silent sites live in
 * data hooks (chatStore, wantStore, sessionStore) and plain callbacks, and a
 * React-owned store would mean threading a reporter through props into every
 * one of them. The singleton makes each fix a one-line `.catch(...)`.
 *
 * One notice, latest wins. These are one-shot writes, not a work queue — a
 * stack of stale toasts trains people to stop reading them.
 */

import { useSyncExternalStore } from 'react';
import { EngineBusyError } from './sidecarClient.ts';
import { readableError } from '../domain/folders.ts';

export interface Notice {
  id: number;
  /** 'busy' is not a failure: the engine is alive and the command is queued. */
  tone: 'error' | 'busy';
  text: string;
}

/** Long enough to read twice, short enough not to become furniture. */
const AUTO_CLEAR_MS = 8_000;

let current: Notice | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(notice: Notice | null): void {
  current = notice;
  if (timer !== undefined) clearTimeout(timer);
  timer = notice === null
    ? undefined
    : setTimeout(() => { current = null; timer = undefined; notify(); }, AUTO_CLEAR_MS);
  notify();
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function pushNotice(tone: Notice['tone'], text: string): void {
  set({ id: nextId++, tone, text });
}

export function dismissNotice(): void {
  set(null);
}

/** The current notice as React state. */
export function useNotice(): Notice | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
  );
}

/**
 * The standard tail for a fire-and-forget write:
 * `void client.request('buddies.add', …).catch(reportFailure('follow x'))`.
 *
 * EngineBusyError gets its own sentence, because the difference decides what
 * a person reads: "could not" says the change was refused; "still working"
 * says the engine is alive and the command is queued behind something slow —
 * see EngineBusyError's own doc comment for why those must never blur.
 */
export function reportFailure(action: string): (error: unknown) => void {
  return (error) => {
    if (error instanceof EngineBusyError) {
      pushNotice('busy', `Still working — "${action}" has not been confirmed yet.`);
    } else {
      pushNotice('error', `Could not ${action}: ${readableError(error)}`);
    }
  };
}

/** Test seam: reset the singleton between cases. */
export function resetNoticesForTest(): void {
  set(null);
  nextId = 1;
}
