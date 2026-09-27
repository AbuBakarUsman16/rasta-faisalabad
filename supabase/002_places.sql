-- Rasta Faisalabad: logon ki add ki hui jagahein (jo OpenStreetMap mein nahi, maslan markets, plazas).
-- Supabase dashboard > SQL Editor > New query: yeh poori file paste kar ke "Run". Dobara chalana mehfooz hai.

-- naam ko search ke liye aik jaisa banana: chhote huroof, "-e-" / " e " hata do, faltu nishaan hata do
-- "Shaheed-e-Millat Market" / "shaheed e millat market" -> "shaheed millat market"
create or replace function public.place_norm(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             ' ' || regexp_replace(lower(t), '[^a-z0-9؀-ۿ]+', ' ', 'g') || ' ',
             ' (e|i|ul|ud) ', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 3 and 80),
  norm        text generated always as (public.place_norm(name)) stored,
  lat         double precision not null check (lat between 31.20 and 31.65),
  lng         double precision not null check (lng between 72.80 and 73.40),
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade
);
create index if not exists places_norm on public.places (norm);

-- spam ki had: aik user, aik din, 20 jagahein
create or replace function public.places_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.places
      where created_by = new.created_by and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limit';
  end if;
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.created_at := now();
  return new;
end $$;
drop trigger if exists places_before_insert on public.places;
create trigger places_before_insert before insert on public.places
  for each row execute function public.places_before_insert();

alter table public.places enable row level security;
drop policy if exists "places: sab parh sakte hain" on public.places;
create policy "places: sab parh sakte hain" on public.places
  for select to anon, authenticated using (true);
drop policy if exists "places: apni jagah daalo" on public.places;
create policy "places: apni jagah daalo" on public.places
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "places: apni jagah hatao" on public.places;
create policy "places: apni jagah hatao" on public.places
  for delete to authenticated using (created_by = auth.uid());
