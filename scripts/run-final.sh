#!/usr/bin/env bash
# The headline numbers: the step 4 code, three repetitions of each benchmark,
# each after waiting for a quiet machine. Writes results/final/.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x .bin/cerbos ] && [ -x .bin/spicedb ] || ./scripts/fetch-binaries.sh
tree=.steps/step4
rm -rf "$tree" && mkdir -p "$tree"
git archive step4-spicedb app approaches | tar -x -C "$tree"
mkdir -p results/final
./scripts/quiet.sh
nice -n 19 node harness/bench-floor.js --out=results/final/floor.json | tee results/final/floor.txt
./scripts/quiet.sh
nice -n 19 node harness/lookup-pages.js --tree=$tree --out=results/final/lookup-pages.json | tee results/final/lookup-pages.txt
for rep in 1 2 3; do
  ./scripts/quiet.sh
  nice -n 19 node harness/bench-check.js --step=4 --tree=$tree --docs=10000 --samples=10000 --warmup=1000 \
    --seed=$((100 + rep)) --out=results/final/check-$rep.json --raw=results/final/check-$rep-raw.json \
    | tee results/final/check-$rep.txt
  ./scripts/quiet.sh
  nice -n 19 node harness/bench-list.js --step=4 --tree=$tree --docs=1000,10000 --iters=20 --warmup=3 \
    --out=results/final/list-$rep.json | tee results/final/list-$rep.txt
done
