#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_ID="com.xingjianb.gpu-monitor"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${PLIST_ID}.plist"
OUT_LOG="${REPO_ROOT}/gpu-cluster-monitor/data/launchd_stdout.log"
ERR_LOG="${REPO_ROOT}/gpu-cluster-monitor/data/launchd_stderr.log"
RUNNER="${REPO_ROOT}/tools/gpu_monitor/publish_hourly.sh"

PLUTO_CMD=""
SQLITE_PATH=""

usage() {
  cat <<'EOF'
Usage:
  ./tools/gpu_monitor/setup_launchd_macos.sh install [--pluto-cmd "python -m colligo.pluto.sdk.cli"] [--sqlite-path /abs/path/gpu_usage.db]
  ./tools/gpu_monitor/setup_launchd_macos.sh uninstall
  ./tools/gpu_monitor/setup_launchd_macos.sh status
  ./tools/gpu_monitor/setup_launchd_macos.sh run-once
EOF
}

parse_install_args() {
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pluto-cmd)
        PLUTO_CMD="$2"
        shift 2
        ;;
      --sqlite-path)
        SQLITE_PATH="$2"
        shift 2
        ;;
      *)
        echo "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

write_plist() {
  mkdir -p "${LAUNCH_AGENTS_DIR}"
  mkdir -p "$(dirname "${OUT_LOG}")"

  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER}</string>
    <string>--allow-fetch-failure</string>
    <string>--fetch-retries</string>
    <string>4</string>
    <string>--retry-delay-seconds</string>
    <string>15</string>
    <string>--backfill-max-hours</string>
    <string>168</string>
EOF
    if [[ -n "${PLUTO_CMD}" ]]; then
      cat <<EOF
    <string>--pluto-cmd</string>
    <string>${PLUTO_CMD}</string>
EOF
    fi
    if [[ -n "${SQLITE_PATH}" ]]; then
      cat <<EOF
    <string>--seed-sqlite</string>
    <string>${SQLITE_PATH}</string>
EOF
    fi
    cat <<EOF
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
EOF
  } > "${PLIST_PATH}"
}

install_service() {
  parse_install_args "$@"
  write_plist
  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  launchctl load "${PLIST_PATH}"
  echo "Installed and started ${PLIST_ID}"
}

uninstall_service() {
  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  rm -f "${PLIST_PATH}"
  echo "Uninstalled ${PLIST_ID}"
}

show_status() {
  if launchctl list | grep -q "${PLIST_ID}"; then
    echo "${PLIST_ID} is loaded."
  else
    echo "${PLIST_ID} is not loaded."
  fi
  if [[ -f "${PLIST_PATH}" ]]; then
    echo "plist: ${PLIST_PATH}"
  fi
  if [[ -f "${OUT_LOG}" ]]; then
    echo "stdout log: ${OUT_LOG}"
  fi
  if [[ -f "${ERR_LOG}" ]]; then
    echo "stderr log: ${ERR_LOG}"
  fi
}

run_once() {
  cd "${REPO_ROOT}"
  if [[ -n "${PLUTO_CMD}" ]]; then
    "${RUNNER}" --allow-fetch-failure --pluto-cmd "${PLUTO_CMD}"
  else
    "${RUNNER}" --allow-fetch-failure
  fi
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

case "$1" in
  install)
    install_service "$@"
    ;;
  uninstall)
    uninstall_service
    ;;
  status)
    show_status
    ;;
  run-once)
    run_once
    ;;
  *)
    usage
    exit 1
    ;;
esac
