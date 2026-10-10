#!/bin/bash
# Publish the current main to GitHub Pages without exposing local history or the personal e-mail.
# Each run adds ONE snapshot commit (main's tree) on the local 'publish' branch, authored with the
# GitHub noreply address, and pushes it as origin/main. Local main keeps its full history untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=pavelkovrov-eng
MAIL=269754249+pavelkovrov-eng@users.noreply.github.com
TREE=$(git rev-parse main^{tree})
PARENT=$(git rev-parse -q --verify publish || true)
[ -n "$PARENT" ] && [ "$(git rev-parse publish^{tree})" = "$TREE" ] && { echo "אין שינויים לפרסום."; exit 0; }
MSG="weekplan $(date +%Y-%m-%d) ($(git rev-parse --short main))"
SHA=$(GIT_AUTHOR_NAME=$NAME GIT_AUTHOR_EMAIL=$MAIL GIT_COMMITTER_NAME=$NAME GIT_COMMITTER_EMAIL=$MAIL git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} -m "$MSG")
git branch -f publish "$SHA"
git push origin publish:main
echo "פורסם: $SHA → https://pavelkovrov-eng.github.io/weekplan/"
