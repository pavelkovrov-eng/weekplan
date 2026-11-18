-- WeekPlan: the Moodle calendar link of each user (2026-11-18). Run once in Supabase → SQL Editor.
-- The link carries the user's Moodle calendar key, so it lives here (RLS: only its owner) and never in items, the cache or the GitHub backup.
create table if not exists public.moodle_link (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  url text not null check (url like 'https://mama.mta.ac.il/calendar/export_execute.php?%'),
  updated_at timestamptz not null default now()
);
alter table public.moodle_link enable row level security;
drop policy if exists "own link" on public.moodle_link;
create policy "own link" on public.moodle_link for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.moodle_link to authenticated;
