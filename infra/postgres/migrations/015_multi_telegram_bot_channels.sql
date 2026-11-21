-- 015_multi_telegram_bot_channels.sql
-- Allow one organization to register the same Telegram channel with multiple bots.
-- Existing channel IDs and autoposting_flows.channel_id references remain intact.
ALTER TABLE public.telegram_channels
  DROP CONSTRAINT IF EXISTS telegram_channels_organization_id_chat_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS telegram_channels_org_chat_integration_uidx
  ON public.telegram_channels (organization_id, chat_id, integration_id);

CREATE INDEX IF NOT EXISTS telegram_channels_integration_id_idx
  ON public.telegram_channels (integration_id);
