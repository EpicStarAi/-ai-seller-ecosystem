-- 012_user_prompts.sql
-- Additive: saved rewrite prompts per organization, optional flow.prompt_id.

CREATE TABLE IF NOT EXISTS public.user_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt_text text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_prompts_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT user_prompts_text_len CHECK (char_length(prompt_text) BETWEEN 1 AND 13000)
);

CREATE INDEX IF NOT EXISTS user_prompts_org_updated_idx
  ON public.user_prompts (organization_id, updated_at DESC);

ALTER TABLE public.autoposting_flows
  ADD COLUMN IF NOT EXISTS prompt_id uuid REFERENCES public.user_prompts(id) ON DELETE SET NULL;

ALTER TABLE public.user_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_prompts_tenant_isolation ON public.user_prompts;
CREATE POLICY user_prompts_tenant_isolation
  ON public.user_prompts
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

REVOKE ALL ON TABLE public.user_prompts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_prompts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.user_prompts TO service_role;
