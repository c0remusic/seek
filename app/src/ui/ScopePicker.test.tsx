// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The picker is the only gate between the UI and the three non-global search
 * modes, so what's pinned is the contract: every committed scope is complete
 * (mode 'rooms' always carries a room, mode 'user' a user), and an incomplete
 * one cannot be committed at all.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScopePicker } from './ScopePicker.tsx';
import { GLOBAL_SCOPE } from '../data/mockSidecar.ts';
import type { SearchScope } from '../data/mockSidecar.ts';

afterEach(cleanup);

function open(scope: SearchScope = GLOBAL_SCOPE, joinedRooms: string[] = []) {
  const onChange = vi.fn((_next: SearchScope) => {});
  render(<ScopePicker scope={scope} onChange={onChange} joinedRooms={joinedRooms} />);
  fireEvent.click(screen.getByRole('button', { name: /everyone|buddies|room:|user:/i }));
  return onChange;
}

describe('ScopePicker', () => {
  it('reads "Everyone" by default and names a chosen room on the pill', () => {
    render(<ScopePicker scope={GLOBAL_SCOPE} onChange={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('Everyone');
    cleanup();
    render(
      <ScopePicker scope={{ mode: 'rooms', room: 'drum & bass', users: [] }} onChange={() => {}} />,
    );
    expect(screen.getByRole('button').textContent).toBe('Room: drum & bass');
  });

  it('picking Buddies commits a complete scope and closes the menu', () => {
    const onChange = open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /buddies/i }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'buddies', room: null, users: [] });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers each joined room as a one-click scope', () => {
    const onChange = open(GLOBAL_SCOPE, ['indie', 'techno']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'techno' }));
    expect(onChange).toHaveBeenCalledWith({ mode: 'rooms', room: 'techno', users: [] });
  });

  it('a user scope needs a name: empty submit commits nothing', () => {
    const onChange = open();
    const field = screen.getByLabelText("Search one user's shares");
    fireEvent.submit(field);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  ldnbass  ' } });
    fireEvent.submit(field);
    expect(onChange).toHaveBeenCalledWith({ mode: 'user', room: null, users: ['ldnbass'] });
  });

  it('a typed room name commits a rooms scope, trimmed', () => {
    const onChange = open();
    const field = screen.getByLabelText('Search a room by name');
    fireEvent.change(field, { target: { value: ' ambient ' } });
    fireEvent.submit(field);
    expect(onChange).toHaveBeenCalledWith({ mode: 'rooms', room: 'ambient', users: [] });
  });

  it('Escape closes without committing', () => {
    const onChange = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
