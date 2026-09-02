// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The notice store carries the SENTENCES people read when a fire-and-forget
 * write fails, so the sentences are what gets pinned — especially the
 * busy/refused split, which decides whether someone retries or waits.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pushNotice, reportFailure, resetNoticesForTest, useNotice,
} from './noticeStore.ts';
import { EngineBusyError } from './sidecarClient.ts';
import { Notice } from '../ui/Notice.tsx';

function currentNotice() {
  let value: ReturnType<typeof useNotice> = null;
  function Probe() {
    value = useNotice();
    return null;
  }
  render(createElement(Probe));
  return () => value;
}

describe('noticeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNoticesForTest();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('latest wins, and the notice expires on its own', () => {
    const read = currentNotice();
    act(() => pushNotice('error', 'first'));
    act(() => pushNotice('error', 'second'));
    expect(read()?.text).toBe('second');

    act(() => { vi.advanceTimersByTime(9_000); });
    expect(read()).toBeNull();
  });

  it('a refused write reads "could not", with the code prefix stripped', () => {
    const read = currentNotice();
    act(() => reportFailure('follow ldnbass')(new Error('bad_request: no such user')));
    expect(read()?.tone).toBe('error');
    expect(read()?.text).toBe('Could not follow ldnbass: no such user');
  });

  it('a busy engine reads "still working", never as a refusal', () => {
    const read = currentNotice();
    act(() => reportFailure('send that message')(new EngineBusyError('chat.say')));
    expect(read()?.tone).toBe('busy');
    expect(read()?.text).toContain('Still working');
    expect(read()?.text).toContain('send that message');
  });

  it('survives a non-Error rejection', () => {
    const read = currentNotice();
    act(() => reportFailure('do the thing')('exploded'));
    expect(read()?.text).toBe('Could not do the thing: exploded');
  });

  it('<Notice/> renders as an alert and Dismiss clears it', () => {
    act(() => pushNotice('error', 'visible failure'));
    render(createElement(Notice));
    expect(screen.getByRole('alert').textContent).toContain('visible failure');
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
