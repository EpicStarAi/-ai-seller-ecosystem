-- 013_auto_publish_queue.sql
-- Additive: optional auto-publish of already approved drafts. Defaults stay manual.

ALTER TABLE public.autoposting_flows
  ADD COLUMN IF NOT EXISTS auto_publish_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_publish_mode text NOT NULL DEFAULT 'interval',
  ADD COLUMN IF NOT EXISTS auto_publish_interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS auto_publish_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_publish_timezone text NOT NULL DEFAULT 'Europe/Kyiv',
  ADD COLUMN IF NOT EXISTS auto_publish_last_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'autoposting_flows_auto_publish_mode_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_auto_publish_mode_check
      CHECK (auto_publish_mode = ANY (ARRAY['interval'::text, 'slots'::text]));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'autoposting_flows_auto_publish_interval_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_auto_publish_interval_check
      CHECK (auto_publish_interval_minutes >= 30 AND auto_publish_interval_minutes <= 43200);
  END IF;
END
$$;

COMMENT ON COLUMN public.autoposting_flows.auto_publish_enabled IS
  'If true, drafts with status approved may be published by the worker on a schedule. Default false: only an explicit publish click sends to Telegram.';
