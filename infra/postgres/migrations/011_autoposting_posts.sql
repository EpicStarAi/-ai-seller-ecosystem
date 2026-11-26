-- 011_autoposting_posts.sql
-- Additive: drafts for AI-rewritten donor posts, one row per content item per flow.

CREATE TABLE IF NOT EXISTS public.autoposting_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.autoposting_flows(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.telegram_content_items(id) ON DELETE CASCADE,
  status text NOT NULL,
  original_text text NOT NULL DEFAULT ''::text,
  draft_text text NOT NULL DEFAULT ''::text,
  source_url text,
  media jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  model text,
  rejection_reason text,
  published_message_id text,
  published_chat_id text,
  published_at timestamp with time zone,
  last_error text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT autoposting_posts_status_check CHECK (status = ANY (ARRAY[
    'pending_review'::text,
    'approved'::text,
    'rejected'::text,
    'rejected_auto'::text,
    'published'::text,
    'failed'::text
  ])),
  CONSTRAINT autoposting_posts_flow_item_key UNIQUE (flow_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS autoposting_posts_org_status_idx
  ON public.autoposting_posts (organization_id, status, created_at DESC);

ALTER TABLE public.autoposting_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS autoposting_posts_tenant_isolation ON public.autoposting_posts;
CREATE POLICY autoposting_posts_tenant_isolation
  ON public.autoposting_posts
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

REVOKE ALL ON TABLE public.autoposting_posts FROM PUBLIC;
GRANT SELECT, UPDATE ON TABLE public.autoposting_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.autoposting_posts TO service_role;
