insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reef-photos',
  'reef-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their reef photos" on storage.objects;
drop policy if exists "Users can upload their reef photos" on storage.objects;
drop policy if exists "Users can update their reef photos" on storage.objects;
drop policy if exists "Users can delete their reef photos" on storage.objects;

drop policy if exists "Anyone can read shared reef photos" on storage.objects;
create policy "Anyone can read shared reef photos"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'reef-photos'
  and (storage.foldername(name))[1] = 'shared'
);

drop policy if exists "Anyone can upload shared reef photos" on storage.objects;
create policy "Anyone can upload shared reef photos"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'reef-photos'
  and (storage.foldername(name))[1] = 'shared'
);

drop policy if exists "Anyone can update shared reef photos" on storage.objects;
create policy "Anyone can update shared reef photos"
on storage.objects
for update
to anon, authenticated
using (
  bucket_id = 'reef-photos'
  and (storage.foldername(name))[1] = 'shared'
)
with check (
  bucket_id = 'reef-photos'
  and (storage.foldername(name))[1] = 'shared'
);

drop policy if exists "Anyone can delete shared reef photos" on storage.objects;
create policy "Anyone can delete shared reef photos"
on storage.objects
for delete
to anon, authenticated
using (
  bucket_id = 'reef-photos'
  and (storage.foldername(name))[1] = 'shared'
);
