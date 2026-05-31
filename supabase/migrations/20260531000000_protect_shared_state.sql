create table if not exists public.reef_shared_state_history (
  history_id bigint generated always as identity primary key,
  shared_state_id text not null,
  data jsonb not null,
  source_updated_at timestamptz,
  captured_at timestamptz not null default now()
);

create or replace function public.reef_shared_state_has_user_data(payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(jsonb_array_length(coalesce(payload->'livestock', '[]'::jsonb)), 0) > 0
    or coalesce(jsonb_array_length(coalesce(payload->'waterTests', '[]'::jsonb)), 0) > 0
    or coalesce(jsonb_array_length(coalesce(payload->'events', '[]'::jsonb)), 0) > 0
    or coalesce(jsonb_array_length(coalesce(payload->'insightRuns', '[]'::jsonb)), 0) > 0
    or coalesce(jsonb_array_length(coalesce(payload->'profile'->'lightingPhotos', '[]'::jsonb)), 0) > 0
    or exists (
      select 1
      from jsonb_each_text(coalesce(payload->'profile', '{}'::jsonb)) as profile_field(key, value)
      where profile_field.key in (
        'displayVolume',
        'totalVolume',
        'startDate',
        'tankStyle',
        'filtration',
        'lightingModel',
        'lightingSummary',
        'saltMix',
        'dosing',
        'notes'
      )
      and btrim(profile_field.value) <> ''
    )
    or coalesce(nullif(payload->'profile'->>'proteinSkimmer', '')::boolean, false)
    or coalesce(nullif(payload->'profile'->>'refugium', '')::boolean, false)
    or coalesce(nullif(payload->'profile'->>'autoTopOff', '')::boolean, false)
    or exists (
      select 1
      from jsonb_array_elements(coalesce(payload->'zones', '[]'::jsonb)) as zone(value)
      where btrim(coalesce(zone.value->>'parMin', '')) <> ''
         or btrim(coalesce(zone.value->>'parMax', '')) <> ''
         or btrim(coalesce(zone.value->>'notes', '')) <> ''
    );
$$;

create or replace function public.backup_reef_shared_state_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.data is distinct from new.data then
    insert into public.reef_shared_state_history (shared_state_id, data, source_updated_at)
    values (old.id, old.data, old.updated_at);
  end if;

  return new;
end;
$$;

create or replace function public.prevent_empty_reef_shared_state_overwrite()
returns trigger
language plpgsql
as $$
begin
  if public.reef_shared_state_has_user_data(old.data)
    and not public.reef_shared_state_has_user_data(new.data)
    and coalesce((new.data->'_meta'->>'allowEmptyOverwrite')::boolean, false) = false
  then
    raise exception 'Refusing to overwrite populated reef shared state with empty/default state.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists backup_reef_shared_state_before_update on public.reef_shared_state;
create trigger backup_reef_shared_state_before_update
before update of data on public.reef_shared_state
for each row
execute function public.backup_reef_shared_state_before_update();

drop trigger if exists prevent_empty_reef_shared_state_overwrite on public.reef_shared_state;
create trigger prevent_empty_reef_shared_state_overwrite
before update of data on public.reef_shared_state
for each row
execute function public.prevent_empty_reef_shared_state_overwrite();
