-- Purchase orders for Zoho. Run once in the Supabase SQL editor, after schema.sql and seed.sql.

-- Which Zoho item and vendor each SKU maps to. Fill these in (Table Editor > zoho_map).
-- rate is optional: leave it empty to let Zoho use the item's own purchase rate.
create table if not exists zoho_map (
  sku_id          text primary key references sku_master(sku_id),
  zoho_item_id    text,
  zoho_vendor_id  text,
  rate            numeric
);
insert into zoho_map (sku_id) select sku_id from sku_master on conflict do nothing;

-- One row per approved order. The app writes status 'dry_run'. The Edge Function (supabase/README.md)
-- turns it into a draft PO in Zoho and fills zoho_po_id / zoho_po_number, or writes the error.
create table if not exists purchase_orders (
  decision_id      text primary key,          -- same id as decisions.id: "<stock date>|<SKU>", so one PO per decision
  sku_id           text not null,
  distributor_id   text,
  quantity         int  not null check (quantity > 0),
  status           text not null default 'dry_run'
                   check (status in ('dry_run', 'draft_created', 'failed', 'void_requested', 'voided')),
  payload          jsonb not null,            -- the exact body sent to Zoho
  warnings         jsonb not null default '[]',
  zoho_po_id       text,
  zoho_po_number   text,
  error            text,
  created_at       timestamptz not null default now()
);

alter table zoho_map        enable row level security;
alter table purchase_orders enable row level security;

-- Prototype access, same trade-off as the decisions table: anyone with the anon/publishable key can read and write.
-- Add Supabase Auth and tighten these before wider use.
create policy "anon all zoho_map"        on zoho_map        for all to anon using (true) with check (true);
create policy "anon all purchase_orders" on purchase_orders for all to anon using (true) with check (true);
