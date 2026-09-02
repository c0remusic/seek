# Seek — the analysis.verdicts command, and recording on analysis success.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# test_verdicts.py pins the store; this pins the seam around it: a finished
# analysis is archived before it is broadcast, the archive comes back through
# `analysis.verdicts` in the wire shape the schema promises, and a failed
# analysis records nothing.

import os

from seek_sidecar import protocol
from seek_sidecar.core_host import CoreHost


class FakeBridge:
    def __init__(self):
        self.events = []

    def broadcast(self, name, data):
        self.events.append((name, data))


class Host:
    """The analysis handlers, unbound from pynicotine (test_want_list idiom)."""

    METHODS = ("_verdicts", "_cmd_analysis_verdicts", "_run_analysis")

    def __init__(self, folder):
        self.data_folder = folder
        self.bridge = FakeBridge()
        for name in self.METHODS:
            setattr(self, name, getattr(CoreHost, name).__get__(self))


def _audio(tmp_path, name="track.flac"):
    path = str(tmp_path / name)
    with open(path, "wb") as handle:
        handle.write(b"\0" * 64)
    return path


def _payload(path):
    return {
        "requestId": "req-1", "path": path, "transferId": "t-9",
        "sampleRate": 44100, "channels": 2, "durationSeconds": 200.0,
        "decodedWith": "soundfile", "nyquistHz": 22050.0,
        "cutoffHz": 16400.0, "shelfDropDb": 61.0, "shelfWidthHz": 500.0,
        "confidence": 0.82, "assessment": "strong_signs_of_lossy_source",
        "declaredLossless": True, "impliedSourceKbps": 160,
        "spectrumHz": [20.0], "spectrumDb": [0.0],
        "heatmapDb": [], "heatmapTimeBins": 0, "heatmapFreqBins": 0,
        "fftSize": 8192, "windowCount": 4, "analysedSeconds": 0.7,
    }


def test_a_finished_analysis_is_archived_and_comes_back_on_the_wire(
        tmp_path, monkeypatch):
    host = Host(str(tmp_path))
    audio = _audio(tmp_path)
    monkeypatch.setattr("seek_sidecar.spectral.analyse",
                        lambda p, request_id="", transfer_id=None: _payload(p))

    host._run_analysis("req-1", audio, "t-9")

    assert [name for name, _ in host.bridge.events] == ["analysis.result"]
    result = host._cmd_analysis_verdicts({})
    protocol.validate_result("analysis.verdicts", result)
    assert len(result["verdicts"]) == 1
    verdict = result["verdicts"][0]
    assert verdict["path"] == audio
    assert verdict["transferId"] == "t-9"
    assert verdict["assessment"] == "strong_signs_of_lossy_source"


def test_a_failed_analysis_records_nothing(tmp_path, monkeypatch):
    host = Host(str(tmp_path))
    audio = _audio(tmp_path)

    def explode(_path, request_id="", transfer_id=None):
        from seek_sidecar.spectral import AnalysisError
        raise AnalysisError("digital silence")

    monkeypatch.setattr("seek_sidecar.spectral.analyse", explode)
    host._run_analysis("req-1", audio, None)

    assert [name for name, _ in host.bridge.events] == ["analysis.failed"]
    assert host._cmd_analysis_verdicts({}) == {"verdicts": []}


def test_a_retouched_file_is_pruned_from_the_next_listing(tmp_path, monkeypatch):
    host = Host(str(tmp_path))
    audio = _audio(tmp_path)
    monkeypatch.setattr("seek_sidecar.spectral.analyse",
                        lambda p, request_id="", transfer_id=None: _payload(p))
    host._run_analysis("req-1", audio, None)
    assert len(host._cmd_analysis_verdicts({})["verdicts"]) == 1

    with open(audio, "wb") as handle:
        handle.write(b"\1" * 999)
    assert host._cmd_analysis_verdicts({}) == {"verdicts": []}
