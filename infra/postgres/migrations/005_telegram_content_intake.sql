create unique index if not exists autoposting_donors_id_org_flow_unique
  on public.autoposting_donors(id, organization_id, flow_id);

create table if not exists public.telegram_content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  flow_id uuid not null,
  donor_id uuid not null,
  source_url text not null,
  source_message_id text,
  title text not null default '',
  body text not null,
  content_hash text not null,
  rights_basis text not null check (rights_basis in ('owner_authorized','licensed','explicit_permission')),
  rights_note text not null,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review','approved','rejected')),
  metadata jsonb not null default '{}'::jsonb,
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint telegram_content_items_flow_tenant_fk
    foreign key (flow_id, organization_id)
    references public.autoposting_flows(id, organization_id) on delete cascade,
  constraint telegram_content_items_donor_tenant_fk
    foreign key (donor_id, organization_id, flow_id)
    references public.autoposting_donors(id, organization_id, flow_id) on delete cascade,
  constraint telegram_content_items_dedupe unique (donor_id, content_hash)
);

create index if not exists telegram_content_items_org_flow_created_idx
  on public.telegram_content_items(organization_id, flow_id, created_at desc);

alter table public.telegram_content_items enable row level security;
alter table public.telegram_content_items force row level security;

drop policy if exists telegram_content_items_tenant_isolation on public.telegram_content_items;
create policy telegram_content_items_tenant_isolation
  on public.telegram_content_items for all
  using (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()))
  with check (organization_id in (select m.organization_id from public.memberships m where m.user_id = auth.uid()));
