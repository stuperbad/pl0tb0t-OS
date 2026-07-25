#!/bin/bash
# Periodic auto-pull for pl0tb0t-OS, run via a systemd timer every ~10 min.
# Safe by construction: never touches anything if there's uncommitted local
# work, and a plain fast-forward-only pull can't clobber anything either --
# it just no-ops if the histories have diverged.
set -e
cd "$(dirname "$0")/.."

# UTC, ISO8601 -- this log gets read cross-machine (the dashboard runs on the
# PC, in a different timezone than the Pi), so a local-time string like
# "01:34 BST" is ambiguous to whoever parses it. UTC with an explicit Z isn't.
if [ -n "$(git status --porcelain)" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) uncommitted changes present, skipping auto-sync."
  exit 0
fi

git fetch --quiet
BEFORE=$(git rev-parse HEAD)
git pull --ff-only --quiet 2>/dev/null || {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pull skipped (not fast-forwardable or offline)."
  exit 0
}
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pulled $BEFORE -> $AFTER"
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) already up to date."
fi
