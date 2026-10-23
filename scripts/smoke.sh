#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/smoke.sh [--quick] [--zip]

Options:
  --quick  Run only the quality gate (type-check, lint, test)
  --zip    Run packaging check (pnpm zip) after build
  -h       Show this help
EOF
}

run() {
  echo
  echo "==> $*"
  "$@"
}

RUN_BUILD=1
RUN_ZIP=0

for arg in "$@"; do
  case "$arg" in
    --quick)
      RUN_BUILD=0
      ;;
    --zip)
      RUN_ZIP=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Smoke test started in: $ROOT_DIR"

run pnpm type-check
run pnpm -r --if-present lint
run pnpm --filter chrome-extension test -- src/background/browser/__tests__/agent-browser-menu-flow.test.ts
run pnpm -r --if-present test

if [[ "$RUN_BUILD" -eq 1 ]]; then
  run pnpm build
fi

if [[ "$RUN_ZIP" -eq 1 ]]; then
  run pnpm zip
fi

echo
echo "Smoke test completed successfully."
