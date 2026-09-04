# Seek — the updater manifest generator.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# `latest.json` is the one file every installed copy of the app polls, and a
# wrong entry looks like "updates are broken" on machines nobody can debug.
# Pinned: the Windows platform entry appears exactly when its signature is
# supplied, the URLs are version-derived with the FIXED asset names the
# release job renames to, and an empty signature file fails loudly instead of
# shipping a manifest every client rejects.
#
# The script lives in .github/ (it is release tooling, not engine code); it is
# imported here by path because this suite is the only harness the repo runs
# everywhere.

import importlib.util
import os

import pytest

_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "..",
                       ".github", "updater-manifest.py")
_spec = importlib.util.spec_from_file_location("updater_manifest", _SCRIPT)
manifest_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(manifest_mod)


def test_macos_only_when_no_windows_signature():
    out = manifest_mod.build("0.3.0", "MAC_SIG", "owner/seek", "2026-01-01T00:00:00Z",
                             "notes")
    assert set(out["platforms"]) == {"darwin-aarch64", "darwin-x86_64"}
    # Universal bundle: both architectures are the same bytes.
    assert out["platforms"]["darwin-aarch64"] == out["platforms"]["darwin-x86_64"]
    assert out["platforms"]["darwin-aarch64"]["url"].endswith(
        "/releases/download/v0.3.0/Seek.app.tar.gz")


def test_windows_entry_appears_with_its_signature():
    out = manifest_mod.build("0.3.0", "MAC_SIG", "owner/seek", "2026-01-01T00:00:00Z",
                             "notes", windows_signature="WIN_SIG")
    win = out["platforms"]["windows-x86_64"]
    assert win["signature"] == "WIN_SIG"
    assert win["url"].endswith("/releases/download/v0.3.0/Seek_x64-setup.nsis.zip")
    # And macOS is untouched by the addition.
    assert out["platforms"]["darwin-aarch64"]["signature"] == "MAC_SIG"


def test_an_empty_signature_fails_loudly(tmp_path):
    mac_sig = tmp_path / "mac.sig"
    mac_sig.write_text("MAC_SIG")
    empty = tmp_path / "win.sig"
    empty.write_text("")
    with pytest.raises(SystemExit) as caught:
        manifest_mod.main([
            "--version", "0.3.0",
            "--signature-file", str(mac_sig),
            "--repo", "owner/seek",
            "--pub-date", "2026-01-01T00:00:00Z",
            "--windows-signature-file", str(empty),
            "--out", str(tmp_path / "latest.json"),
        ])
    assert "Windows" in str(caught.value)


def test_end_to_end_writes_both_platforms(tmp_path):
    import json
    (tmp_path / "mac.sig").write_text("MAC_SIG\n")
    (tmp_path / "win.sig").write_text("WIN_SIG\n")
    out = tmp_path / "latest.json"
    manifest_mod.main([
        "--version", "v0.3.0",
        "--signature-file", str(tmp_path / "mac.sig"),
        "--repo", "owner/seek",
        "--pub-date", "2026-01-01T00:00:00Z",
        "--windows-signature-file", str(tmp_path / "win.sig"),
        "--out", str(out),
    ])
    data = json.loads(out.read_text())
    assert data["version"] == "0.3.0"  # the leading v is stripped
    assert set(data["platforms"]) == {
        "darwin-aarch64", "darwin-x86_64", "windows-x86_64",
    }
