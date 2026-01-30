#!/usr/bin/env bash
set -euo pipefail

# Security Fix Uninstaller for Moltbot (compiled JS)
# Restores .bak backups created by patch-dist.sh.
# New files (audit-log.js, cost-tracker.js) that had no original are removed.

usage() {
  echo "Usage: $0 <path-to-moltbot>"
  echo ""
  echo "Restores the original JS files from .bak backups created by patch-dist.sh."
  echo ""
  echo "Examples:"
  echo "  $0 /usr/local/lib/node_modules/moltbot"
  echo "  $0 ~/moltbot"
  echo ""
  echo "After unpatching, restart the gateway:"
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

DIST_FILES=(
  "dist/security/dangerous-command-guard.js"
  "dist/security/register-builtin-guards.js"
  "dist/security/anomaly-detector.js"
  "dist/security/audit-log.js"
  "dist/infra/cost-tracker.js"
  "dist/agents/pi-embedded-runner/run/attempt.js"
)

echo "Restoring original JavaScript in: $TARGET/dist"
echo ""

RESTORED=0
REMOVED=0
SKIPPED=0

for file in "${DIST_FILES[@]}"; do
  dst="$TARGET/$file"

  if [ -f "$dst.bak" ]; then
    mv "$dst.bak" "$dst"
    echo "  RESTORE  $file"
    RESTORED=$((RESTORED + 1))
  elif [ -f "$dst" ]; then
    # No backup = file was newly created by patch-dist.sh. Remove it.
    rm "$dst"
    echo "  REMOVE   $file  (was new, no original)"
    REMOVED=$((REMOVED + 1))
  else
    echo "  SKIP     $file  (not found)"
    SKIPPED=$((SKIPPED + 1))
  fi
done

echo ""
echo "Done: $RESTORED restored, $REMOVED removed, $SKIPPED skipped."
echo ""
echo "Restart the gateway to apply:"
echo "  moltbot gateway restart"
