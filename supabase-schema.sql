-- ─────────────────────────────────────────────
-- FaturaOku — Supabase Schema
-- Supabase dashboard → SQL Editor → New query
-- Tümünü seç, Run'a bas
-- ─────────────────────────────────────────────

-- Faturalar tablosu
create table if not exists invoices (
  id          text primary key,
  data        jsonb not null,
  file_name   text,
  image_path  text,
  thumb_path  text,
  created_at  timestamptz default now()
);

alter table invoices enable row level security;

create policy "authenticated_all" on invoices
  for all to authenticated
  using (true) with check (true);

-- Ödendi durumu tablosu
create table if not exists paid_status (
  invoice_id  text primary key references invoices(id) on delete cascade,
  paid_date   text not null,
  paid_amount numeric,
  created_at  timestamptz default now()
);

alter table paid_status enable row level security;

create policy "authenticated_all" on paid_status
  for all to authenticated
  using (true) with check (true);
