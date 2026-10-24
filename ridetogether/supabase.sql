-- Paste into Supabase → SQL Editor → Run. Safe to run once on a fresh project.

create table trips (
  code text primary key,
  dest_lat double precision not null,
  dest_lng double precision not null,
  dest_name text not null,
  created_at timestamptz default now()
);

create table riders (
  id bigint generated always as identity primary key,
  trip text not null references trips(code) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  bike int not null check (bike between 1 and 3)
);

create table positions (
  trip text not null references trips(code) on delete cascade,
  bike int not null check (bike between 1 and 3),
  lat double precision not null,
  lng double precision not null,
  speed double precision,
  updated_at timestamptz not null default now(),
  primary key (trip, bike)
);

-- The trip code is the only "password": anyone with the anon key can read/write.
-- Fine for a one-off trip; delete the project afterwards.
alter table trips enable row level security;
alter table riders enable row level security;
alter table positions enable row level security;
create policy "open" on trips for all to anon using (true) with check (true);
create policy "open" on riders for all to anon using (true) with check (true);
create policy "open" on positions for all to anon using (true) with check (true);

-- Live updates
alter publication supabase_realtime add table positions, riders;
