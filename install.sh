#!/usr/bin/env bash
set -euo pipefail

# Security Fix Installer for Moltbot (Source)
# Copies the 11 fix files into an existing Moltbot source tree.
# Creates .bak backups of all existing files before overwriting.
# Use uninstall.sh to restore the originals.

usage() {
  echo "Usage: $0 <path-to-moltbot-src>"
  echo ""
  echo "Example: $0 /opt/moltbot"
  echo "         $0 ~/projects/moltbot"
  echo ""
  echo "To undo: ./uninstall.sh <path-to-moltbot-src>"
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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

echo "Installing security fixes into: $TARGET"
echo ""

UPDATED=0
CREATED=0

for file in "${FILES[@]}"; do
  src="$SCRIPT_DIR/$file"
  dst="$TARGET/$file"

  if [ ! -f "$src" ]; then
    echo "  SKIP    $file (source not found)"
    continue
  fi

  mkdir -p "$(dirname "$dst")"

  if [ -f "$dst" ]; then
    # Back up original if no backup exists yet.
    if [ ! -f "$dst.bak" ]; then
      cp "$dst" "$dst.bak"
    fi
    cp "$src" "$dst"
    echo "  UPDATE  $file  (backup: $file.bak)"
    UPDATED=$((UPDATED + 1))
  else
    cp "$src" "$dst"
    echo "  CREATE  $file"
    CREATED=$((CREATED + 1))
  fi
done

echo ""
echo "Done: $UPDATED updated, $CREATED new."
echo ""
echo "Next steps:"
echo "  cd $TARGET"
echo "  pnpm build && pnpm test"
echo ""
echo "To undo all changes:"
echo "  ./uninstall.sh $TARGET"
