/*
 * Seek — text normalisation shared by the parser, the deduper and the filters.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Strip diacritics so "Björk" and "Bjork" dedupe together. */
export function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Collapse runs of whitespace and trim. */
export function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Trim the punctuation and separator debris that path fragments collect at
 * their edges. Deliberately does NOT touch the interior: `Track (Remix)` and
 * `Song [Extended]` must survive intact — a remix name is load-bearing for a DJ.
 */
export function trimEdges(s: string): string {
  return squash(s.replace(/^[\s\-–—_.,;:|·]+/, '').replace(/[\s\-–—_.,;:|·]+$/, ''));
}

/**
 * Underscores are a separator only when the string uses them *instead of*
 * spaces. `Aphex_Twin_-_Xtal` → spaces. `Track_1 (Live)` keeps its underscore,
 * because the string already proves it knows what a space is.
 */
export function relaxUnderscores(s: string): string {
  if (s.includes(' ')) return s;
  return s.replace(/_/g, ' ');
}

/** Fold the many dash characters onto a plain hyphen so one regex handles all. */
export function normaliseDashes(s: string): string {
  return s.replace(/[‐-―−]/g, '-');
}

/**
 * The key used for fuzzy identity. Aggressive: lowercase, no diacritics, no
 * punctuation, no leading article.
 *
 * One deliberate exception — `(original mix)` and friends are dropped, because
 * they are a no-op qualifier that half of Soulseek writes and half doesn't.
 * Every *other* parenthetical survives, because `(Ricardo Villalobos Remix)`
 * is a different record and merging it would be a lie.
 */
export function fuzzyKey(s: string): string {
  let t = deaccent(s).toLowerCase();
  t = t.replace(/[([]\s*(original|album|radio)\s+(mix|version|edit)\s*[)\]]/g, ' ');
  t = t.replace(/\b(feat|ft|featuring)\.?\s+/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ');
  t = t.replace(/^(the|a|an)\s+/, '');
  const key = squash(t);
  if (key) return key;
  /* The [a-z0-9] collapse empties anything written outside latin — a Cyrillic
   * or CJK title keyed to '' matched nothing and got dropped from grouping,
   * which is a silent no for entire catalogues. Fallback-ONLY, so a string
   * with any latin content keeps today's key and no existing group can
   * re-bucket. No article strip here: articles are a latin concern. */
  return squash(deaccent(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' '));
}

/**
 * One word of pure edition noise. Ported from the sidecar's enrich._NOISE —
 * plus the connective vocabulary editions use around it — so both sides mean
 * the same thing by "noise".
 */
const EDITION_NOISE_WORD =
  /^(?:remaster(?:ed)?|deluxe|expanded|explicit|bonus|reissue|mono|stereo|web|vinyl|cd|flac|mp3|24bit|16bit|\d{3,4}kbps|edition|anniversary|version|\d{4})$/i;

/**
 * Drop a bracketed segment from a release title ONLY when its entire content
 * is edition noise. "(2019 Reissue)" and "(Deluxe Edition)" go — no peer's
 * folder is named that way, and a query token nobody's path contains returns
 * nothing. "(Ricardo Villalobos Remix)" and "[Hyperdub]" survive, because a
 * remix is a different record and a label is a real discriminator — the same
 * all-or-nothing rule fuzzyKey applies to "(Original Mix)".
 */
export function stripReleaseNoise(title: string): string {
  const out = title.replace(/[([][^)\]]*[)\]]/g, (seg) => {
    const words = seg.slice(1, -1).split(/[\s.,&/-]+/).filter(Boolean);
    return words.length > 0 && words.every((w) => EDITION_NOISE_WORD.test(w))
      ? ' ' : seg;
  });
  return squash(out);
}

/** Folder names that never identify an artist. Used when climbing the path. */
const GENERIC_FOLDERS = new Set([
  'music', 'musik', 'musique', 'mp3', 'mp3s', 'flac', 'flacs', 'wav', 'wavs',
  'aiff', 'lossless', 'audio', 'sound', 'sounds', 'tracks', 'songs', 'albums',
  'album', 'downloads', 'download', 'downloaded', 'shared', 'share', 'sharing',
  'incoming', 'complete', 'completed', 'new', 'unsorted', 'misc', 'various',
  'va', 'various artists', 'compilations', 'singles', 'eps', 'ep', 'lp', 'lps',
  'dj', 'djs', 'sets', 'mixes', 'mixtapes', 'promo', 'promos', 'vinyl', 'rips',
  'my music', 'itunes', 'itunes music', 'media', 'library', 'collection',
  'soulseek', 'slsk', 'shares', 'public', 'files', 'folder', 'temp', 'tmp',
  'electronic', 'techno', 'house', 'ambient', 'jungle', 'dnb', 'drum and bass',
  'disco', 'dub', 'idm', 'breaks', 'garage', 'grime', 'hardcore', 'trance',
  'cd', 'cd1', 'cd2', 'disc', 'disc 1', 'disc 2', 'disk', 'scans', 'artwork',
]);

export function isGenericFolder(name: string): boolean {
  const k = squash(deaccent(name).toLowerCase().replace(/[_\-]+/g, ' '));
  return k === '' || GENERIC_FOLDERS.has(k) || /^(cd|disc|disk|vol|volume)\s*\d+$/.test(k);
}

const VARIOUS = /^(va|v\.a\.?|various(\s+artists)?)$/i;
export function isVariousArtists(name: string): boolean {
  return VARIOUS.test(squash(name.replace(/[_\-]+/g, ' ')));
}

/** Share-root segments Soulseek clients emit: `@@abcde`, `C:`, bare drive letters. */
export function isShareRoot(seg: string): boolean {
  return /^@@/.test(seg) || /^[a-zA-Z]:$/.test(seg) || seg === '';
}

/** Split a Soulseek path. The wire uses `\`; be liberal and accept `/` too. */
export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s.length > 0);
}
