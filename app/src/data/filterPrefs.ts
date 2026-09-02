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
const PRESETS_KEY = 'seek.filterPresets.v1';

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

/* ------------------------------------------------------------- presets --- */

export interface FilterPreset {
  name: string;
  filters: Filters;
}

export function loadPresets(): FilterPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .filter((p) => typeof p.name === 'string' && p.name.trim() !== '')
      .map((p) => ({ name: p.name as string, filters: normaliseFilters(p.filters) }));
  } catch {
    return [];
  }
}

function persist(presets: FilterPreset[]): FilterPreset[] {
  try {
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify(presets.map((p) => ({ name: p.name, filters: toStorable(p.filters) }))),
    );
  } catch {
    // Same as above: no storage, no memory, no crash.
  }
  return presets;
}

/** Upsert by name — saving "club ready" twice replaces it, never duplicates. */
export function savePreset(name: string, filters: Filters): FilterPreset[] {
  const next = loadPresets().filter((p) => p.name !== name);
  next.push({ name, filters });
  return persist(next);
}

export function deletePreset(name: string): FilterPreset[] {
  return persist(loadPresets().filter((p) => p.name !== name));
}
