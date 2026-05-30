create table if not exists public.reef_shared_state (
  id text primary key default 'default',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reef_shared_state enable row level security;

drop policy if exists "Anyone can read the shared reef state" on public.reef_shared_state;
create policy "Anyone can read the shared reef state"
on public.reef_shared_state
for select
to anon, authenticated
using (id = 'default');

drop policy if exists "Anyone can insert the shared reef state" on public.reef_shared_state;
create policy "Anyone can insert the shared reef state"
on public.reef_shared_state
for insert
to anon, authenticated
with check (id = 'default');

drop policy if exists "Anyone can update the shared reef state" on public.reef_shared_state;
create policy "Anyone can update the shared reef state"
on public.reef_shared_state
for update
to anon, authenticated
using (id = 'default')
with check (id = 'default');

grant select, insert, update on public.reef_shared_state to anon, authenticated;
