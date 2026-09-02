// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two behaviours share one row and must not blur together: "my usual" PATCHES
 * on top of the current filters (its long-standing contract), while a saved
 * preset replaces them WHOLESALE — Set restored exactly, everything else
 * overwritten. The CRUD half pins upsert-by-name and that corrupt storage
 * reads as no presets, never a crash.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterBar } from './FilterBar.tsx';
import { deletePreset, loadPresets, savePreset } from '../data/filterPrefs.ts';
import { EMPTY_FILTERS } from '../domain/types.ts';
import type { Filters } from '../domain/types.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const CLUB: Filters = {
  ...EMPTY_FILTERS, formats: new Set(['FLAC', 'WAV']), minBitrate: 320, freeSlotsOnly: true,
};

describe('preset storage', () => {
  it('saves, upserts by name, deletes', () => {
    savePreset('club', CLUB);
    savePreset('radio', { ...EMPTY_FILTERS, formats: new Set(), losslessOnly: true });
    expect(loadPresets().map((p) => p.name)).toEqual(['club', 'radio']);

    savePreset('club', { ...EMPTY_FILTERS, formats: new Set(['AIFF']) });
    const presets = loadPresets();
    expect(presets).toHaveLength(2);
    expect([...presets.find((p) => p.name === 'club')!.filters.formats]).toEqual(['AIFF']);

    expect(deletePreset('club').map((p) => p.name)).toEqual(['radio']);
    expect(loadPresets().map((p) => p.name)).toEqual(['radio']);
  });

  it('corrupt or foreign-shaped storage reads as no presets', () => {
    localStorage.setItem('seek.filterPresets.v1', '{not even json');
    expect(loadPresets()).toEqual([]);
    localStorage.setItem('seek.filterPresets.v1', JSON.stringify([{ noName: true }, 3]));
    expect(loadPresets()).toEqual([]);
  });
});

describe('FilterBar presets', () => {
  function renderBar(filters: Filters, onChange = vi.fn((_f: Filters) => {})) {
    render(
      <FilterBar filters={filters} onChange={onChange} onReset={() => {}} availableFormats={[]} />,
    );
    return onChange;
  }

  it('saving names the current filters through the inline field', () => {
    renderBar(CLUB);
    fireEvent.pointerDown(screen.getByText('Save preset…'));
    const field = screen.getByLabelText('Name this filter preset');
    fireEvent.change(field, { target: { value: ' club ready ' } });
    fireEvent.submit(field);
    const saved = loadPresets();
    expect(saved.map((p) => p.name)).toEqual(['club ready']);
    expect([...saved[0].filters.formats]).toEqual(['FLAC', 'WAV']);
    // The field closed and the pill appeared.
    expect(screen.queryByLabelText('Name this filter preset')).toBeNull();
    expect(screen.getByText('club ready')).toBeTruthy();
  });

  it('applying a preset replaces the whole set, Set included', () => {
    savePreset('club', CLUB);
    const onChange = renderBar({ ...EMPTY_FILTERS, formats: new Set(['MP3']), exclude: 'live' });
    fireEvent.pointerDown(screen.getByText('club'));
    const applied = onChange.mock.calls[0][0];
    expect([...applied.formats]).toEqual(['FLAC', 'WAV']);
    expect(applied.minBitrate).toBe(320);
    // Wholesale: nothing of the previous set survives.
    expect(applied.exclude).toBe('');
  });

  it('the × deletes a preset for good', () => {
    savePreset('club', CLUB);
    renderBar(EMPTY_FILTERS);
    fireEvent.click(screen.getByLabelText('Delete preset club'));
    expect(screen.queryByText('club')).toBeNull();
    expect(loadPresets()).toEqual([]);
  });

  it('"my usual" still patches instead of replacing', () => {
    const onChange = renderBar({ ...EMPTY_FILTERS, formats: new Set(['MP3']), include: 'dub' });
    fireEvent.pointerDown(screen.getByText('my usual'));
    const patched = onChange.mock.calls[0][0];
    expect(patched.losslessOnly).toBe(true);
    // Patch, not replace: what was set stays set.
    expect([...patched.formats]).toEqual(['MP3']);
    expect(patched.include).toBe('dub');
  });
});
