"""Tests for server.py, the local planner server.

Every test runs against a temp dir and an OS-assigned port (port 0): never the
real data/ dir, never port 8010, never a browser.

    python3 -m unittest -v test_server.py
"""

import contextlib
import errno
import http.client
import http.server
import io
import json
import re
import socket
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

import server

PAGE = "<!doctype html><title>תכנון השבוע</title>"
JSON = "application/json"
OK = {"ok": True}


def listening(port):
    """Does anything accept a connection on 127.0.0.1:<port>?"""
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return True
    except OSError:
        return False


def serve_in_thread(httpd, case):
    """Run `httpd` on a daemon thread; stop it when the test ends (or earlier,
    via the returned `stop`; stopping twice is harmless)."""
    # A short poll interval: shutdown() waits up to one interval, 0.5 s by default.
    thread = threading.Thread(target=httpd.serve_forever, args=(0.01,), daemon=True)
    thread.start()

    def stop():
        httpd.shutdown()
        httpd.server_close()
        thread.join()

    case.addCleanup(stop)
    return stop


class ServerCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.db = self.dir / "data" / "weekplan.db"
        self.page = self.dir / "page.html"
        self.page.write_text(PAGE, encoding="utf-8")
        self.httpd = server.make_server(0, self.db, self.page)
        self.port = self.httpd.server_address[1]
        serve_in_thread(self.httpd, self)

    def call(self, method, path, body=None, ctype=JSON, headers=None):
        """One request -> (status, body, response headers).

        `body` is a dict (sent as JSON) or raw bytes. The response body comes
        back parsed when it is JSON, raw bytes otherwise.
        """
        headers = dict(headers or {})
        if ctype:
            headers["Content-Type"] = ctype
        if not isinstance(body, (bytes, type(None))):
            body = json.dumps(body).encode()
        with closing(http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)) as conn:
            conn.request(method, path, body, headers)
            resp = conn.getresponse()
            raw = resp.read()
        is_json = resp.getheader("Content-Type", "").startswith(JSON)
        return resp.status, json.loads(raw) if is_json else raw, resp.headers

    def items(self):
        return self.call("GET", "/api/items")[1]["items"]

    def stored(self):
        with closing(sqlite3.connect(self.db)) as c:
            return c.execute("SELECT id, doc FROM items ORDER BY rowid").fetchall()


class PageAndPing(ServerCase):
    def test_page_is_read_from_disk_on_every_request(self):
        status, body, h = self.call("GET", "/")
        self.assertEqual((status, body), (200, PAGE.encode()))
        self.assertEqual(h["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(h["Cache-Control"], "no-store")
        self.page.write_text("<p>v2", encoding="utf-8")
        self.assertEqual(self.call("GET", "/?x=1")[1], b"<p>v2")  # query string ignored

    def test_every_response_refuses_framing(self):
        for method, path, headers in (("GET", "/", None), ("GET", "/api/ping", None), ("GET", "/nope", None),
                                      ("GET", "/api/ping", {"Host": "evil.example"}),  # our 403
                                      ("OPTIONS", "/api/items", None)):  # http.server's own 501
            self.assertEqual(self.call(method, path, headers=headers)[2]["X-Frame-Options"], "DENY", (method, path))

    def test_ping(self):
        status, body, h = self.call("GET", "/api/ping")
        self.assertEqual((status, body), (200, {"app": "weekplan", "v": 1}))
        self.assertEqual(h["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(h["Cache-Control"], "no-store")


class Pwa(ServerCase):
    TYPES = {"/manifest.webmanifest": "application/manifest+json", "/sw.js": "text/javascript; charset=utf-8",
             "/icon-192.png": "image/png", "/icon-512.png": "image/png", "/apple-touch-icon.png": "image/png"}

    def test_shell_files_are_served_with_the_right_types(self):
        self.assertEqual(set(self.TYPES), set(server.STATIC))
        for path, ctype in self.TYPES.items():
            status, body, h = self.call("GET", path + "?v=1")
            self.assertEqual((status, h["Content-Type"], h["Cache-Control"]), (200, ctype, "no-store"), path)
            self.assertEqual(h["X-Frame-Options"], "DENY")
            self.assertEqual(body, (server.ROOT / path[1:]).read_bytes(), path)
            self.assertGreater(len(body), 100, path)
        for path in ("/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"):
            self.assertEqual(self.call("GET", path)[1][:8], b"\x89PNG\r\n\x1a\n")

    def test_shell_files_obey_the_host_guard_and_only_answer_get(self):
        for path in self.TYPES:
            self.assertEqual(self.call("GET", path, headers={"Host": "evil.example"})[0], 403, path)
            for method in ("POST", "PUT", "DELETE"):
                self.assertEqual(self.call(method, path, {})[0], 404, (method, path))
            self.assertEqual(self.call("GET", path + "/")[0], 404, path)
        self.assertEqual(self.call("GET", "/icon-256.png")[0], 404)
        self.assertEqual(self.call("GET", "/Sw.js")[0], 404)

    def test_manifest_and_service_worker_match_the_files_on_disk(self):
        man = json.loads(self.call("GET", "/manifest.webmanifest")[1])
        self.assertEqual((man["display"], man["lang"], man["dir"], man["start_url"]), ("standalone", "he", "rtl", "./"))
        self.assertEqual([i["sizes"] for i in man["icons"]], ["192x192", "512x512"])
        for icon in man["icons"]:
            self.assertIn("/" + icon["src"], server.STATIC)
        sw = (server.ROOT / "sw.js").read_text(encoding="utf-8")
        shell = re.search(r"SHELL=\[(.*?)\]", sw).group(1)
        for name in re.findall(r"'([^']+)'", shell):
            self.assertTrue(name == "./" or (server.ROOT / name).is_file(), name)
        page = (server.ROOT / "index.html").read_text(encoding="utf-8")
        for ref in ('rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon" href="apple-touch-icon.png"', "register('sw.js')"):
            self.assertIn(ref, page)


class Items(ServerCase):
    def test_crud_round_trip(self):
        self.assertEqual(self.items(), [])
        doc = {"kind": "event", "title": "מבחן באלגברה", "n": [1, 2]}
        status, body, _ = self.call("POST", "/api/items", doc)
        iid = body["id"]
        self.assertEqual(status, 201)
        self.assertRegex(iid, r"^[0-9a-f]{20}$")
        self.assertEqual(self.items(), [{**doc, "id": iid}])

        self.assertEqual(self.call("PUT", "/api/items/fresh-id_1", {"a": 1})[:2], (200, OK))  # upsert
        edited = {"kind": "event", "title": "אחרי עריכה"}
        self.assertEqual(self.call("PUT", f"/api/items/{iid}", edited)[:2], (200, OK))
        # replaced, not merged -- and the edited item keeps its place in the list
        self.assertEqual(self.items(), [{**edited, "id": iid}, {"a": 1, "id": "fresh-id_1"}])

        self.assertEqual(self.call("DELETE", f"/api/items/{iid}")[:2], (200, OK))
        self.assertEqual(self.call("DELETE", f"/api/items/{iid}")[:2], (200, OK))  # already gone
        self.assertEqual(self.items(), [{"a": 1, "id": "fresh-id_1"}])

    def test_id_inside_a_body_is_ignored_and_never_stored(self):
        iid = self.call("POST", "/api/items", {"id": "evil", "a": 1})[1]["id"]
        self.assertNotEqual(iid, "evil")
        self.call("PUT", "/api/items/abc", {"id": "zzz", "b": 2})
        self.assertEqual(self.items(), [{"a": 1, "id": iid}, {"b": 2, "id": "abc"}])
        for _, doc in self.stored():
            self.assertNotIn("id", json.loads(doc))

    def test_id_shape(self):
        long_ok, too_long = "a" * 64, "a" * 65
        self.assertEqual(self.call("PUT", f"/api/items/{long_ok}", {})[0], 200)
        self.assertEqual(self.call("PUT", f"/api/items/{too_long}", {})[0], 404)

    def test_unknown_paths_404(self):
        for path in ("/data/weekplan.db", "/server.py", "/../x", "/index.html", "/api",
                     "/api/items/", "/api/items/a/b", "/api/items/bad%20id", "/api/items/x%2Fy"):
            self.assertEqual(self.call("GET", path)[0], 404, path)
        for method, path in (("GET", "/api/items/abc"), ("POST", "/api/ping"), ("POST", "/api/items/abc"),
                             ("PUT", "/api/items"), ("DELETE", "/api/items"), ("POST", "/"),
                             ("PUT", "/api/items/bad%20id"), ("DELETE", "/api/items/bad%20id")):
            self.assertEqual(self.call(method, path, {})[0], 404, (method, path))
        self.assertEqual(self.stored(), [])

    def test_body_limits_and_bad_json(self):
        exact = b'{"k":"' + b"x" * (server.MAX_BODY - len(b'{"k":""}')) + b'"}'
        self.assertEqual(len(exact), server.MAX_BODY)
        self.assertEqual(self.call("POST", "/api/items", exact)[0], 201)  # the limit itself is fine
        self.assertEqual(self.call("POST", "/api/items", b"{}", headers={"Content-Length": str(server.MAX_BODY + 1)})[0], 413)
        self.assertEqual(self.call("PUT", "/api/items/a", b"{}", headers={"Content-Length": str(2**40)})[0], 413)
        deep = b'{"a":' + b"[" * 300_000 + b"]" * 300_000 + b"}"  # parser recursion overflow
        for bad in (b"", b"{", b"not json", b"[]", b'"s"', b"1", b"null", b'{"a":NaN}', b'{"a":Infinity}',
                    b"\xff\xfe", deep):
            self.assertEqual(self.call("POST", "/api/items", bad)[0], 400, bad[:20])
            self.assertEqual(self.call("PUT", "/api/items/a", bad)[0], 400, bad[:20])
        self.assertEqual(self.call("POST", "/api/items", b"{}", headers={"Content-Length": "abc"})[0], 400)
        self.assertEqual(len(self.stored()), 1)  # only the exact-limit item landed

    def test_a_number_that_overflows_to_infinity_is_refused(self):
        # json.loads turns 1e400 into inf; stored, it would read back as the
        # non-JSON token Infinity and break every later GET in the browser.
        for bad in (b'{"a":1e400}', b'{"a":-1e999}', b'{"a":[1,{"b":1e400}]}'):
            self.assertEqual(self.call("POST", "/api/items", bad)[0], 400, bad)
        self.assertEqual(self.items(), [])

    def test_a_stored_id_never_overrides_the_row_id(self):
        with closing(sqlite3.connect(self.db)) as c:  # planted by hand: the API cannot produce this
            c.execute("INSERT INTO items VALUES ('real', '{\"id\": \"fake\", \"a\": 1}', 'x')")
            c.commit()
        self.assertEqual(self.items(), [{"a": 1, "id": "real"}])

    def test_lone_surrogate_cannot_poison_storage(self):
        self.assertEqual(self.call("POST", "/api/items", rb'{"a":"\ud800"}')[0], 201)
        self.assertEqual(self.call("GET", "/api/items")[0], 200)


class Guards(ServerCase):
    def test_wrong_host_is_403_on_every_route(self):
        for host in ("evil.example", "127.0.0.1", "localhost", "127.0.0.1:1", f"evil.example:{self.port}", ""):
            for method, path in (("GET", "/"), ("GET", "/api/ping"), ("GET", "/api/items"),
                                 ("POST", "/api/items"), ("PUT", "/api/items/a"), ("DELETE", "/api/items/a")):
                self.assertEqual(self.call(method, path, {}, headers={"Host": host})[0], 403, (host, method, path))
        self.assertEqual(self.stored(), [])
        self.assertEqual(self.call("GET", "/api/ping", headers={"Host": f"localhost:{self.port}"})[0], 200)

    def test_origin_must_be_the_servers_own(self):
        for origin in ("http://evil.example", "null", f"http://127.0.0.1:{self.port + 1}", f"https://127.0.0.1:{self.port}"):
            for method, path in (("POST", "/api/items"), ("PUT", "/api/items/a"), ("DELETE", "/api/items/a")):
                self.assertEqual(self.call(method, path, {}, headers={"Origin": origin})[0], 403, (origin, method))
        self.assertEqual(self.stored(), [])
        own = f"http://127.0.0.1:{self.port}"
        self.assertEqual(self.call("POST", "/api/items", {}, headers={"Origin": own})[0], 201)
        both = {"Host": f"localhost:{self.port}", "Origin": f"http://localhost:{self.port}"}
        self.assertEqual(self.call("POST", "/api/items", {}, headers=both)[0], 201)

    def test_writes_require_the_json_content_type(self):
        for ctype in (None, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonx"):
            for method, path in (("POST", "/api/items"), ("PUT", "/api/items/a"), ("DELETE", "/api/items/a")):
                self.assertEqual(self.call(method, path, b"{}", ctype=ctype)[0], 415, (ctype, method))
        self.assertEqual(self.stored(), [])
        for ctype in ("application/json; charset=utf-8", "Application/JSON"):
            self.assertEqual(self.call("POST", "/api/items", {}, ctype=ctype)[0], 201, ctype)

    def test_no_cors_headers_anywhere(self):
        preflight = {"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"}
        status, _, h = self.call("OPTIONS", "/api/items", headers=preflight)
        self.assertGreaterEqual(status, 400)  # a preflight must fail, so cross-site writes never start
        for resp in (h, self.call("GET", "/api/items", headers=preflight)[2], self.call("GET", "/")[2]):
            self.assertEqual([k for k in resp if k.lower().startswith("access-control")], [])


class Logging(ServerCase):
    def test_a_malformed_request_line_gets_a_400_and_no_traceback(self):
        # log_message used to read self.path before http.server had set it, so
        # the 400 for a bad request line died in the logger: an empty reply.
        httpd = server.make_server(0, self.db, self.page, verbose=True)
        serve_in_thread(httpd, self)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            with closing(socket.create_connection(("127.0.0.1", httpd.server_address[1]), timeout=5)) as s:
                s.sendall(b"GET /a b HTTP/1.1\r\n\r\n")  # four words: rejected before path is set
                reply = b""
                while chunk := s.recv(4096):
                    reply += chunk
        self.assertTrue(reply.startswith(b"HTTP/1.0 400"), reply[:40])
        self.assertEqual(err.getvalue(), "")
        self.assertIn("Bad request syntax", out.getvalue())


class Storage(ServerCase):
    def test_schema_and_pragmas(self):
        self.call("POST", "/api/items", {"a": 1})
        with closing(sqlite3.connect(self.db)) as c:
            self.assertEqual(c.execute("PRAGMA journal_mode").fetchone()[0], "wal")
            cols = [r[1] for r in c.execute("PRAGMA table_info(items)")]
            self.assertEqual(cols, ["id", "doc", "updated_at"])
            self.assertTrue(c.execute("SELECT updated_at FROM items").fetchone()[0].startswith("20"))
        with closing(server.connect(self.db)) as c:
            self.assertEqual(c.execute("PRAGMA synchronous").fetchone()[0], 2)  # FULL

    def test_no_backup_on_a_fresh_install(self):
        self.assertFalse((self.db.parent / "backups").exists())

    def test_start_snapshots_an_existing_db(self):
        self.call("POST", "/api/items", {"a": 1})
        server.make_server(0, self.db, self.page).server_close()  # a second start on the same db
        (snap,) = (self.db.parent / "backups").glob("weekplan-*.db")
        with closing(sqlite3.connect(snap)) as c:
            self.assertEqual(c.execute("SELECT count(*) FROM items").fetchone()[0], 1)

    def test_backups_are_pruned_to_the_newest_20(self):
        folder = self.db.parent / "backups"
        folder.mkdir()
        old = [folder / f"weekplan-20200101-0000{i:02d}.db" for i in range(25)]
        for f in old:
            f.touch()
        (folder / "notes.txt").touch()
        new = server.backup(self.db)
        left = sorted(folder.glob("weekplan-*.db"))
        self.assertEqual(len(left), 20)
        self.assertEqual(left, old[6:] + [new])  # oldest six gone, the fresh snapshot kept
        self.assertTrue((folder / "notes.txt").exists())  # only our own files are pruned


class Other(http.server.BaseHTTPRequestHandler):
    """Some other app holding a port: it answers every GET with plain text."""

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"hi")

    def log_message(self, *args):
        pass


class Other6(http.server.HTTPServer):
    address_family = socket.AF_INET6


class Ports(ServerCase):
    def other_app(self, host="127.0.0.1"):
        blocker = (Other6 if ":" in host else http.server.HTTPServer)((host, 0), Other)
        serve_in_thread(blocker, self)
        return blocker.server_address[1]

    def claim(self, first, last):
        httpd, port = server.claim_port(first, last, self.db, self.page)
        if httpd:
            self.addCleanup(httpd.server_close)
        return httpd, port

    def free_port(self):
        with closing(socket.socket()) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def test_free_port_is_taken(self):
        busy = self.other_app()
        httpd, port = self.claim(busy, busy + 4)
        self.assertIsNotNone(httpd)
        self.assertEqual(port, httpd.server_address[1])
        self.assertTrue(busy < port <= busy + 4)  # busy by another app -> the next free port

    def test_a_wildcard_listener_counts_as_busy(self):
        # macOS lets a 127.0.0.1 bind coexist with another app on 0.0.0.0:<port>
        # when SO_REUSEADDR is set -- and then we would hijack its loopback traffic.
        busy = self.other_app("0.0.0.0")
        httpd, port = self.claim(busy, busy + 4)
        self.assertTrue(busy < port <= busy + 4)

    def test_an_ipv6_wildcard_listener_counts_as_busy(self):
        try:
            busy = self.other_app("::")
        except OSError:
            self.skipTest("no IPv6 here")
        httpd, port = self.claim(busy, busy + 4)
        self.assertTrue(busy < port <= busy + 4)

    def test_a_quick_relaunch_keeps_the_port(self):
        # The server closes every connection first, so its port sits in TIME_WAIT
        # for ~30 s after a stop. That must not push the next launch to another
        # port: nothing is listening there, so it is free.
        first = self.free_port()
        httpd, port = self.claim(first, first + 4)
        stop = serve_in_thread(httpd, self)
        with closing(http.client.HTTPConnection("127.0.0.1", port, timeout=5)) as c:
            c.request("GET", "/api/ping")
            c.getresponse().read()
        stop()
        again, port_again = self.claim(first, first + 4)
        self.assertEqual(port_again, port)

    def test_a_planner_further_up_the_range_is_reopened_not_shadowed(self):
        # Binding the first free port while a planner sits on the next one would
        # start a second server on the same db.
        first = self.port - 1
        if listening(first):
            self.skipTest("neighbouring port busy")
        self.assertEqual(self.claim(first, first + 4), (None, self.port))
        self.assertFalse(listening(first))  # nothing was bound on the way

    def test_running_planner_is_detected_not_duplicated(self):
        self.assertEqual(self.claim(self.port, self.port + 4), (None, self.port))

    def test_nothing_free_raises(self):
        busy = self.other_app()
        with self.assertRaises(OSError):
            self.claim(busy, busy)

    def test_other_bind_errors_are_not_taken_for_a_busy_port(self):
        denied = PermissionError(errno.EACCES, "denied")
        with mock.patch.object(server, "make_server", side_effect=denied), self.assertRaises(PermissionError):
            server.claim_port(1, 2, self.db, self.page)

    def main(self, *argv, serve=False):
        """Run server.main on a temp data dir with the browser mocked and
        serve_forever a no-op. -> (exit code, stdout, stderr, browser mock)."""
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(server, "DATA_DIR", self.dir / "default-data"), \
                mock.patch.object(server, "PAGE_PATH", self.page), \
                mock.patch.object(server.webbrowser, "open") as opened, \
                mock.patch.object(server.Server, "serve_forever"), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = server.main(list(argv))
        return code, out.getvalue(), err.getvalue(), opened

    def test_main_reopens_the_running_planner(self):
        url = f"http://127.0.0.1:{self.port}"
        code, out, _, opened = self.main("--port", str(self.port))
        self.assertEqual(code, 0)
        opened.assert_called_once_with(url)
        self.assertIn(url, out)
        self.assertEqual(self.main("--port", str(self.port), "--no-browser")[3].call_count, 0)

    def test_main_default_scans_the_range_and_opens_what_it_bound(self):
        busy = self.other_app()
        with mock.patch.object(server, "DEFAULT_PORT", busy):
            code, out, _, opened = self.main()
        self.assertEqual(code, 0)
        (url,), _ = opened.call_args
        port = int(url.rsplit(":", 1)[1])
        self.assertTrue(busy < port < busy + server.PORT_SPAN)
        self.assertIn(url, out)

    def test_main_default_reopens_a_planner_found_anywhere_in_the_range(self):
        first = self.port - 3
        if any(listening(p) for p in range(first, self.port)):
            self.skipTest("neighbouring ports busy")
        with mock.patch.object(server, "DEFAULT_PORT", first):
            code, _, _, opened = self.main()
        self.assertEqual(code, 0)
        opened.assert_called_once_with(f"http://127.0.0.1:{self.port}")
        self.assertFalse(any(listening(p) for p in range(first, self.port)))

    def test_an_explicit_port_is_exact_no_scanning(self):
        busy = self.other_app()
        code, out, err, opened = self.main("--port", str(busy))
        self.assertEqual(code, 1)
        self.assertIn(str(busy), err)
        self.assertEqual(out, "")
        opened.assert_not_called()
        self.assertFalse(listening(busy + 1))

    def test_no_free_port_in_the_range_is_one_hebrew_line(self):
        busy = self.other_app()
        with mock.patch.object(server, "DEFAULT_PORT", busy), mock.patch.object(server, "PORT_SPAN", 1):
            code, _, err, opened = self.main()
        self.assertEqual(code, 1)
        self.assertRegex(err, r"^לא נמצא פורט פנוי \(\d+–\d+\)")
        self.assertEqual(err.count("\n"), 1)  # a line, not a traceback
        opened.assert_not_called()

    def test_a_start_failure_is_one_hebrew_line(self):
        data = self.dir / "unwritable"
        data.write_text("a file where the data dir should be")
        code, _, err, _ = self.main("--port", "0", "--data-dir", str(data))
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("השרת לא הצליח להתחיל"), err)
        self.assertEqual(err.count("\n"), 1)

    def test_data_dir_holds_the_db_and_backups(self):
        data = self.dir / "elsewhere"
        for _ in range(2):  # the second start snapshots what the first created
            code, out, _, _ = self.main("--port", "0", "--no-browser", "--data-dir", str(data))
            self.assertEqual(code, 0)
        self.assertTrue((data / "weekplan.db").exists())
        self.assertEqual(len(list((data / "backups").glob("weekplan-*.db"))), 1)
        self.assertIn(str(data / "weekplan.db"), out)
        self.assertFalse((self.dir / "default-data").exists())  # the default dir stayed untouched


if __name__ == "__main__":
    unittest.main()
