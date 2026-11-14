# Multi-user WeekPlan on Supabase (design)

Status: approved 2026-11-14. Step 1 (owner only) code is written: mode `sb` in index.html. Project: `https://yemvjkopkeheshifunbu.supabase.co` (Frankfurt, name WeekPlanStudents); the publishable key is in the page by design.

## Goal

About 20 first-year students of the same department (Economics & Management, MTA) use their own copy of the planner, signed in with Google, each seeing only their own data. The owner stays the first user. No server of our own.

## Decisions (from the discussion)

- Users: ~20 students, same college, same department, same year (year A).
- Sign-in: Google only (Supabase Auth, OAuth). No passwords, no magic links.
- Backend: Supabase free tier, EU region (Frankfurt). No own server, no domain.
- Site stays on GitHub Pages (`pavelkovrov-eng/weekplan`, public code, no data). Same `index.html`.
- Data: one row per item, owned by `auth.uid()`, isolated by Row Level Security.
- Timetable and exams: per track (מקבץ) and English level, chosen at first sign-in, instead of the hard-coded tables.
- The week A/B rotation is gone (removed 2026-11); recurring means weekly.
- GitHub storage (`weekplan-data/items.json`) stays as a backup path, nothing is deleted.

## Not decided / open

- Reminders (Web Push) are step 4: VAPID keys, an Edge Function on a cron, iOS needs "Add to Home Screen" (iOS 16.4+).
- Free tier pauses a project after a week without activity and has no automatic backups: add our own nightly export to the private GitHub repo.

## Architecture

```
browser (index.html, GitHub Pages) --HTTPS--> Supabase: Auth (Google) + Postgres (RLS) [+ Edge Function cron later]
```

The page talks to Supabase directly over its REST/Auth endpoints with `fetch` (no library, like the GitHub mode). The `anon` key is public by design; RLS is the only thing protecting data, so policies must be right before anyone is invited.

## Data model

```sql
create table items (
  id text not null,                    -- same 20-hex ids as today
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  doc jsonb not null,                  -- the existing item doc, unchanged
  updated_at timestamptz not null default now(),
  primary key (user_id, id)            -- ids only need to be unique per user (a shared import must not collide)
);
alter table items enable row level security;
create policy own_items on items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.items to authenticated;

create table profiles (               -- step 2
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  track text, english text, created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy own_profile on profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Items keep today's doc shapes (`open|close|study|other|due|off|cancel`, `anchor` docs ignored), so core code is unchanged. Timetable/exam data for each track lives in the code as a table (step 2), not per user in the db: all students share the same department, so no `classes` table is needed.

## App changes (new storage mode `sb`)

- Mode detection: a stored Supabase session (`wp.sb`) selects mode `sb`; otherwise the sign-in screen offers "התחבר עם Google". Existing modes (`srv`, `gh`, `db`, `local`, `ro`) keep working.
- Auth: Google OAuth through Supabase's hosted `/auth/v1/authorize?provider=google&redirect_to=<site>`; the redirect returns tokens in the URL fragment; store access + refresh token in `localStorage` (try/catch), refresh before expiry, sign-out clears.
- CRUD: same `saveItem(id,doc,msg)` contract: `POST/PATCH/DELETE /rest/v1/items`, load with `GET /rest/v1/items?select=id,doc`. Reload on `visibilitychange`/`online` like GH mode; offline cache like `wp.gh.cache`.
- CSP: add the project URL to `connect-src` (and it is the only new host).
- One-time "העבר את הנתונים שלי": upload the items from the current source (GitHub store) into `items`, id preserved, skipping ids that exist.
- Never trust the client for ownership: `user_id` defaults to `auth.uid()` and RLS enforces it.

## Steps

1. **Only the owner.** Supabase project + Google OAuth + `items` table with RLS, mode `sb`, migration button, sign-out. Done when the owner's 61 items load from Supabase on phone and computer and edits persist; GitHub stays as backup.
2. **Timetable per track.** Track + English level chosen at first sign-in (`profiles`); timetable and exams become tables per track instead of `BASE`/`EXAMS`/`COURSE`. Needs the list of tracks and each timetable (Yedion export).
3. **Isolation test, then invite.** Two Google accounts must not see each other's rows (read, write, delete, direct REST calls with the anon key). Add a one-line privacy notice at sign-in, "export my data" and "delete my account" buttons. Only then invite friends.
4. **Reminders and backup.** Web Push (service worker, VAPID, Edge Function on cron), "Add to Home Screen" onboarding for iPhone, nightly export of all items to the private GitHub repo.

## Privacy and security

- Personal data of other students (email, shifts, deadlines) is held by a cloud provider: say so at sign-in in one plain sentence.
- Tokens only in `localStorage` of that origin; note the shared `pavelkovrov-eng.github.io` origin with another site (AmiraNet): code there can read it. Prefer moving the planner to its own origin if it ever matters.
- Secrets that must never be sent to the assistant or committed: the Google OAuth client secret, the Supabase `service_role` key. Only the project URL and the `anon` key go into the page.
- Rate limits and quotas: free tier is enough for ~20 users; check the current limits on the Supabase site.

## Testing

- Pure core stays tested with `node --test test.mjs`; add tests for the Supabase request builders and the item mapping (no network).
- RLS is tested for real with two accounts (step 3), not by reading policies.
