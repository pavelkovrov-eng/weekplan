# מתכנן השבוע על המחשב — שרת מקומי, מסד נתונים, כפתור הפעלה

> Execution: Sonnet implements one task at a time; Opus reviews task N while Sonnet builds task N+1; single writer.

**Goal:** the planner runs locally: double-click `start.command` → a stdlib Python server on loopback serves the page and stores items in SQLite → the browser opens on it. Same base as `~/Desktop/PKfinnens/finance-ingest` (`ingest/server.py`, `ingest/db.py`, `start.command`), separate project.

**User decisions (2026-10-08):** local only (the claude.ai page stays but is no longer used); build inside WeekPlan; the address must never collide with something already running.

## Global constraints
- Python **stdlib only** (no venv, no pip). Run with `python3` (3.14 on this Mac). Node tests stay: `node --test test.mjs`. Python tests: `python3 -m unittest -v test_server.py`.
- Bind **127.0.0.1 only**, never 0.0.0.0; no `--host` flag. No static file serving: fixed routes only, everything else 404.
- Data lives in `data/` (git-ignored): `data/weekplan.db`, backups in `data/backups/`.
- The HTML page must keep working unchanged on claude.ai (`window.claude` db) and as a plain file (localStorage); the server adds a third mode.
- Hebrew UI copy; compact one-line JS style in the page; Python code commented on the *why* like PKfinnens.

## API contract (Task 1 builds it, Task 2 consumes it)
| Method + path | Request | Response |
|---|---|---|
| `GET /` | — | the page file `תכנון השבוע בסמסטר א'.html`, read from disk on every request, `text/html; charset=utf-8`, `Cache-Control: no-store` |
| `GET /api/ping` | — | `{"app":"weekplan","v":1}` |
| `GET /api/items` | — | `{"items":[{...doc,"id":"<id>"}]}` |
| `POST /api/items` | JSON object (a doc) | `201 {"id":"<new id>"}` — id = `secrets.token_hex(10)` |
| `PUT /api/items/<id>` | JSON object | `{"ok":true}` — replace (upsert) |
| `DELETE /api/items/<id>` | — | `{"ok":true}` (also when it did not exist) |

Rules:
- `<id>` must match `^[A-Za-z0-9_-]{1,64}$`, else 404.
- An `id` key inside a body is ignored; the stored doc never contains `id`.
- Bodies over 1 MiB → 413; not JSON or not an object → 400.
- **Write safety** (POST/PUT/DELETE): require `Content-Type: application/json` (forces a CORS preflight for cross-site pages; the server never answers OPTIONS with CORS headers, so cross-site writes fail), and if an `Origin` header is present it must equal the server's own origin → else 403.
- **DNS-rebinding guard** (all requests): the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` → else 403.
- JSON responses: `application/json; charset=utf-8`, `Cache-Control: no-store`.

## Storage
- SQLite `data/weekplan.db`, table `items(id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`, `journal_mode=WAL`, `synchronous=FULL`, connection per request (or one per thread).
- On server start, if the db exists: snapshot with the SQLite online backup API to `data/backups/weekplan-YYYYmmdd-HHMMSS.db`, keep the newest 20.

## Port and launch
- Default port 8010. On start:
  - If it is free → bind it.
  - If it is busy and `GET http://127.0.0.1:<port>/api/ping` answers `{"app":"weekplan"}` → a planner is already running: open the browser on it and exit 0. A second double-click opens the same app.
  - Otherwise try 8011…8029 and take the first free one.
- After binding, print the URL and open the browser with `webbrowser.open` (unless `--no-browser`). The open happens after the bind, so there is no race.
- `start.command`: `cd "$(dirname "$0")" || exit 1`, check `python3` exists (Hebrew error otherwise), `exec python3 server.py`. Closing the window stops the server.

---

### Task 1 — `server.py` + `test_server.py`
Build the server, storage and port logic above. TDD with `unittest`: tests start the server on a free port in a thread (`--no-browser` path / a `make_server(port, db_path)` function) against a temp db and assert every row and rule of the API contract:
- round-trip POST/GET/PUT/DELETE; the `id` inside a body is ignored;
- 404 for `/data/weekplan.db`, `/server.py`, `/../x`, `/api/items/bad id`;
- 413, 400, 403 for a wrong Host, 403 for a foreign Origin, 403/415 without the JSON content type;
- the backup happens and is pruned to 20;
- port selection: busy-by-other → next port; busy-by-weekplan → the "already running" path is detected.

Commit: `feat: local stdlib server with SQLite storage`.

### Task 2 — page: "נשמר במחשב" mode
In the HTML app script:
- Startup: before the `window.claude` path, if `location.protocol==='http:'` and the hostname is `127.0.0.1` or `localhost`, `fetch('/api/items')`. On success: `mode='srv'`, `items=json.items`, render. On failure, fall through to the existing flow.
- `saveItem`/`removeItem` srv branches use the API with `Content-Type: application/json`, reload items with `GET /api/items`, render, and toast as the other modes do. On a network/HTTP error: toast `השמירה לא הצליחה. ודא שחלון הטרמינל של המתכנן פתוח.`, return false.
- Replace every `mode==='db'||mode==='local'` edit check with one helper `canEdit()` that also accepts `'srv'`.
- Status pill for srv: class `db`, text `נשמר במחשב`.
- Exports/print already fall back to `a[download]` / `window.print()` (no `window.claude`).
- Verify in the browser against a real `python3 server.py --no-browser --port <free>` with a temp db: add/edit/skip/cancel/off/anchor all persist across a reload. Node tests stay green.

Commit: `feat: page saves to the local server`.

### Task 3 — launch button, config, docs, data
- `start.command` (executable, `chmod +x`) as specified.
- `.gitignore`: `data/`, `__pycache__/`.
- `.claude/launch.json` "weekplan" config → `python3 server.py --no-browser --port 8765`.
- CLAUDE.md:
  - how to run: double-click / `python3 server.py`;
  - tests (both);
  - the API, storage and port rules in brief;
  - local is now the primary way to use the planner, the claude.ai artifact is legacy.
- Migrate the user's one stored doc from the claude.ai db: `{"kind":"anchor","date":"2026-10-18","updated":1791458833247}`. POST it to the running local server once; the controller supplies it.
- Real launch test (controller-run): `open start.command` → the browser opens → the page shows "נשמר במחשב" and week A on 18.10.

Commit: `feat: start.command launcher; docs`.
