#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/gpu-cluster-monitor/data"
LOCK_DIR="${REPO_ROOT}/.gpu-monitor-hourly.lock"

UPDATE_ARGS=("$@")
RETRIES="${GPU_MONITOR_PUBLISH_RETRIES:-3}"
RETRY_DELAY_SECONDS="${GPU_MONITOR_PUBLISH_RETRY_DELAY_SECONDS:-30}"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  log "Another publish run is already in progress. Exiting."
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

cd "${REPO_ROOT}"

success=0
for ((attempt=1; attempt<=RETRIES; attempt++)); do
  if python3 tools/gpu_monitor/update_gpu_usage.py "${UPDATE_ARGS[@]}"; then
    success=1
    break
  fi
  if (( attempt < RETRIES )); then
    log "Update attempt ${attempt}/${RETRIES} failed; retrying in ${RETRY_DELAY_SECONDS}s..."
    sleep "${RETRY_DELAY_SECONDS}"
  fi
done

if (( success == 0 )); then
  log "All update attempts failed."
  exit 1
fi

if [[ -n "$(git status --porcelain "${DATA_DIR}")" ]]; then
  git add "${DATA_DIR}/snapshots.json" "${DATA_DIR}/aggregates.json" "${DATA_DIR}/health.json"
  git commit -m "chore(gpu-monitor): hourly snapshot $(date -u +'%Y-%m-%dT%H:00:00Z')"
  git pull --rebase --autostash
  git push
  log "Published updated GPU monitor data."
else
  log "No data changes detected."
fi
