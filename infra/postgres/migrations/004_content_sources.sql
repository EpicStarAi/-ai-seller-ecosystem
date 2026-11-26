-- Firecrawl-backed web source registry and extracted material queue.
-- Telegram donor records remain in autoposting_donors.

create table if not exists public.content_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null references public.autoposting_flows(id) on delete cascade,
  source_kind text not null default 'website' check (source_kind in ('website','rss')),
  url text not null,
  domain text not null,
  title text not null,
  permission_status text not null default 'pending_review'
    check (permission_status in ('pending_review','owner_authorized','licensed','restricted')),
  rights_note text,
  ingest_enabled boolean not null default false,
  last_scraped_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, flow_id, url)
);

create index if not exists content_sources_org_flow_idx
  on public.content_sources (organization_id, flow_id, created_at desc);

create table if not exists public.content_source_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null references public.content_sources(id) on delete cascade,
  source_url text not null,
  canonical_url text not null,
  title text not null default '',
  description text,
  markdown text not null default '',
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review','approved','rejected')),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_id, canonical_url)
);

create index if not exists content_source_items_org_source_idx
  on public.content_source_items (organization_id, source_id, fetched_at desc);

alter table public.content_sources enable row level security;
alter table public.content_sources force row level security;
create policy content_sources_tenant_isolation on public.content_sources
  for all to authenticated
  using (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()))
  with check (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()));

alter table public.content_source_items enable row level security;
alter table public.content_source_items force row level security;
create policy content_source_items_tenant_isolation on public.content_source_items
  for all to authenticated
  using (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()))
  with check (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()));

grant select, insert, update, delete on public.content_sources to authenticated;
grant select, insert, update, delete on public.content_source_items to authenticated;

-- Composite tenant keys prevent a row in one organization from referencing
-- another organization's flow or source, even through direct Data API writes.
alter table public.autoposting_flows
  add constraint autoposting_flows_id_org_unique unique (id, organization_id);

alter table public.content_sources
  add constraint content_sources_id_org_unique unique (id, organization_id);

alter table public.content_sources
  add constraint content_sources_flow_tenant_fk
  foreign key (flow_id, organization_id)
  references public.autoposting_flows (id, organization_id) on delete cascade;

alter table public.content_source_items
  add constraint content_source_items_source_tenant_fk
  foreign key (source_id, organization_id)
  references public.content_sources (id, organization_id) on delete cascade;
