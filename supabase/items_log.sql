-- Change log for public.items: every UPDATE (doc changed) and DELETE keeps the OLD row here for 60 days,
-- so a bad sync or a wipe can be undone by hand. Run once in the Supabase SQL Editor (safe to re-run).
-- Only the trigger writes; a signed-in user can only SELECT (and, through the app's wipe, DELETE) their own rows. Rows older than 60 days
-- are removed (for that user) whenever that user changes or deletes an item.
-- Example, the last deletions of the signed-in user:
--   select item_id, doc, at from public.items_log where op = 'delete' order by at desc limit 50;
create table if not exists public.items_log (
  n bigserial primary key,
  user_id uuid not null,
  item_id text not null,
  op text not null check (op in ('update','delete')),
  doc jsonb not null,
  at timestamptz not null default now()
);
create index if not exists items_log_user_at on public.items_log (user_id, at desc);

create or replace function public.items_log_old() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.doc is not distinct from old.doc then return new; end if; -- nothing changed
  insert into public.items_log (user_id, item_id, op, doc) values (old.user_id, old.id, lower(tg_op), old.doc);
  delete from public.items_log where user_id = old.user_id and at < now() - interval '60 days';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists items_log_trg on public.items;
create trigger items_log_trg before update or delete on public.items
  for each row execute function public.items_log_old();

alter table public.items_log enable row level security;
drop policy if exists items_log_owner on public.items_log;
create policy items_log_owner on public.items_log for select to authenticated using (user_id = auth.uid());
drop policy if exists items_log_wipe on public.items_log;
create policy items_log_wipe on public.items_log for delete to authenticated using (user_id = auth.uid()); -- "מחיקת כל הנתונים שלי" also empties the user's own log
revoke all on public.items_log from anon, authenticated;
grant select, delete on public.items_log to authenticated;
