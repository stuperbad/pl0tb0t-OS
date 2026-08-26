#!/usr/bin/env bash
# Publish the Make app to 90percent.art/make straight from the Pi.
#
# The site repo is a normal git checkout here; the sync tool rebuilds make-app/
# and make.html from this machine's make_local plus the curation currently in
# the running app's localStorage, then we commit and push. GitHub Pages serves
# the result, so there is no separate deploy step.
set -uo pipefail
SITE="$HOME/90percentart-site"
SRC="$HOME/Desktop/pl0tb0t-OS/make_local"

[ -d "$SITE/.git" ] || { echo "Site repo missing at $SITE"; exit 1; }
cd "$SITE" || exit 1

# This checkout is a publish mirror, never an editing copy -- the sync tool
# regenerates make-app/ and make.html wholesale on every run. So reset to the
# published state rather than trying to merge: a leftover working tree from a
# previous run would otherwise block the pull and jam the button.
echo "Updating site repo..."
git fetch -q origin || { echo "git fetch failed -- check the Pi's network/ssh key"; exit 1; }
git reset --hard -q origin/main || { echo "git reset failed -- resolve by hand in $SITE"; exit 1; }

python3 tools/sync-make-app.py --src "$SRC" || { echo "Sync failed."; exit 1; }

if git diff --quiet && git diff --cached --quiet; then
  echo ""
  echo "No changes -- the site already matches this Pi."
  exit 0
fi

git add -A || exit 1
git commit -q -m "Web sync from pl0tb0t-OS ($(date '+%Y-%m-%d %H:%M'))" || exit 1
git push -q origin main || { echo "Push failed -- changes are committed locally."; exit 1; }

echo ""
echo "Published. Live at https://90percent.art/make in a minute or two."
