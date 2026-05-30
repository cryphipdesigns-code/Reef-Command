create extension if not exists pgcrypto;

create table if not exists public.reef_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reef_insight_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  question text,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.reef_app_state enable row level security;
alter table public.reef_insight_runs enable row level security;

drop policy if exists "Users can read their reef app state" on public.reef_app_state;
create policy "Users can read their reef app state"
on public.reef_app_state
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their reef app state" on public.reef_app_state;
create policy "Users can insert their reef app state"
on public.reef_app_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their reef app state" on public.reef_app_state;
create policy "Users can update their reef app state"
on public.reef_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read their insight runs" on public.reef_insight_runs;
create policy "Users can read their insight runs"
on public.reef_insight_runs
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their insight runs" on public.reef_insight_runs;
create policy "Users can insert their insight runs"
on public.reef_insight_runs
for insert
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reef-photos',
  'reef-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their reef photos" on storage.objects;
create policy "Users can read their reef photos"
on storage.objects
for select
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can upload their reef photos" on storage.objects;
create policy "Users can upload their reef photos"
on storage.objects
for insert
with check (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update their reef photos" on storage.objects;
create policy "Users can update their reef photos"
on storage.objects
for update
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete their reef photos" on storage.objects;
create policy "Users can delete their reef photos"
on storage.objects
for delete
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);
