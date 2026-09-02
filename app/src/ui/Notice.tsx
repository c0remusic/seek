/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * The render half of noticeStore: one fixed strip for the failures that have
 * no panel of their own. Sits beside the update banner, which is the same
 * kind of surface — app-level, occasional, dismissible.
 */

import { dismissNotice, useNotice } from '../data/noticeStore.ts';

export function Notice() {
  const notice = useNotice();
  if (!notice) return null;
  return (
    <div className="notice" data-tone={notice.tone} role="alert">
      <span className="notice__text">{notice.text}</span>
      <button type="button" className="notice__dismiss pressable" onClick={dismissNotice}>
        Dismiss
      </button>
    </div>
  );
}
