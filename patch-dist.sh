#!/usr/bin/env bash
set -euo pipefail

# Security Fix — Patch compiled dist/ files for macOS app users.
# Patches the running Moltbot gateway JavaScript without rebuilding from source.

usage() {
  echo "Usage: $0 <path-to-moltbot>"
  echo ""
  echo "Examples:"
  echo "  $0 /usr/local/lib/node_modules/moltbot    # npm global install"
  echo "  $0 ~/moltbot                                # git clone install"
  echo "  $0 /opt/moltbot                             # custom location"
  echo ""
  echo "After patching, restart the gateway:"
  echo "  moltbot gateway restart"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

TARGET="$1"

if [ ! -d "$TARGET/dist" ]; then
  echo "Error: '$TARGET/dist' not found."
  echo "Please point to the moltbot root directory (containing dist/)."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DIST_FILES=(
  "dist/security/dangerous-command-guard.js"
  "dist/security/register-builtin-guards.js"
  "dist/security/anomaly-detector.js"
  "dist/security/audit-log.js"
  "dist/infra/cost-tracker.js"
  "dist/agents/pi-embedded-runner/run/attempt.js"
)

echo "Patching compiled JavaScript in: $TARGET/dist"
echo ""

PATCHED=0
SKIPPED=0

for file in "${DIST_FILES[@]}"; do
  src="$SCRIPT_DIR/$file"
  dst="$TARGET/$file"

  if [ ! -f "$src" ]; then
    echo "  SKIP  $file (patch file not found)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  mkdir -p "$(dirname "$dst")"

  # Back up original if no backup exists yet.
  if [ -f "$dst" ] && [ ! -f "$dst.bak" ]; then
    cp "$dst" "$dst.bak"
  fi

  cp "$src" "$dst"
  echo "  PATCH  $file"
  PATCHED=$((PATCHED + 1))
done

echo ""
echo "Patched $PATCHED file(s), skipped $SKIPPED."
echo ""
echo "Restart the gateway to apply:"
echo "  moltbot gateway restart"
echo ""
echo "To revert, restore the .bak files:"
echo "  for f in $TARGET/dist/**/*.bak; do mv \"\$f\" \"\${f%.bak}\"; done"
