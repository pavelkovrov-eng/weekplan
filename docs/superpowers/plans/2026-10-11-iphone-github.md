# מתכנן השבוע באייפון — GitHub Pages + נתונים במאגר פרטי

> Execution: Sonnet implements one task at a time; Opus reviews task N while Sonnet builds N+1; single writer. Task 4 (GitHub side) is done by the controller with the user's explicit OK for every outward step.

**User decisions (2026-10-11):** the code goes in a public repo, `pavelkovrov-eng/weekplan`, served by GitHub Pages. The data lives in a private repo, `pavelkovrov-eng/weekplan-data`, file `items.json`. Mac and iPhone use the same URL and the same data, and the local server stays only as a fallback. On iPhone the app is added to the Home Screen; the main screen is a day view, with tabs יום/שבוע/חודש/מה מתקרב. Offline, it shows the last data read-only. No push notifications.

## Global constraints
- No build step, no npm, no external JS. The page stays one HTML file, renamed to `index.html` (Task 1) so Pages serves it at `/weekplan/`. Hebrew RTL copy, compact one-line style, and `esc()` for strings written into innerHTML. Colors are tokens, defined in all three token blocks.
- **Core:** `<script id="core">` stays pure. test.mjs exports the column-0 `const`/`function` names, one name per `const` line.
- **Existing modes must keep working unchanged:** `srv` (localhost server), `db` (claude.ai), `local` (file).
- **Never touch the real data:** no agent reads or writes `data/weekplan.db` or the real GitHub repos. Tests use stubs. Only the controller migrates data, in Task 4.
- The token is the user's: agents never create, paste or log one.

## Storage mode `gh` (Task 1)
- **Config:** localStorage `wp.gh` = `{owner,repo,token}`, defaulting to owner `pavelkovrov-eng` and repo `weekplan-data`. A setup dialog `#ghDlg` has fields for owner, repo and token (a password input); actions "שמירה" and "התנתקות" (which removes `wp.gh`), plus a short Hebrew explanation of how to create a fine-grained token limited to that one repo with Contents read/write.
- **Detection order at startup:**
  1. `srv` (existing localhost check).
  2. If `location.hostname` ends with `.github.io`, or `wp.gh` exists → `gh`. With no config, open `#ghDlg` and stay `loading`.
  3. `window.claude`.
  4. `local`.
- **API:** `https://api.github.com/repos/{owner}/{repo}/contents/items.json`, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `cache:'no-store'`.
  - **GET:** base64-decode `content` as UTF-8 and parse it. A 404 means an empty store with `sha=null`.
  - **PUT:** `{message, content, sha?, branch:'main'}`. `message` is e.g. `weekplan: save <id>` or `weekplan: delete <id>`.
- **File format:** `{"v":1,"items":{"<id>":{...doc}}}`, pretty-printed with 2 spaces and a trailing newline so the git diffs stay readable. Ids are generated client-side: 20 hex characters from `crypto.getRandomValues`.
- **Write path:** apply the op (set or delete by id) to a fresh copy and PUT it with the last `sha`. On 409, or on 422 with a sha mismatch, re-GET, re-apply the op to the new data and retry, up to 3 times. On success, update `items`, the `sha` and the cache, then render. Return `true`/`false` exactly like the other modes, so every caller (dialog, detach, toggles) behaves the same.
- **Errors:**
  - 401 or 403 → toast `המפתח לא תקף או שאין לו הרשאה. הדבק מפתח חדש.`, then open `#ghDlg`.
  - Network error → toast `אין חיבור לאינטרנט — השינוי לא נשמר.`
- **Offline:** every successful load or save writes `wp.gh.cache` = `{items,sha,at}`. If the load fails and a cache exists → mode `ro`, show the cached items, toast `אין חיבור — מוצג המצב האחרון (קריאה בלבד).` Retry on `online` and on `visibilitychange`.
- **Freshness:** when the page becomes visible again, re-GET and re-render, so the phone sees the Mac's changes.
- **UI:** `canEdit()` accepts `gh`. The status pill for `gh` reads `נשמר ב-GitHub`, class `db`. Add a small "חיבור ל-GitHub" link (in the footer or the header pill) that opens `#ghDlg`.
- **Pure helpers in core, with Node tests:**
  - `b64enc(str)` and `b64dec(b64)`: UTF-8 safe, Hebrew round-trips, tolerates the newlines GitHub puts inside base64.
  - `storeToItems(obj)` and `itemsToStore(items)`.
  - `applyOp(store,op)`.
  - `newId()` is not pure; keep it in the app script.
- **Rename:** `git mv "תכנון השבוע בסמסטר א'.html" index.html`, then update `server.py` (PAGE_PATH), `test.mjs`, `CLAUDE.md` and any other reference. The `<title>` stays Hebrew.

## Task 2 — iPhone layout: day view + tab bar
- **Phone layout:** applies when `matchMedia('(max-width: 600px)')` matches (width only; an iPhone turned sideways falls back to the desktop layout). Desktop keeps today's week/month toggle unchanged.
- **Tab bar:** fixed at the bottom with safe-area padding. Tabs יום / שבוע / חודש / מה מתקרב, each with an inline SVG icon and a label. Hide the desktop toggle on phone.
- **Day view:** `view='day'`, plus `viewDay` (an ISO date clamped to the semester-navigable range).
  - Header: a 7-day strip of the week (day initial + date) with the A/B tag. Tapping a day selects it.
  - Body: a vertical list ordered by time, in the same colors and types as the agenda. Classes, exams, shifts and deadlines; cancelled classes struck. The CAL label and "לימודים בוטלו" are shown.
  - Taps: a class opens `openCancel`, an own item or deadline opens `openEdit`, and an empty day shows "יום פנוי".
  - Swipe left/right (touch, ≥ 50px horizontal and mostly horizontal) moves ±1 day; the prev/next buttons do the same.
  - A floating round "+" button opens `openAdd` with the shown day's week and weekday preselected.
- **Week tab on phone:** the existing agenda for the week (`#agCard`) plus the summary. The wide grid is reachable through a "גריד" toggle with horizontal scroll.
- **Month tab:** the existing month view, with cells compacted for 390px.
- **מה מתקרב tab:** the `#up` card full screen.
- Touch targets must be ≥ 44px. Test at a 393×852 viewport (iPhone 15), light and dark.
- `view` persistence: `wp.view` may now also be `day`. A desktop never starts in `day`; it falls back to `week`.

## Task 3 — PWA shell
- `manifest.webmanifest`:
  - `name` "מתכנן השבוע", `short_name` "השבוע", `lang` "he", `dir` "rtl"
  - `start_url` "./", `scope` "./", `display` "standalone"
  - `theme_color` / `background_color` from the tokens
  - icons 192 and 512 PNG.
- `apple-touch-icon.png`, 180×180. Generate it with pure Python (stdlib zlib/struct PNG writer): a simple calendar glyph on the accent color, rounded corners not required.
- `<link rel="manifest">`, `apple-touch-icon`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-mobile-web-app-title`, `theme-color`, and `viewport-fit=cover` (already present).
- `sw.js`: precache `./`, `index.html`, the manifest and the icons. Navigation and app shell are network-first, falling back to the cache. **Never cache `api.github.com`** — that data is offline-cached by the page itself. Use a versioned cache name and clean old caches on `activate`.
- Register the service worker only on `https:` (not on localhost or file).
- A CSP `<meta>` limits `connect-src` to `'self' https://api.github.com`, keeps the fonts working, and adds no new third-party scripts. It must not break the claude.ai artifact copy (artifact publishing is legacy; do not republish).
- `server.py` must also serve the manifest, `sw.js` and the icons, as fixed routes, so local mode still works. Add tests.
- Add `.nojekyll` so Pages serves the files as-is.

## Task 4 — GitHub (controller only, every outward step confirmed with the user)
1. Show the user exactly what becomes public: `git ls-files`, plus a scan for personal data. Then create the public repo `weekplan`, push `main` and enable Pages from `main` at `/`.
2. Create the private repo `weekplan-data` and upload `items.json`, migrated from `data/weekplan.db` with a script that reads the SQLite file.
3. Walk the user through creating a fine-grained token: only `weekplan-data`, Contents read & write, with an expiry date. The user pastes it into the page on the Mac and on the iPhone.
4. Verify on the Mac: load, save and reload; check that the commit appears in `weekplan-data`. Then the iPhone Home Screen steps.
