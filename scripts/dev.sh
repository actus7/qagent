#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/.logs"
COMPANION_LOG="$LOG_DIR/companion.log"
COMPANION_PORT="${AGENT_BROWSER_WS_PORT:-9223}"
STARTED_COMPANION=0
COMPANION_PID=""

mkdir -p "$LOG_DIR"

is_companion_running() {
  ss -ltn 2>/dev/null | rg -q ":${COMPANION_PORT}\\b"
}

cleanup() {
  if [[ "$STARTED_COMPANION" -eq 1 && -n "$COMPANION_PID" ]]; then
    kill "$COMPANION_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if is_companion_running; then
  echo "[dev] BrowserManager companion already running on ws://127.0.0.1:${COMPANION_PORT}"
else
  echo "[dev] Starting BrowserManager companion on ws://127.0.0.1:${COMPANION_PORT}"
  echo "[dev] Companion logs: ${COMPANION_LOG}"
  pnpm companion:agent-browser >"$COMPANION_LOG" 2>&1 &
  COMPANION_PID="$!"
  STARTED_COMPANION=1
fi

pnpm dev:watch
