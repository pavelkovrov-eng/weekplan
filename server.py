"""A local server so the weekly planner page can save to disk.

WHY THIS EXISTS
    The page is one HTML file. A browser cannot write to disk, and on claude.ai
    the only store is that site's own db. This server closes the gap: it serves
    the page and keeps the planner's items in SQLite under data/. Nothing else.

WHY LOOPBACK ONLY
    It binds 127.0.0.1, never 0.0.0.0, and has no login. Those are one
    decision: the operating system will not route a packet here from off the
    machine, and that is the whole security model. What loopback does NOT stop
    is the browser itself -- any web page you have open can send requests to
    127.0.0.1. Two guards cover that: a Host check (a page cannot rebind its own
    DNS name to us) and, on writes, a JSON content type plus an Origin check (a
    foreign page cannot send either without a CORS preflight, and we never
    answer one).

WHY STDLIB
    One browser, one machine, a handful of rows. `ThreadingHTTPServer` plus
    `sqlite3` is exactly the size of the problem; there is nothing to install.

WHY NO STATIC FILE SERVING
    There is no document root. A handful of known routes, everything else 404,
    so no request can name a file -- not data/weekplan.db, not server.py, not a
    traversal out of the project. The page is self-contained by construction;
    the only other files are the fixed PWA shell in STATIC (manifest, service
    worker, icons), which GitHub Pages serves and this server mirrors so the
    page behaves the same here.

    python3 server.py [--port N] [--no-browser] [--data-dir DIR]
"""

from __future__ import annotations

import argparse
import errno
import json
import re
import secrets
import socket
import sqlite3
import sys
import webbrowser
from contextlib import closing
from datetime import datetime, timezone
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"  # never 0.0.0.0 -- see the module docstring
DEFAULT_PORT = 8010
PORT_SPAN = 20  # 8010..8029
MAX_BODY = 1024 * 1024  # an item is a few hundred bytes; more is a mistake or an attack

ROOT = Path(__file__).resolve().parent
PAGE_PATH = ROOT / "index.html"
DATA_DIR = ROOT / "data"  # db and backups live here; --data-dir moves them
DB_NAME = "weekplan.db"
BACKUPS_KEEP = 20

# The PWA shell: route -> (file in ROOT, content type). Fixed names, never derived from the request.
STATIC = {
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
    "/icon-192.png": ("icon-192.png", "image/png"),
    "/icon-512.png": ("icon-512.png", "image/png"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
}

ITEM_PATH = re.compile(r"/api/items/([A-Za-z0-9_-]{1,64})")

SCHEMA = "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL)"
# ON CONFLICT DO UPDATE, not INSERT OR REPLACE: a replace deletes and re-inserts,
# which would move an edited item to the end of the list.
UPSERT = (
    "INSERT INTO items (id, doc, updated_at) VALUES (?, ?, ?) "
    "ON CONFLICT (id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at"
)


# -- storage -----------------------------------------------------------------


def connect(db_path: Path) -> sqlite3.Connection:
    """A fresh connection per request: no shared state between handler threads.

    `isolation_level=None` is autocommit -- each statement here is one atomic
    write. WAL lets a read and a write overlap; `synchronous=FULL` fsyncs every
    commit, because an item the page showed as saved must survive a power cut.
    The cost is invisible at this write rate.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path, isolation_level=None)
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA synchronous = FULL")
    db.execute(SCHEMA)
    return db


def backup(db_path: Path, keep: int = BACKUPS_KEEP) -> Path | None:
    """Snapshot the db with SQLite's online backup API; keep the newest `keep`.

    The backup API copies a consistent image even while the db is open (a plain
    file copy of a WAL db can miss the -wal file). Names are UTC stamps, so
    lexical order is chronological and a DST change cannot reorder them. Two
    starts within one second share a name; the later snapshot overwrites the
    earlier, which is harmless. A failure here is left to propagate: better no
    server than one running with no safety net.
    """
    if not db_path.exists():
        return None  # fresh install: nothing to protect yet
    folder = db_path.parent / "backups"
    folder.mkdir(exist_ok=True)
    target = folder / f"{db_path.stem}-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.db"
    with closing(sqlite3.connect(db_path)) as src, closing(sqlite3.connect(target)) as dst:
        src.backup(dst)
    for stale in sorted(folder.glob(f"{db_path.stem}-*.db"))[:-keep]:
        stale.unlink()
    return target


# -- http --------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "WeekPlan"
    sys_version = ""
    # An idle or half-sent connection (browsers open speculative ones) must not
    # park a thread forever.
    timeout = 10
    # http.server logs (400 for a garbage request line, a timeout) before it has
    # parsed a request, so these are not set yet -- and an AttributeError in the
    # logger would turn that 400 into an empty reply.
    command = path = ""

    def end_headers(self) -> None:
        # Nothing here is meant to be framed. Set in end_headers so http.server's
        # own error pages (400, 501) carry it too.
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def log_message(self, fmt, *args) -> None:
        """One line per request in the terminal the user launched from: the
        window is the whole stop mechanism, so it should show signs of life."""
        if self.server.verbose:
            print(f"  {self.command or ''} {self.path} → {args[1] if len(args) > 1 else ''}", flush=True)

    # -- responses

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # The page is re-read from disk and items change under it: a cached copy
        # would quietly show the state from before the last save.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: object) -> None:
        # ASCII-escaped on purpose: a lone surrogate in a body then can neither
        # break the db write nor the UTF-8 encode of a later response.
        self._send(status, json.dumps(payload).encode(), "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"ok": False, "error": message})

    # -- routes

    def _dispatch(self) -> None:
        try:
            self._route()
        except sqlite3.Error as exc:  # locked / disk full: tell the page, so it can say "not saved"
            self._error(500, f"database error: {exc}")

    do_GET = do_POST = do_PUT = do_DELETE = _dispatch
    # Any other method (OPTIONS included) gets http.server's own 501 with no CORS
    # headers: a cross-site preflight fails, so a foreign page's write never starts.

    def _route(self) -> None:
        port = self.server.server_address[1]
        host = self.headers.get("Host")
        # DNS rebinding: a page on evil.example can point its name at 127.0.0.1
        # and have the browser talk to us, but the Host header still names it.
        if host not in (f"{HOST}:{port}", f"localhost:{port}"):
            return self._error(403, "bad Host")

        path = self.path.split("?", 1)[0]
        item = ITEM_PATH.fullmatch(path)
        route = (self.command, "/api/items/<id>" if item else path)
        if route == ("GET", "/"):
            try:
                # Read on every request: edit the page, refresh, see it.
                return self._send(200, self.server.page_path.read_bytes(), "text/html; charset=utf-8")
            except OSError:
                return self._error(500, "page file missing")
        if self.command == "GET" and path in STATIC:
            name, ctype = STATIC[path]
            try:
                return self._send(200, (ROOT / name).read_bytes(), ctype)
            except OSError:
                return self._error(500, "file missing")
        if route == ("GET", "/api/ping"):
            return self._json(200, {"app": "weekplan", "v": 1})  # how a second launch recognises us
        if route == ("GET", "/api/items"):
            with closing(connect(self.server.db_path)) as db:
                rows = db.execute("SELECT id, doc FROM items ORDER BY rowid").fetchall()
            return self._json(200, {"items": [{**json.loads(d), "id": i} for i, d in rows]})
        if route not in (("POST", "/api/items"), ("PUT", "/api/items/<id>"), ("DELETE", "/api/items/<id>")):
            return self._error(404, "no such path")

        # Write safety. A cross-site <form> can POST here without a preflight,
        # but only as text/plain or form-encoded -- demanding JSON closes that.
        origin = self.headers.get("Origin")
        if origin is not None and origin != f"http://{host}":
            return self._error(403, "foreign Origin")
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self._error(415, "Content-Type must be application/json")

        item_id = item.group(1) if item else secrets.token_hex(10)
        if self.command == "DELETE":
            with closing(connect(self.server.db_path)) as db:
                db.execute("DELETE FROM items WHERE id = ?", (item_id,))
            return self._json(200, {"ok": True})

        doc = self._read_doc()
        if doc is None:
            return
        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        with closing(connect(self.server.db_path)) as db:
            db.execute(UPSERT, (item_id, doc, now))
        if self.command == "POST":
            self._json(201, {"id": item_id})
        else:
            self._json(200, {"ok": True})

    def _read_doc(self) -> str | None:
        """The request body as the JSON text to store, or None after answering 4xx.

        The id travels in the URL (or is minted); one inside the body is dropped,
        so the stored doc never carries an id that could disagree with its row.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0:
            return self._error(400, "bad Content-Length")
        if length > MAX_BODY:  # decided from the header: never read the body to find out it is too big
            return self._error(413, "body too large")
        try:
            doc = json.loads(self.rfile.read(length))
            if isinstance(doc, dict):
                doc.pop("id", None)
                # allow_nan=False: json.loads turns NaN, Infinity and also a plain
                # 1e400 into floats that dumps would write as bare tokens the
                # browser's JSON.parse rejects -- one such row would break every
                # later GET. Here they raise ValueError instead.
                return json.dumps(doc, allow_nan=False)
        except (ValueError, RecursionError):  # not JSON, bad UTF-8, NaN/inf, or nested past the parser
            pass
        return self._error(400, "body must be a JSON object")


class Server(ThreadingHTTPServer):
    # SO_REUSEADDR stays on (http.server's default): after a stop the port sits in
    # TIME_WAIT for ~30 s, and without it a quick relaunch could not rebind it.
    # The catch, on macOS: with it a bind to 127.0.0.1 also succeeds while another
    # app listens on the wildcard 0.0.0.0:<port> or [::]:<port>, and our more
    # specific socket would silently win that app's loopback traffic. So
    # `claim_port` never binds a port that accepts a connection (`listening`).
    allow_reuse_address = True


def make_server(port: int, db_path: Path, page_path: Path, verbose: bool = False) -> Server:
    """A bound, not yet serving, server. Port 0 asks the OS for a free port.

    Bind comes first, so a busy port fails before anything touches the db. Then
    the pre-start snapshot, then the schema -- a bad db stops the start here
    instead of at the first save.
    """
    httpd = Server((HOST, port), Handler)
    httpd.db_path, httpd.page_path, httpd.verbose = Path(db_path), Path(page_path), verbose
    try:
        backup(httpd.db_path)
        connect(httpd.db_path).close()
    except BaseException:
        httpd.server_close()  # do not leave a bound socket behind a failed start
        raise
    return httpd


def listening(port: int) -> bool:
    """Does anything accept a connection on 127.0.0.1:<port>?

    Connection refused means nobody is listening, so the port is ours to take --
    even in TIME_WAIT. Anything that answers, planner or not, bound to loopback
    or to a wildcard address, is in the way.
    """
    try:
        socket.create_connection((HOST, port), timeout=1).close()
        return True
    except OSError:
        return False


def is_weekplan(port: int) -> bool:
    """Does the thing on this port answer like a planner? http.client, not urllib:
    urllib would send the request through a configured system proxy."""
    try:
        with closing(HTTPConnection(HOST, port, timeout=1)) as conn:
            conn.request("GET", "/api/ping")
            return json.loads(conn.getresponse().read()).get("app") == "weekplan"
    except (OSError, ValueError, AttributeError):  # refused, timed out, not HTTP, not JSON, not an object
        return False


def claim_port(first: int, last: int, db_path: Path, page_path: Path, verbose: bool = False):
    """-> (server, port) for the first free port in first..last.

    -> (None, port) when a planner is already running anywhere in the range: a
    second launch opens that one instead of starting a twin on the same db. The
    whole range is checked before anything is bound -- otherwise a planner on
    8011 would not stop a relaunch from binding a freed 8010 beside it.
    """
    ports = range(first, last + 1)
    for port in ports:
        if is_weekplan(port):
            return None, port
    for port in ports:
        # Re-checked here too: a twin launched a moment earlier may have bound
        # this port after the first pass looked at it.
        if listening(port):
            if is_weekplan(port):
                return None, port
            continue
        try:
            httpd = make_server(port, db_path, page_path, verbose)
            return httpd, httpd.server_address[1]
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE:
                raise  # a real failure (permissions, disk), not a busy port
            if is_weekplan(port):
                return None, port
    raise OSError(errno.EADDRINUSE, f"no free port in {first}-{last}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="מתכנן השבוע — שרת מקומי")
    ap.add_argument("--port", type=int, help=f"exactly this port, no scanning (default: first free of {DEFAULT_PORT}..{DEFAULT_PORT + PORT_SPAN - 1})")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR, help=f"where {DB_NAME} and backups/ live (default: {DATA_DIR.name}/)")
    args = ap.parse_args(argv)
    if args.port is not None and not 0 <= args.port <= 65535:
        print(f"פורט לא תקין: {args.port} (צריך מספר בין 0 ל-65535).", file=sys.stderr, flush=True)
        return 1

    # An explicit --port is a promise about the address (a bookmark, a preview
    # config): honour exactly it or fail, never quietly serve from another one.
    first = DEFAULT_PORT if args.port is None else args.port
    last = first + PORT_SPAN - 1 if args.port is None else first
    db_path = args.data_dir / DB_NAME
    try:
        httpd, port = claim_port(first, last, db_path, PAGE_PATH, verbose=True)
    except (OSError, sqlite3.Error) as exc:
        # One plain line for the person who double-clicked, not a traceback.
        if getattr(exc, "errno", None) == errno.EADDRINUSE and args.port is None:
            msg = f"לא נמצא פורט פנוי ({first}–{last}). סגור תוכנה שתופסת אותם ונסה שוב."
        elif getattr(exc, "errno", None) == errno.EADDRINUSE:
            msg = f"הפורט {first} תפוס. סגור את התוכנה שתופסת אותו ונסה שוב."
        else:
            msg = f"השרת לא הצליח להתחיל: {exc}"
        print(msg, file=sys.stderr, flush=True)
        return 1
    url = f"http://{HOST}:{port}"
    # Flushed: under a double-clicked .command stdout is a pipe, so a buffered
    # banner leaves the Terminal window blank.
    if httpd is None:
        print(f"המתכנן כבר פועל  →  {url}", flush=True)
    else:
        print(f"מתכנן השבוע      →  {url}", flush=True)
        print(f"קובץ הנתונים     →  {db_path}", flush=True)
        print("סגירת החלון עוצרת את השרת.\n", flush=True)
    # After the bind, so the browser can never arrive before the listening socket.
    if not args.no_browser:
        webbrowser.open(url)
    if httpd is None:
        return 0
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nנעצר.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
