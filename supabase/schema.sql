-- Rasta Faisalabad: database setup.
-- Supabase dashboard > SQL Editor > New query: yeh poori file paste kar ke "Run" dabayein.
-- Dobara chalana mehfooz hai (if not exists / or replace).

-- ---------- reports ----------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('closure', 'broken')),
  cat         text not null,
  lat         double precision not null check (lat between 31.20 and 31.65),
  lng         double precision not null check (lng between 72.80 and 73.40),
  note        text not null default '' check (char_length(note) <= 280),
  photo_path  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  constraint cat_matches_kind check (
    (kind = 'closure' and cat in ('khudai', 'paani', 'band', 'jam', 'hadsa')) or
    (kind = 'broken'  and cat in ('gaddha', 'gutter', 'sewer', 'light', 'kachra', 'aur'))),
  -- band rasta zyada se zyada 4 din; toota hua masla khud expire nahi hota
  constraint expiry_rule check (
    (kind = 'closure' and expires_at is not null and expires_at <= created_at + interval '4 days') or
    (kind = 'broken'  and expires_at is null)),
  -- photo sirf report karne wale ke apne folder se
  constraint photo_in_own_folder check (photo_path is null or photo_path like created_by::text || '/%')
);
create index if not exists reports_created_at on public.reports (created_at desc);

-- ---------- votes ----------
create table if not exists public.votes (
  report_id   uuid not null references public.reports (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('metoo', 'fixed', 'still', 'cleared')),
  created_at  timestamptz not null default now(),
  primary key (report_id, user_id, kind)
);

-- ---------- spam ki had: aik user, aik ghanta, 10 reports ----------
create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports
      where created_by = new.created_by and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limit';
  end if;
  new.created_at := now();  -- waqt server ka, phone ka nahi
  return new;
end $$;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- ---------- security (RLS) ----------
alter table public.reports enable row level security;
alter table public.votes   enable row level security;

drop policy if exists "reports: sab parh sakte hain" on public.reports;
create policy "reports: sab parh sakte hain" on public.reports
  for select to anon, authenticated using (true);
drop policy if exists "reports: apni report daalo" on public.reports;
create policy "reports: apni report daalo" on public.reports
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "reports: apni report hatao" on public.reports;
create policy "reports: apni report hatao" on public.reports
  for delete to authenticated using (created_by = auth.uid());
-- update ki koi policy nahi: report badli nahi ja sakti

-- votes: har koi sirf apne votes dekhe aur badle; ginti neeche wale view se aati hai
drop policy if exists "votes: apne votes dekho" on public.votes;
create policy "votes: apne votes dekho" on public.votes
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "votes: apna vote do" on public.votes;
create policy "votes: apna vote do" on public.votes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "votes: apna vote wapas lo" on public.votes;
create policy "votes: apna vote wapas lo" on public.votes
  for delete to authenticated using (user_id = auth.uid());

-- ---------- naqshe ke liye view: har report + votes ki ginti ----------
-- View owner ke haqooq se chalta hai (votes ki ginti ke liye), lekin kisi ka user id
-- bahar nahi deta: sirf "mine" (kya yeh meri report hai) aur ginti.
create or replace view public.report_stats as
select
  r.id, r.kind, r.cat, r.lat, r.lng, r.note, r.photo_path, r.created_at, r.expires_at,
  (r.created_by = auth.uid())                                        as mine,
  count(v.*) filter (where v.kind = 'metoo')                         as metoo,
  count(v.*) filter (where v.kind = 'fixed')                         as fixed,
  count(v.*) filter (where v.kind = 'still')                         as still,
  count(v.*) filter (where v.kind = 'cleared')                       as cleared,
  max(v.created_at) filter (where v.kind = 'fixed')                  as fixed_at,
  coalesce(bool_or(v.kind = 'fixed'   and v.user_id = r.created_by), false) as by_fixed,
  coalesce(bool_or(v.kind = 'cleared' and v.user_id = r.created_by), false) as by_cleared
from public.reports r
left join public.votes v on v.report_id = r.id
where r.kind = 'broken' or r.expires_at > now() - interval '1 day'
group by r.id;
grant select on public.report_stats to anon, authenticated;

-- ---------- live updates ----------
do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;

-- ---------- photos (public bucket, 300 KB, sirf JPEG) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 307200, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 307200, allowed_mime_types = array['image/jpeg'];

drop policy if exists "photos: apne folder mein upload" on storage.objects;
create policy "photos: apne folder mein upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos: apni photo hatao" on storage.objects;
create policy "photos: apni photo hatao" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
