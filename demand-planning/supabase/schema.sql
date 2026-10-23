-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- Stores Raghav's approve/override decisions and the loss inputs on Deepa's tab.

create table if not exists decisions (
  id          text primary key,                 -- "<stock date>|<SKU>", one decision per SKU per run
  as_of       date not null,
  sku_id      text not null,
  status      text not null check (status in ('approved', 'overridden')),
  final_call  text not null,
  final_qty   int  not null default 0,
  rec_call    text,                             -- what the tool recommended
  rec_qty     int,
  note        text,                             -- why Raghav overrode it
  decided_at  timestamptz not null default now()
);

create table if not exists app_settings (
  key   text primary key,
  value jsonb not null
);

alter table decisions    enable row level security;
alter table app_settings enable row level security;

-- Prototype access: anyone holding the anon key can read and write these two tables.
-- Fine for an internal pilot. Before wider use, add Supabase Auth and restrict to signed-in users.
create policy "anon all decisions" on decisions    for all to anon using (true) with check (true);
create policy "anon all settings"  on app_settings for all to anon using (true) with check (true);
