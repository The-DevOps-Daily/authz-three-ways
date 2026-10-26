#!/usr/bin/env bash
# Run correctness and both benchmarks against the code of every step, from the
# step tags. Writes results/steps/step<N>-{correctness,check,list}.{json,txt}.
set -euo pipefail
# Per-step runs gate on a looser load than the headline runs in run-final.sh.
export QUIET_LOAD=${QUIET_LOAD:-1.5} QUIET_MAX=${QUIET_MAX:-900}
cd "$(dirname "$0")/.."
[ -x .bin/cerbos ] && [ -x .bin/spicedb ] || ./scripts/fetch-binaries.sh
mkdir -p results/steps
for step in 1 2 3 4; do
  tree=.steps/step$step
  rm -rf "$tree" && mkdir -p "$tree"
  # step<N>-spicedb is the last commit of step N, so it holds all three designs at that step.
  git archive "step$step-spicedb" app approaches | tar -x -C "$tree"
  out=results/steps/step$step
  node harness/correctness.js --step=$step --tree=$tree --out=$out-correctness.json | tee $out-correctness.txt
  ./scripts/quiet.sh
  nice -n 19 node harness/bench-check.js --step=$step --tree=$tree --docs=10000 --samples=5000 --warmup=500 \
    --out=$out-check.json | tee $out-check.txt
  ./scripts/quiet.sh
  nice -n 19 node harness/bench-list.js --step=$step --tree=$tree --docs=1000,10000 --iters=10 --warmup=2 \
    --crosscheck=1000 --out=$out-list.json | tee $out-list.txt
done
