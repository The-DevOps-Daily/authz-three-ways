#!/usr/bin/env bash
# SpiceDB list, cold and warm, against the code of every step. Shows what each
# step did to LookupResources. Writes results/steps/step<N>-spicedb-list-cache.*
set -euo pipefail
export QUIET_LOAD=${QUIET_LOAD:-1.5} QUIET_MAX=${QUIET_MAX:-900}
cd "$(dirname "$0")/.."
[ -x .bin/cerbos ] && [ -x .bin/spicedb ] || ./scripts/fetch-binaries.sh
mkdir -p results/steps
for step in 1 2 3 4; do
  tree=.steps/step$step
  rm -rf "$tree" && mkdir -p "$tree"
  git archive "step$step-spicedb" app approaches | tar -x -C "$tree"
  ./scripts/quiet.sh
  nice -n 19 node harness/spicedb-list-cache.js --tree=$tree --pairs=6 \
    --out=results/steps/step$step-spicedb-list-cache.json | tee results/steps/step$step-spicedb-list-cache.txt
done
