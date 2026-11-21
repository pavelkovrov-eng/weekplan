#!/bin/bash
# Publish the current main to GitHub Pages without exposing local history or the personal e-mail.
# Each run adds ONE snapshot commit (main's tree) on the local 'publish' branch, authored with the
# GitHub noreply address, and pushes it as origin/main. Local main keeps its full history untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
# test gate: nothing is published while a test fails
node --test test.mjs >/dev/null 2>&1 || { echo "הבדיקות של node נכשלו (node --test test.mjs). לא פורסם." >&2; exit 1; }
python3 -m unittest -q test_server.py >/dev/null 2>&1 || { echo "הבדיקות של השרת נכשלו (python3 -m unittest -q test_server.py). לא פורסם." >&2; exit 1; }
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
