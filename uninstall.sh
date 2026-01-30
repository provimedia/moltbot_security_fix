#!/usr/bin/env bash
set -euo pipefail

# Security Fix Uninstaller for Moltbot (Source)
# Restores .bak backups created by install.sh.
# New files (audit-log.ts, cost-tracker.ts) that had no original are removed.

usage() {
  echo "Usage: $0 <path-to-moltbot-src>"
  echo ""
  echo "Restores the original files from .bak backups created by install.sh."
  echo ""
  echo "Example: $0 /opt/moltbot"
  echo "         $0 ~/projects/moltbot"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

TARGET="$1"

if [ ! -d "$TARGET/src" ]; then
  echo "Error: '$TARGET/src' not found. Please point to the moltbot root directory."
  exit 1
fi

FILES=(
  "src/security/dangerous-command-guard.ts"
  "src/security/dangerous-command-guard.test.ts"
  "src/security/register-builtin-guards.ts"
  "src/security/register-builtin-guards.test.ts"
  "src/security/anomaly-detector.ts"
  "src/security/anomaly-detector.test.ts"
  "src/security/audit-log.ts"
  "src/security/audit-log.test.ts"
  "src/infra/cost-tracker.ts"
  "src/infra/cost-tracker.test.ts"
  "src/agents/pi-embedded-runner/run/attempt.ts"
)

echo "Uninstalling security fixes from: $TARGET"
echo ""

RESTORED=0
REMOVED=0
SKIPPED=0

for file in "${FILES[@]}"; do
  dst="$TARGET/$file"

  if [ -f "$dst.bak" ]; then
    mv "$dst.bak" "$dst"
    echo "  RESTORE  $file"
    RESTORED=$((RESTORED + 1))
  elif [ -f "$dst" ]; then
    # No backup = file was newly created by install.sh. Remove it.
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
echo "Next steps:"
echo "  cd $TARGET"
echo "  pnpm build && pnpm test"
