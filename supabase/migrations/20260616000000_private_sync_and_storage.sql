grant select, insert, update, delete on public.reef_app_state to authenticated;
grant select, insert on public.reef_insight_runs to authenticated;
revoke all on public.reef_app_state from anon;
revoke all on public.reef_insight_runs from anon;

drop policy if exists "Anyone can read the shared reef state" on public.reef_shared_state;
drop policy if exists "Anyone can insert the shared reef state" on public.reef_shared_state;
drop policy if exists "Anyone can update the shared reef state" on public.reef_shared_state;
revoke all on public.reef_shared_state from anon, authenticated;

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

drop policy if exists "Anyone can read shared reef photos" on storage.objects;
drop policy if exists "Anyone can upload shared reef photos" on storage.objects;
drop policy if exists "Anyone can update shared reef photos" on storage.objects;
drop policy if exists "Anyone can delete shared reef photos" on storage.objects;
drop policy if exists "Users can read their reef photos" on storage.objects;
drop policy if exists "Users can upload their reef photos" on storage.objects;
drop policy if exists "Users can update their reef photos" on storage.objects;
drop policy if exists "Users can delete their reef photos" on storage.objects;

create policy "Users can read their reef photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can upload their reef photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update their reef photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete their reef photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'reef-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- One-time legacy adoption:
-- If reef_shared_state.default already contains your real tank data, copy it
-- to your private row before or immediately after this migration by replacing
-- the UUID below with your auth.users.id and running it in the Supabase SQL editor.
--
-- insert into public.reef_app_state (user_id, data, updated_at)
-- select '00000000-0000-0000-0000-000000000000'::uuid, data, updated_at
-- from public.reef_shared_state
-- where id = 'default'
-- on conflict (user_id) do update
-- set data = excluded.data,
--     updated_at = excluded.updated_at;
