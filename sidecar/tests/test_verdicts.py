# Seek — persisted spectral verdicts.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# The store's whole contract is "a verdict survives a restart, but never
# outlives the file it judged". Both halves are pinned: the summary round-trips
# through a fresh store, and any change to the file — gone, rewritten, replaced
# by a re-download — evicts the verdict instead of letting a new file inherit
# the old file's reputation.

import json
import os

from seek_sidecar.verdicts import VerdictStore


def _audio(tmp_path, name="track.flac", contents=b"\0" * 64):
    path = str(tmp_path / name)
    with open(path, "wb") as handle:
        handle.write(contents)
    return path


def _payload(path, **over):
    base = {
        "requestId": "req-1",
        "path": path,
        "transferId": "t-1",
        "assessment": "strong_signs_of_lossy_source",
        "confidence": 0.82,
        "cutoffHz": 16400.0,
        "shelfDropDb": 61.0,
        "shelfWidthHz": 500.0,
        "impliedSourceKbps": 160,
        "sampleRate": 44100,
        "durationSeconds": 231.4,
        "declaredLossless": True,
        "decodedWith": "soundfile",
        # Bulk that must NOT be persisted.
        "spectrumHz": [1.0] * 256,
        "spectrumDb": [-3.0] * 256,
        "heatmapDb": [0.0] * 6144,
    }
    base.update(over)
    return base


def _record(store, path, **over):
    stat = os.stat(path)
    store.record(_payload(path, **over), stat.st_size, stat.st_mtime)


class TestVerdictStore:
    def test_a_verdict_survives_a_restart_as_its_summary(self, tmp_path):
        store_path = str(tmp_path / "spectral-verdicts.json")
        audio = _audio(tmp_path)
        _record(VerdictStore(store_path), audio)

        reopened = VerdictStore(store_path).snapshot()
        assert len(reopened) == 1
        entry = reopened[0]
        assert entry["path"] == audio
        assert entry["assessment"] == "strong_signs_of_lossy_source"
        assert entry["transferId"] == "t-1"
        assert entry["fileSize"] == 64
        # The decoration stayed out: only the finding is archived.
        assert "spectrumHz" not in entry
        assert "heatmapDb" not in entry

    def test_a_deleted_file_takes_its_verdict_with_it(self, tmp_path):
        store_path = str(tmp_path / "v.json")
        audio = _audio(tmp_path)
        store = VerdictStore(store_path)
        _record(store, audio)

        os.remove(audio)
        assert store.snapshot() == []
        # The prune is persisted, not just filtered from one answer.
        assert VerdictStore(store_path).snapshot() == []

    def test_a_rewritten_file_does_not_inherit_the_old_verdict(self, tmp_path):
        store_path = str(tmp_path / "v.json")
        audio = _audio(tmp_path)
        store = VerdictStore(store_path)
        _record(store, audio)

        # A re-download of the same path: different bytes, different size.
        with open(audio, "wb") as handle:
            handle.write(b"\1" * 128)
        assert store.snapshot() == []

    def test_recording_the_same_path_again_replaces_the_entry(self, tmp_path):
        store_path = str(tmp_path / "v.json")
        audio = _audio(tmp_path)
        store = VerdictStore(store_path)
        _record(store, audio, assessment="possible_transcode")
        _record(store, audio, assessment="likely_lossless")

        entries = store.snapshot()
        assert len(entries) == 1
        assert entries[0]["assessment"] == "likely_lossless"

    def test_a_corrupt_store_reads_as_empty(self, tmp_path):
        store_path = str(tmp_path / "v.json")
        with open(store_path, "w", encoding="utf-8") as handle:
            handle.write("{truncated")
        assert VerdictStore(store_path).snapshot() == []

        # And a foreign shape degrades entry-by-entry, not wholesale.
        audio = _audio(tmp_path)
        with open(store_path, "w", encoding="utf-8") as handle:
            json.dump({"junk": 42, audio: {"fileSize": 64, "fileMtime": os.stat(audio).st_mtime,
                                           "assessment": "likely_lossless"}}, handle)
        entries = VerdictStore(store_path).snapshot()
        assert [e["assessment"] for e in entries] == ["likely_lossless"]
