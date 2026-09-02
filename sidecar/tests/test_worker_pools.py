# Seek — the background pools, and why there are three.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# All background work used to share ONE worker, so an artwork lookup sleeping
# in the MusicBrainz gate — or a minutes-long library walk — held the only
# thread while a spectral analysis the user just asked for sat in the queue.
# This pins the separation: a lookup that never returns must not delay an
# analysis. It proves the queues are distinct, not anything about scheduling.

import threading
from concurrent.futures import ThreadPoolExecutor

from seek_sidecar.core_host import CoreHost


class FakeBridge:
    def __init__(self):
        self.events = []
        self.got_one = threading.Event()

    def broadcast(self, name, data):
        self.events.append((name, data))
        self.got_one.set()


class Host:
    """The analysis worker body, unbound from pynicotine (test_want_list idiom),
    over real single-worker pools shaped like CoreHost's."""

    def __init__(self):
        self.bridge = FakeBridge()
        self._cpu_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="SeekSpectral")
        self._lookup_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="SeekLookup")
        self._run_analysis = CoreHost._run_analysis.__get__(self)

    def shutdown(self):
        self._cpu_pool.shutdown(wait=False)
        self._lookup_pool.shutdown(wait=False)


def test_a_stuck_lookup_does_not_delay_an_analysis(tmp_path, monkeypatch):
    host = Host()
    release_the_lookup = threading.Event()
    try:
        # Occupy the lookup worker indefinitely — the single-pool world, where
        # this same wait would have starved the analysis behind it.
        host._lookup_pool.submit(release_the_lookup.wait)

        monkeypatch.setattr(
            "seek_sidecar.spectral.analyse",
            lambda p, request_id="", transfer_id=None: {"requestId": request_id, "path": p},
        )
        host._cpu_pool.submit(host._run_analysis, "req-1", str(tmp_path / "a.flac"), None)

        assert host.bridge.got_one.wait(timeout=5.0), \
            "analysis never completed while a lookup held its own pool"
        assert host.bridge.events[0][0] == "analysis.result"
        assert not release_the_lookup.is_set()
    finally:
        release_the_lookup.set()
        host.shutdown()
