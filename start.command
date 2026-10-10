#!/bin/bash
# Double-click this in Finder. A Terminal window opens, the planner server
# starts, and the browser lands on the planner.
#
# Closing that window stops the server. That is the whole stop mechanism, and
# `exec` below is what makes it true.

# Finder starts a double-clicked script in the home directory, so every relative
# path below -- server.py, data/ -- would resolve against the wrong place.
# If this fails, stopping is correct: everything after it assumes it worked.
cd "$(dirname "$0")" || exit 1

# Stdlib only, so python3 is the single requirement. Say so in plain words
# instead of letting the terminal flash "command not found" and close.
if ! command -v python3 >/dev/null 2>&1; then
  echo "לא נמצא python3 — התקן Python 3 (python.org) ונסה שוב." >&2
  exit 1
fi

# No sleep/open here: server.py opens the browser itself, after it has bound
# the port, so there is no race and the URL is the port it actually got.
#
# `exec` replaces this shell with Python instead of spawning a child, so the
# terminal window *is* the server: closing it signals the process that matters.
# Without it bash would sit in between, and closing the window could leave a
# server nobody can see or stop, still running old code.
exec python3 server.py
