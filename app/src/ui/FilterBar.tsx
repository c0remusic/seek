/*
 * Seek — the persistent filter bar.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Always visible, never behind a modal. Every control applies client-side and
 * instantly over the already-received set, and re-applies to results still
 * streaming in — which comes for free, because filtering runs inside the same
 * derivation the ingest tick triggers.
 *
 * "Reset" appears only when something is active. A permanently visible dead
 * control teaches people to ignore that corner of the screen.
 */

import { useState } from 'react';
import type { Filters } from '../domain/types.ts';
import { filtersActive } from '../domain/types.ts';
import type { FilterPreset } from '../data/filterPrefs.ts';
import { deletePreset, loadPresets, savePreset } from '../data/filterPrefs.ts';
import { Chip, NumberField, Select, Toggle } from './controls.tsx';
import { IconClose } from '../icons/index.tsx';

const PRESET_LOSSLESS = 'my usual';

export function FilterBar({
  filters, onChange, onReset, availableFormats,
}: {
  filters: Filters;
  onChange(next: Filters): void;
  onReset(): void;
  availableFormats: string[];
}) {
  const active = filtersActive(filters);
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets);
  /** The inline name field, open while non-null. No window.prompt in a WebView. */
  const [naming, setNaming] = useState<string | null>(null);

  const patch = (p: Partial<Filters>) => onChange({ ...filters, ...p });

  const toggleFormat = (label: string) => {
    const next = new Set(filters.formats);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    patch({ formats: next });
  };

  const applyPreset = () =>
    onChange({
      ...filters,
      losslessOnly: true,
      freeSlotsOnly: true,
      excludeTranscodes: true,
    });

  return (
    <div className="filters" role="group" aria-label="Filter results">
      <div className="filters__line">
        <span className="filters__label">Format</span>
        <div className="filters__chips">
          {availableFormats.slice(0, 9).map((f) => (
            <Chip key={f} active={filters.formats.has(f)} onToggle={() => toggleFormat(f)}>
              {f}
            </Chip>
          ))}
        </div>

        <span className="filters__divider" aria-hidden />

        <Toggle
          checked={filters.losslessOnly}
          onChange={(v) => patch({ losslessOnly: v })}
          label="Lossless only"
        />
        <Toggle
          checked={filters.excludeTranscodes}
          onChange={(v) => patch({ excludeTranscodes: v })}
          label="No transcodes"
        />
        <Toggle
          checked={filters.freeSlotsOnly}
          onChange={(v) => patch({ freeSlotsOnly: v })}
          label="Free slots"
        />
        <Toggle
          checked={filters.hideCompilations}
          onChange={(v) => patch({ hideCompilations: v })}
          label="Hide compilations"
        />

        <span className="filters__label" title="Hide release folders holding fewer files than this — albums only. Applies to the Release view; the Track and User views have no folders to be short.">
          Albums only ≥
        </span>
        <NumberField
          label="Hide release folders with fewer files than this"
          value={filters.minFolderTracks}
          onChange={(v) => patch({ minFolderTracks: v })}
          placeholder="off"
          width="3.5rem"
        />
      </div>

      <div className="filters__line filters__line--numeric">
        <span className="filters__label">Min bitrate</span>
        <NumberField
          label="Minimum bitrate in kbps"
          value={filters.minBitrate}
          onChange={(v) => patch({ minBitrate: v })}
          placeholder="any"
          suffix="kbps"
        />

        <span className="filters__label">Length</span>
        <NumberField
          label="Minimum duration in seconds"
          value={filters.durationMin}
          onChange={(v) => patch({ durationMin: v })}
          placeholder="min"
          suffix="s"
          width="3.75rem"
        />
        <span className="filters__to" aria-hidden>–</span>
        <NumberField
          label="Maximum duration in seconds"
          value={filters.durationMax}
          onChange={(v) => patch({ durationMax: v })}
          placeholder="max"
          suffix="s"
          width="3.75rem"
        />

        <span className="filters__label">Size</span>
        <NumberField
          label="Minimum file size in megabytes"
          value={filters.sizeMin === null ? null : Math.round(filters.sizeMin / 1048576)}
          onChange={(v) => patch({ sizeMin: v === null ? null : v * 1048576 })}
          placeholder="min"
          suffix="MB"
          width="3.75rem"
        />
        <span className="filters__to" aria-hidden>–</span>
        <NumberField
          label="Maximum file size in megabytes"
          value={filters.sizeMax === null ? null : Math.round(filters.sizeMax / 1048576)}
          onChange={(v) => patch({ sizeMax: v === null ? null : v * 1048576 })}
          placeholder="max"
          suffix="MB"
          width="3.75rem"
        />

        <span className="filters__label">Min speed</span>
        <NumberField
          label="Minimum advertised peer speed in kilobytes per second"
          value={filters.minSpeed === null ? null : Math.round(filters.minSpeed / 1024)}
          onChange={(v) => patch({ minSpeed: v === null ? null : v * 1024 })}
          placeholder="any"
          suffix="KB/s"
          width="4.25rem"
        />

        <span className="filters__label">Max queue</span>
        <NumberField
          label="Exclude peers with more than this many files queued"
          value={filters.maxQueue}
          onChange={(v) => patch({ maxQueue: v })}
          placeholder="any"
          width="3.5rem"
        />

        {/* Proof floors, not preferences: a file that advertises no sample
            rate or bit depth FAILS them (see matches() for why the null rule
            is the opposite of Min bitrate's). */}
        <span className="filters__label">Bit depth</span>
        <Select
          label="Keep only files proven to be at least this bit depth"
          value={filters.bitDepthMin === null ? 'any' : String(filters.bitDepthMin)}
          onChange={(v) => patch({ bitDepthMin: v === 'any' ? null : Number(v) })}
          options={[
            { value: 'any', label: 'any' },
            { value: '16', label: '≥ 16-bit' },
            { value: '24', label: '≥ 24-bit' },
          ]}
        />

        <span className="filters__label">Sample rate</span>
        <Select
          label="Keep only files proven to be at least this sample rate"
          value={filters.sampleRateMin === null ? 'any' : String(filters.sampleRateMin)}
          onChange={(v) => patch({ sampleRateMin: v === 'any' ? null : Number(v) })}
          options={[
            { value: 'any', label: 'any' },
            { value: '44100', label: '≥ 44.1 kHz' },
            { value: '48000', label: '≥ 48 kHz' },
            { value: '88200', label: '≥ 88.2 kHz' },
            { value: '96000', label: '≥ 96 kHz' },
            { value: '176400', label: '≥ 176.4 kHz' },
            { value: '192000', label: '≥ 192 kHz' },
          ]}
        />
      </div>

      <div className="filters__line">
        <input
          className="filters__text"
          type="search"
          value={filters.include}
          placeholder="Filename contains…"
          aria-label="Only show files whose name contains these words"
          onChange={(e) => patch({ include: e.target.value })}
        />
        <input
          className="filters__text"
          type="search"
          value={filters.exclude}
          placeholder="Exclude…"
          aria-label="Hide files whose name contains these words"
          onChange={(e) => patch({ exclude: e.target.value })}
        />

        <button type="button" className="preset pressable" onPointerDown={applyPreset}>
          {PRESET_LOSSLESS}
        </button>

        {/* User presets apply WHOLESALE — the saved set replaces the current
          * one, formats included — where "my usual" above deliberately keeps
          * PATCHING on top of whatever is set. A preset is "the filters I saved
          * that day"; anything less than exact restoration makes saving one
          * pointless. */}
        {presets.map((p) => (
          <span key={p.name} className="preset__wrap">
            <button
              type="button"
              className="preset pressable"
              onPointerDown={() => onChange(p.filters)}
            >
              {p.name}
            </button>
            <button
              type="button"
              className="tabs__close"
              aria-label={`Delete preset ${p.name}`}
              onClick={() => setPresets(deletePreset(p.name))}
            >
              ×
            </button>
          </span>
        ))}

        {active && naming === null && (
          <button
            type="button"
            className="preset pressable"
            onPointerDown={() => setNaming('')}
          >
            Save preset…
          </button>
        )}
        {naming !== null && (
          <form
            className="preset__form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = naming.trim();
              if (!name) return;
              setPresets(savePreset(name, filters));
              setNaming(null);
            }}
          >
            <input
              className="filters__text"
              value={naming}
              placeholder="Preset name…"
              aria-label="Name this filter preset"
              autoFocus
              spellCheck={false}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }}
            />
          </form>
        )}

        <div className="filters__reset-slot">
          {active && (
            <button type="button" className="reset pressable" onPointerDown={onReset}>
              <IconClose size={13} painted={1.7} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
