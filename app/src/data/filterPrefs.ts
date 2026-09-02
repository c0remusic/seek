/*
 * Seek — remembered filters.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * localStorage, like density and columns and for the same reason: which
 * filters you reach for is a preference about how you search from this
 * machine, not account state the sidecar has any use for. Everything read
 * back goes through normaliseFilters — stored blobs outlive the code that
 * wrote them.
 *
 * Serialisation note: Filters carries a Set, which JSON.stringify silently
 * turns into `{}`. Both writers here spread it into an array first, the same
 * dance serialiseFilters does for saved searches.
 */

import type { Filters } from '../domain/types.ts';
import { normaliseFilters } from '../domain/types.ts';

const LAST_KEY = 'seek.filters.v1';

function toStorable(f: Filters): Record<string, unknown> {
  return { ...f, formats: [...f.formats] };
}

/** The filters the last real search ran with. Decides the first tab's start. */
export function loadLastFilters(): Filters {
  try {
    return normaliseFilters(JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null'));
  } catch {
    return normaliseFilters(null);
  }
}

export function saveLastFilters(f: Filters): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(toStorable(f)));
  } catch {
    // A machine with storage disabled just doesn't remember. Nothing breaks.
  }
}
