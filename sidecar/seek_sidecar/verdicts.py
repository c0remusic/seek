# Seek — remembered spectral verdicts.
# Copyright (C) 2026 Seek contributors.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# A spectral verdict is the most expensive answer this app computes — a full
# decode plus FFT — about a file that is permanent. Until this store existed
# the answer lived only in the frontend's memory and evaporated on every
# restart, so "strong signs of a lossy source" found on Tuesday was gone by
# Wednesday and the file had to be decoded again to learn it.
#
# Only the SUMMARY is kept. The spectrum curve and heatmap are tens of
# kilobytes per file and they are the verdict's decoration, recomputable on
# demand from the bytes that are still on disk; the verdict itself is the
# archive, a couple hundred bytes of scalars.
#
# Same shape as library.LibraryIndex, for the same reason: its own file and
# its own lock, so the analysis worker thread can write here without racing
# the main loop's read-modify-write of seek-state.json (_save_state holds no
# lock — sharing that file from a worker would silently drop concurrent
# updates).

import json
import logging
import os
import threading
import time

log = logging.getLogger("seek.verdicts")

# The payload fields worth keeping. Everything else in an analysis.result —
# spectrumHz/Db, heatmap*, fftSize, windowCount, requestId — is either bulk
# chart data or per-request bookkeeping, neither of which is the finding.
_SUMMARY_FIELDS = (
    "path", "transferId", "assessment", "confidence",
    "cutoffHz", "shelfDropDb", "shelfWidthHz", "impliedSourceKbps",
    "sampleRate", "durationSeconds", "declaredLossless", "decodedWith",
)


class VerdictStore:
    """Persisted spectral verdicts, keyed by absolute local path."""

    def __init__(self, store_path):
        self.store_path = store_path
        self._lock = threading.Lock()
        self._data = {}
        self._load()

    # -- persistence -------------------------------------------------------

    def _load(self):
        try:
            with open(self.store_path, encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                # Only dict-shaped entries survive: a truncated write or a
                # hand-edit degrades to "not remembered", never to a crash.
                self._data = {
                    path: entry for path, entry in data.items()
                    if isinstance(entry, dict)
                }
        except (OSError, ValueError):
            pass

    def _save_locked(self):
        """Write the store. Caller holds the lock."""
        try:
            os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
            with open(self.store_path, "w", encoding="utf-8") as handle:
                json.dump(self._data, handle)
        except OSError:
            log.exception("could not persist spectral verdicts")

    # -- writes ------------------------------------------------------------

    def record(self, payload, file_size, file_mtime):
        """Remember one finished analysis. Safe from any thread.

        `file_size`/`file_mtime` are the staleness fingerprint: a re-download
        of the same path is a different file and must not inherit the old
        file's verdict.
        """
        path = payload.get("path")
        if not path:
            return
        entry = {field: payload.get(field) for field in _SUMMARY_FIELDS}
        entry["analysedAt"] = int(time.time())
        entry["fileSize"] = int(file_size)
        entry["fileMtime"] = float(file_mtime)
        with self._lock:
            self._data[path] = entry
            self._save_locked()

    # -- reads -------------------------------------------------------------

    def snapshot(self):
        """Every verdict whose file is still the file that was analysed.

        Entries whose file is gone, or whose size/mtime no longer match, are
        pruned — and the prune is persisted, so a deleted download does not
        haunt the store forever.
        """
        with self._lock:
            kept = {}
            for path, entry in self._data.items():
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                if (int(stat.st_size) != entry.get("fileSize")
                        or abs(float(stat.st_mtime) - float(entry.get("fileMtime") or 0)) > 1.0):
                    continue
                kept[path] = entry
            if len(kept) != len(self._data):
                self._data = kept
                self._save_locked()
            return list(kept.values())
