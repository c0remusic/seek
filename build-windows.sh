#!/usr/bin/env bash
#
# Seek — build a Windows NSIS installer, and refuse to ship stale code.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Runs under Git Bash — on a Windows machine or a windows-latest runner (which
# is the only place this repo can currently prove it, since development happens
# on macOS and Linux). Deliberately NOT a port of release.sh: no codesigning,
# no updater artifacts, no notarisation story. What it keeps is release.sh's
# reason to exist — the engine is FROZEN into the bundle by PyInstaller as a
# separate manual step, so this script freezes FIRST, checks the freeze carried
# every module, and stops if any did not.
#
# The venv layout is the Windows one (Scripts/, python.exe), and PYTHONPATH is
# ';'-joined with RELATIVE components so MSYS path mangling never triggers.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$PWD"
say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PY="sidecar/.venv/Scripts/python.exe"

[ -d upstream/pynicotine ] || die "upstream/ is empty — run: git submodule update --init"
[ -x "$PY" ] || die "no sidecar venv — create it with:
  cd sidecar && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt"

say "Submodule pinned at $(git -C upstream rev-parse --short HEAD)"

# The version is declared in five places that have no way of checking each
# other. Duplicated from release.sh on purpose — the two scripts share no
# platform, and a sourced common file would be the first thing to drift.
say "Checking the version is consistent"
V_NPM=$(node -p "require('./app/package.json').version")
V_TAURI=$(node -p "require('./app/src-tauri/tauri.conf.json').version")
V_CARGO=$(grep -m1 '^version = ' app/src-tauri/Cargo.toml | sed 's/.*"\(.*\)"/\1/')
V_SIDECAR=$(grep -m1 '^SIDECAR_VERSION' sidecar/seek_sidecar/core_host.py | sed 's/.*"\(.*\)"/\1/')
V_DUNDER=$(grep -m1 '^__version__' sidecar/seek_sidecar/__init__.py | sed 's/.*"\(.*\)"/\1/')
for pair in "tauri:$V_TAURI" "cargo:$V_CARGO" "sidecar:$V_SIDECAR" "__init__:$V_DUNDER"; do
  [ "${pair#*:}" = "$V_NPM" ] || die "version drift: package.json is $V_NPM but ${pair%%:*} is ${pair#*:}"
done
printf '  all five agree on %s\n' "$V_NPM"

say "Engine tests"
( cd sidecar && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH='../upstream;.' \
    .venv/Scripts/python.exe -m pytest tests/ -q ) || die "engine tests failed"

say "App tests and type check"
( cd app && npm test --silent && npm run typecheck --silent ) || die "app checks failed"

say "Protocol is in step with the schema"
"$PY" shared/generate_protocol.py --check || die "generated protocol has drifted"

say "Freezing the engine"
( cd sidecar && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH='../upstream;.' \
    .venv/Scripts/python.exe -m PyInstaller seek-sidecar.spec --noconfirm >/dev/null ) \
    || die "pyinstaller failed"

# Same guard as release.sh, same reason: a freeze that silently misses a module
# looks perfectly healthy from the outside.
say "Checking the freeze is not stale"
TOC="sidecar/build/seek-sidecar/PYZ-00.toc"
[ -f "$TOC" ] || die "no $TOC — cannot verify what was frozen"

missing=""
for f in sidecar/seek_sidecar/*.py; do
  mod="$(basename "$f" .py)"
  [ "$mod" = "__init__" ] && continue
  grep -q "seek_sidecar\.$mod" "$TOC" || missing="$missing $mod"
done
[ -z "$missing" ] || die "frozen engine is missing:$missing
The freeze did not pick up the current source. Do not ship this."

# release.sh also compares file timestamps here; that check leans on BSD
# `date -r`/`stat -f`, which Git Bash lacks — and a CI checkout is always
# fresh. The module-presence check above is the one that has caught real bugs.

count=$(ls sidecar/seek_sidecar/*.py | grep -vc __init__ || true)
printf '  all %s modules present\n' "$count"

say "Bundling fpcalc"
./sidecar/fetch-fpcalc.sh || die "could not vendor fpcalc"
install -m 755 sidecar/vendor/fpcalc.exe sidecar/dist/seek-sidecar/fpcalc.exe \
  || die "could not place fpcalc beside the frozen engine"
sidecar/dist/seek-sidecar/fpcalc.exe -version >/dev/null 2>&1 \
  || die "the bundled fpcalc does not run"
printf '  fpcalc is beside the engine\n'

# The trust store is a DATA file, so none of the checks above would notice it
# missing (see release.sh — this shipped broken as 0.2.0 on macOS).
say "Checking the CA bundle was frozen"
CACERT="$(find sidecar/dist/seek-sidecar -name cacert.pem | head -1)"
[ -n "$CACERT" ] || die "no cacert.pem in the freeze — every Bandcamp, Discogs and
YouTube lookup will fail with CERTIFICATE_VERIFY_FAILED on any machine but this
one. Check that certifi is installed and that the spec collects its data files."
printf '  trust store at %s\n' "${CACERT#sidecar/dist/seek-sidecar/}"

# Freezing on Windows is new ground, so do not stop at "the files are there":
# start the frozen engine and demand the endpoint line. This is the check that
# catches a DLL PyInstaller forgot — numpy's, libsndfile — which no file
# listing can see and which otherwise surfaces as an app that looks installed
# and stays permanently offline.
say "Smoke-testing the frozen engine"
"$PY" - <<'SMOKE' || die "the frozen engine did not start"
import json
import subprocess
import sys
import tempfile
import threading

exe = "sidecar/dist/seek-sidecar/seek-sidecar.exe"
folder = tempfile.mkdtemp(prefix="seek-smoke-")
proc = subprocess.Popen([exe, "--print-endpoint", "--app-folder", folder],
                        stdout=subprocess.PIPE)
watchdog = threading.Timer(60, proc.kill)
watchdog.start()
try:
    line = proc.stdout.readline().decode("utf-8", "replace").strip()
finally:
    watchdog.cancel()
    proc.kill()
    proc.wait()

endpoint = json.loads(line) if line else {}
missing = {"host", "port", "token"} - set(endpoint)
if missing:
    sys.exit(f"no usable endpoint line (missing {sorted(missing)}): {line!r}")
print(f"  engine came up on {endpoint['host']}:{endpoint['port']}")
SMOKE

# A stale installer from an earlier run must not survive to be mistaken for
# this build's output.
rm -f app/src-tauri/target/release/bundle/nsis/*-setup.exe \
      app/src-tauri/target/release/bundle/nsis/*.nsis.zip \
      app/src-tauri/target/release/bundle/nsis/*.nsis.zip.sig

say "Building the app"
# tauri.windows.conf.json turns updater artifacts OFF so this script works
# unsigned (PR CI has no key, and tauri refuses createUpdaterArtifacts
# without one). A release build, which exports TAURI_SIGNING_PRIVATE_KEY,
# turns them back on here: the .nsis.zip + .sig pair is what the in-app
# updater downloads and verifies, and a release without them installs fine
# by hand and can never self-update.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  say "  signing key present: producing updater artifacts"
  ( cd app && npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":true}}' ) \
    || die "tauri build failed"
else
  ( cd app && npm run tauri build ) || die "tauri build failed"
fi

SETUP="$(find app/src-tauri/target/release/bundle/nsis -name '*-setup.exe' 2>/dev/null | head -1)"
[ -n "$SETUP" ] || die "no NSIS installer produced"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  UPD_ZIP="$(find app/src-tauri/target/release/bundle/nsis -name '*.nsis.zip' 2>/dev/null | head -1)"
  [ -n "$UPD_ZIP" ] || die "signing key set but no .nsis.zip updater artifact produced"
  [ -s "$UPD_ZIP.sig" ] || die "updater artifact is unsigned ($UPD_ZIP.sig missing or empty)"
  say "Updater artifact $ROOT/$UPD_ZIP (signed)"
fi

say "Built $ROOT/$SETUP ($(du -h "$SETUP" | cut -f1))"
