#!/usr/bin/env bash
# Wait until the 1-minute load average is under $1 (or QUIET_LOAD, default 1.0), for at most
# $2 seconds (or QUIET_MAX, default 1800), so timings are not taken while the machine is busy.
# Prints the load it started with; the harness also stamps the load in each file.
limit=${1:-${QUIET_LOAD:-1.0}}
max=${2:-${QUIET_MAX:-1800}}
waited=0
while :; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  if awk -v l="$load" -v m="$limit" 'BEGIN { exit !(l < m) }'; then
    echo "load $load < $limit after ${waited}s"
    exit 0
  fi
  if [ "$waited" -ge "$max" ]; then
    echo "load still $load after ${waited}s, running anyway"
    exit 0
  fi
  sleep 15
  waited=$((waited + 15))
done
