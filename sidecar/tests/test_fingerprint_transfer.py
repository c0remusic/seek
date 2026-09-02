# Seek — discover.fingerprint by transferId.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# The sift path (fpcalc + AcoustID) existed only for a file named by absolute
# path, which the Downloads screen never knows — it knows transfers. This pins
# the extension: a transferId resolves to the FINISHED file through the same
# resolver metadata and spectral use, and a transfer still moving is refused
# rather than fingerprinting half a file.

import pytest

from seek_sidecar.core_host import CommandError, CoreHost


class FakeBridge:
    def __init__(self):
        self.events = []

    def broadcast(self, name, data):
        self.events.append((name, data))


class InlinePool:
    """submit() runs the task synchronously — the pool is not what's tested."""

    def submit(self, fn, *args):
        fn(*args)


class FakeUpstream:
    def __init__(self, status):
        self.status = status


class FakeTransfers:
    def __init__(self, record):
        self._record = record

    def get(self, transfer_id):
        return self._record if transfer_id == "t-1" else None


class Host:
    """The fingerprint command, unbound from pynicotine (test_want_list idiom)."""

    METHODS = ("_cmd_discover_fingerprint", "_resolve_local_file",
               "_run_fingerprint")

    def __init__(self, upstream_status, local_path):
        self.bridge = FakeBridge()
        self._discover_pool = InlinePool()
        self.transfers = FakeTransfers(record=object())
        self._upstream = FakeUpstream(upstream_status)

        class Downloads:
            @staticmethod
            def get_current_download_file_path(_upstream, _path=local_path):
                return _path

        class Core:
            downloads = Downloads()

        self.core = Core()
        for name in self.METHODS:
            setattr(self, name, getattr(CoreHost, name).__get__(self))

    def _lookups_allowed(self):
        return True

    def _acoustid_key(self):
        return "test-key"

    def _find_upstream_transfer(self, _record):
        return self._upstream


def _audio(tmp_path):
    path = str(tmp_path / "01 archangel.flac")
    with open(path, "wb") as handle:
        handle.write(b"\0" * 64)
    return path


def test_a_finished_transfer_is_identified_by_its_file(tmp_path, monkeypatch):
    audio = _audio(tmp_path)
    host = Host(upstream_status="Finished", local_path=audio)

    seen = {}

    def fake_identify(path, key, seconds):
        seen.update(path=path, key=key)
        return {"path": path, "matched": True, "artist": "Burial",
                "title": "Archangel", "album": None, "year": None,
                "mbid": None, "score": 0.99, "durationSeconds": 120.0}

    monkeypatch.setattr("seek_sidecar.discover.identify", fake_identify)
    result = host._cmd_discover_fingerprint({"path": None, "transferId": "t-1"})

    assert seen["path"] == audio
    assert seen["key"] == "test-key"
    assert [name for name, _ in host.bridge.events] == ["discover.identified"]
    event = host.bridge.events[0][1]
    assert event["requestId"] == result["requestId"]
    assert event["artist"] == "Burial"


def test_an_unfinished_transfer_is_refused(tmp_path):
    audio = _audio(tmp_path)
    host = Host(upstream_status="Transferring", local_path=audio)
    with pytest.raises(CommandError) as caught:
        host._cmd_discover_fingerprint({"path": None, "transferId": "t-1"})
    assert caught.value.code == "bad_request"
    assert host.bridge.events == []


def test_an_explicit_path_still_wins(tmp_path, monkeypatch):
    audio = _audio(tmp_path)
    host = Host(upstream_status="Finished", local_path="/elsewhere/never-used")

    monkeypatch.setattr(
        "seek_sidecar.discover.identify",
        lambda path, key, seconds: {"path": path, "matched": False, "artist": "",
                                    "title": "", "album": None, "year": None,
                                    "mbid": None, "score": 0.0,
                                    "durationSeconds": 0.0},
    )
    host._cmd_discover_fingerprint({"path": audio, "transferId": "t-1"})
    assert host.bridge.events[0][1]["path"] == audio
