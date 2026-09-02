/*
 * Seek — where a search looks.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine has always supported searching everyone, buddies only, one room,
 * or one user's shares (SearchStartParams); the client hardcoded 'global' and
 * the other modes were unreachable. This is the control that unlocks them —
 * a compact pill beside the search field, popover mechanics matched to
 * ViewMenu (same outside-pointerdown/Escape close, same anchoring) and its
 * classes reused so the two menus read as one family.
 *
 * A rooms/user scope cannot be committed incomplete: the sidecar schema
 * requires `room` for mode 'rooms' and a non-empty `users` for mode 'user',
 * so an invalid frame is unrepresentable from here. 'wishlist' is deliberately
 * absent — it is a background server-side search, and the want list already
 * owns that concept.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { SearchScope } from '../data/mockSidecar.ts';

function label(scope: SearchScope): string {
  switch (scope.mode) {
    case 'buddies': return 'Buddies';
    case 'rooms': return `Room: ${scope.room ?? ''}`;
    case 'user': return `User: ${scope.users[0] ?? ''}`;
    default: return 'Everyone';
  }
}

export function ScopePicker({ scope, onChange, joinedRooms = [] }: {
  scope: SearchScope;
  onChange(next: SearchScope): void;
  /** Rooms the user has joined, offered as one-click room scopes. */
  joinedRooms?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [roomDraft, setRoomDraft] = useState('');
  const [userDraft, setUserDraft] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next: SearchScope) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="viewmenu scopepick" ref={wrapRef}>
      <button
        type="button"
        className="viewmenu__trigger pressable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        /* A user nobody knows returns zero results with no protocol error, so
         * the title says where the search will look — the only warning there
         * is room for. */
        title="Where this tab's searches look. An unknown user or room simply returns nothing."
        onClick={() => setOpen((v) => !v)}
      >
        <span className="viewmenu__label">{label(scope)}</span>
      </button>

      {open && (
        <div className="viewmenu__pop" id={id} role="menu" aria-label="Search scope">
          <button
            type="button" role="menuitemradio" className="viewmenu__item"
            aria-checked={scope.mode === 'global'}
            onClick={() => pick({ mode: 'global', room: null, users: [] })}
          >
            <span className="viewmenu__text">
              <span className="viewmenu__item-label">Everyone</span>
              <span className="viewmenu__item-hint">The whole network</span>
            </span>
          </button>
          <button
            type="button" role="menuitemradio" className="viewmenu__item"
            aria-checked={scope.mode === 'buddies'}
            onClick={() => pick({ mode: 'buddies', room: null, users: [] })}
          >
            <span className="viewmenu__text">
              <span className="viewmenu__item-label">Buddies</span>
              <span className="viewmenu__item-hint">Only people you follow</span>
            </span>
          </button>

          <div className="viewmenu__section">Room</div>
          {joinedRooms.map((room) => (
            <button
              key={room}
              type="button" role="menuitemradio" className="viewmenu__item"
              aria-checked={scope.mode === 'rooms' && scope.room === room}
              onClick={() => pick({ mode: 'rooms', room, users: [] })}
            >
              <span className="viewmenu__text">
                <span className="viewmenu__item-label">{room}</span>
              </span>
            </button>
          ))}
          <form
            className="scopepick__row"
            onSubmit={(e) => {
              e.preventDefault();
              const room = roomDraft.trim();
              if (room) pick({ mode: 'rooms', room, users: [] });
            }}
          >
            <input
              className="scopepick__field"
              value={roomDraft}
              placeholder="Room name…"
              aria-label="Search a room by name"
              spellCheck={false}
              onChange={(e) => setRoomDraft(e.target.value)}
            />
          </form>

          <div className="viewmenu__section">User</div>
          <form
            className="scopepick__row"
            onSubmit={(e) => {
              e.preventDefault();
              const user = userDraft.trim();
              if (user) pick({ mode: 'user', room: null, users: [user] });
            }}
          >
            <input
              className="scopepick__field"
              value={userDraft}
              placeholder="Username…"
              aria-label="Search one user's shares"
              spellCheck={false}
              onChange={(e) => setUserDraft(e.target.value)}
            />
          </form>
        </div>
      )}
    </div>
  );
}
