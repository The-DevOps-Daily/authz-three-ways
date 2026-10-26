#!/usr/bin/env bash
# Download the pinned Cerbos and SpiceDB release binaries for this machine,
# verify their SHA-256 against the values pinned here, and unpack them in .bin/.
# The binaries are not committed. Remove them with: rm -rf .bin
set -euo pipefail

CERBOS_VERSION=0.57.0
SPICEDB_VERSION=1.57.0

cd "$(dirname "$0")/.."
mkdir -p .bin/dl

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

# sha256 from each release's checksums.txt
declare -A SUMS=(
  [cerbos_${CERBOS_VERSION}_Linux_arm64.tar.gz]=a08aadc5cc946f9688c54ca74332aa61b7e5f52d4ae75723b704316376c78f8d
  [spicedb_${SPICEDB_VERSION}_linux_arm64.tar.gz]=dc94adf2075f3cb3755e63180341483821e0a9e632a207ff0c53e6919ec291d5
)

fetch() { # url file
  local url=$1 file=$2
  if [ ! -f ".bin/dl/$file" ]; then
    curl -fsSL --retry 3 -o ".bin/dl/$file.part" "$url"
    mv ".bin/dl/$file.part" ".bin/dl/$file"
  fi
  local want=${SUMS[$file]:-}
  if [ -z "$want" ]; then
    # Not pinned here (another arch): fall back to the release checksums.txt.
    want=$(curl -fsSL "$(dirname "$url")/checksums.txt" | awk -v f="$file" '$2==f {print $1}')
  fi
  local got
  got=$(sha256sum ".bin/dl/$file" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "checksum mismatch for $file: got $got want $want" >&2
    rm -f ".bin/dl/$file"
    exit 1
  fi
  echo "ok  $file  $got"
}

if [ ! -x .bin/cerbos ]; then
  f=cerbos_${CERBOS_VERSION}_Linux_${ARCH}.tar.gz
  fetch "https://github.com/cerbos/cerbos/releases/download/v${CERBOS_VERSION}/$f" "$f"
  tar -xzf ".bin/dl/$f" -C .bin cerbos
fi

if [ ! -x .bin/spicedb ]; then
  f=spicedb_${SPICEDB_VERSION}_linux_${ARCH}.tar.gz
  fetch "https://github.com/authzed/spicedb/releases/download/v${SPICEDB_VERSION}/$f" "$f"
  tar -xzf ".bin/dl/$f" -C .bin spicedb
fi

rm -rf .bin/dl
.bin/cerbos --version | head -1
.bin/spicedb version 2>/dev/null | head -1 || true
