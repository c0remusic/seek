#!/usr/bin/env bash
# Seek — fetch the fpcalc that ships inside the app.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# WHY A DOWNLOAD AND NOT `brew install`. Homebrew's fpcalc is not portable:
# `otool -L` on it lists @rpath/libchromaprint.1.dylib plus four Homebrew ffmpeg
# dylibs, so copying that binary into the bundle produces something that dies on
# any machine without an identical Homebrew tree. Measured, not assumed.
#
# The official release from acoustid links only OS libraries — libSystem,
# Accelerate, libz, libc++ — and is universal, so one file covers both
# architectures of a universal app. Verified with `otool -L` and `lipo -archs`.
#
# The Windows release from the same tag is the equivalent: a static MinGW build
# whose import table names only OS DLLs (KERNEL32, SHELL32, USER32, bcrypt,
# msvcrt, the DirectX set ffmpeg probes for hwaccel) — no VC++ redistributable,
# nothing to install first. Verified against the PE import strings, 2026-09.
#
# WHY IT IS NOT COMMITTED. A 2.6 MB binary in git, re-downloaded by every clone
# for ever, to save one scripted fetch at release time. The checksum below is
# what makes the fetch trustworthy; committing the file would only move the
# trust decision, not remove it.
#
# LICENSING, since this ships to other people:
#   * Chromaprint is LGPL-2.1-or-later.
#   * The binary statically links FFmpeg, which is LGPL-2.1-or-later by default
#     and GPL-2-or-later when built --enable-gpl. Both are compatible with
#     Seek's GPL-3.0-or-later. Inspected: no libx264/libx265/postproc wrapper
#     strings, and the x264/xvid hits are decoder FOURCCs, which are LGPL.
#   * It is shipped UNMODIFIED and invoked as a separate process, never linked
#     into Seek. README credits it and links the exact source tarball.

set -euo pipefail

VERSION="1.6.1"

# One recipe per OS this script is ever run on. Pinned checksums, same idea on
# both: if the download does not match, the build stops rather than bundling
# something nobody looked at.
case "$(uname -s)" in
  Darwin)
    ARCHIVE="chromaprint-fpcalc-${VERSION}-macos-universal.tar.gz"
    SHA256="240aeb5a8c8205af458e3625cb7487b826b711a999e491ef00111f3cebd76f00"
    BIN="fpcalc"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ARCHIVE="chromaprint-fpcalc-${VERSION}-windows-x86_64.zip"
    SHA256="735d6182b38e9f364b84ce6f4ccd682c75e2851de89735711d6b762d12b92a4e"
    BIN="fpcalc.exe"
    ;;
  *)
    printf '\n  ✗ no vendored-fpcalc recipe for %s — Seek builds on macOS and Windows\n\n' \
      "$(uname -s)" >&2
    exit 1
    ;;
esac

URL="https://github.com/acoustid/chromaprint/releases/download/v${VERSION}/${ARCHIVE}"

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/vendor/$BIN"

die() { printf '\n  ✗ %s\n\n' "$1" >&2; exit 1; }

# macOS ships `shasum`, Git Bash ships `sha256sum`; both print "<hash>  <file>".
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi \
    | cut -d' ' -f1
}

# Idempotent: a correct copy is left alone, so `release.sh` can call this every
# time without a network round trip on every build.
if [ -x "$DEST" ]; then
  if [ "$("$DEST" -version 2>/dev/null | head -1)" != "" ]; then
    printf '  fpcalc %s already vendored\n' "$VERSION"
    exit 0
  fi
fi

mkdir -p "$HERE/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf '  fetching %s\n' "$ARCHIVE"
curl -fsSL -o "$TMP/$ARCHIVE" "$URL" || die "could not download $URL"

GOT="$(sha256_of "$TMP/$ARCHIVE")"
[ "$GOT" = "$SHA256" ] || die "checksum mismatch for $ARCHIVE
  expected $SHA256
  got      $GOT
This is either a corrupted download or a changed upstream artifact. Do not
bundle it until someone has worked out which."

case "$ARCHIVE" in
  *.tar.gz) tar -xzf "$TMP/$ARCHIVE" -C "$TMP" ;;
  *.zip)
    # Git Bash does not always carry unzip; the GitHub runners carry 7z.
    if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/$ARCHIVE" -d "$TMP"
    elif command -v 7z >/dev/null 2>&1; then 7z x -y -o"$TMP" "$TMP/$ARCHIVE" >/dev/null
    else die "neither unzip nor 7z is available to extract $ARCHIVE"
    fi
    ;;
esac
FOUND="$(find "$TMP" -name "$BIN" -type f | head -1)"
[ -n "$FOUND" ] || die "no $BIN inside $ARCHIVE"

if [ "$(uname -s)" = "Darwin" ]; then
  # Refuse anything that would die on a machine other than this one — the exact
  # failure that kept Homebrew's copy out of the bundle.
  # On a universal binary `otool -L` prints a header line per slice
  # ("path (architecture arm64):"), so match only real dependency lines — those
  # are the tab-indented ones — before deciding what is external.
  deps() { otool -L "$1" | grep $'^\t' | sed 's/^\t//; s/ (compatibility.*//'; }
  EXTERNAL="$(deps "$FOUND" | grep -vE '^/usr/lib/|^/System/Library/' | grep -c . || true)"
  [ "$EXTERNAL" -eq 0 ] || die "fpcalc links libraries outside the OS, so it would
die on any machine without them:
$(deps "$FOUND" | grep -vE '^/usr/lib/|^/System/Library/' | sed 's/^/    /')"

  ARCHS="$(lipo -archs "$FOUND" 2>/dev/null || echo "?")"
  case "$ARCHS" in
    *arm64*x86_64*|*x86_64*arm64*) ;;
    *) die "fpcalc is not universal (got: $ARCHS) — half the users would get nothing" ;;
  esac
  NOTE=" ($ARCHS)"
else
  # No otool on Windows, and the build is static, so the check is a tripwire
  # rather than an inventory: the compiler-runtime DLL names only appear in the
  # import strings if upstream switches to a dynamic build — which is exactly
  # the copy that would die on a machine without that toolchain installed.
  if grep -qa 'vcruntime140\|libwinpthread\|libgcc_s_seh\|libstdc++-6' "$FOUND"; then
    die "fpcalc names a compiler runtime DLL — upstream switched to a dynamic
build, which would die on machines without that runtime. Do not bundle it."
  fi
  NOTE=""
fi

install -m 755 "$FOUND" "$DEST"
printf '  vendored fpcalc %s%s -> %s\n' "$VERSION" "$NOTE" "${DEST#"$HERE/"}"
