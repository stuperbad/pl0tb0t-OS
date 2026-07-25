#!/bin/bash
# Periodic auto-pull for pl0tb0t-OS, run via a systemd timer every ~10 min.
# Safe by construction: never touches anything if there's uncommitted local
# work, and a plain fast-forward-only pull can't clobber anything either --
# it just no-ops if the histories have diverged.
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "$(date '+%F %T') uncommitted changes present, skipping auto-sync."
  exit 0
fi

git fetch --quiet
BEFORE=$(git rev-parse HEAD)
git pull --ff-only --quiet 2>/dev/null || {
  echo "$(date '+%F %T') pull skipped (not fast-forwardable or offline)."
  exit 0
}
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date '+%F %T') pulled $BEFORE -> $AFTER"
else
  echo "$(date '+%F %T') already up to date."
fi
