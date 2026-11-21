-- public.items as deployed (documentation + a fresh project). Safe to re-run.
create table if not exists public.items (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  doc jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.items enable row level security;
drop policy if exists items_owner on public.items;
create policy items_owner on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.items to authenticated;
