-- 010_flow_post_buttons.sql
--
-- Additive: jsonb post_buttons on autoposting_flows (default empty array).
-- Each value is an array of rows of {text, url}. url may include {source_url}.
-- The GAME OVER — PUBG Mobile News flow is seeded with the default keyboard.

ALTER TABLE public.autoposting_flows
  ADD COLUMN IF NOT EXISTS post_buttons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.autoposting_flows.post_buttons IS
  'Inline URL buttons for published posts. JSON array of rows of {text, url}. Url may include {source_url}.';

UPDATE public.autoposting_flows
SET post_buttons = $buttons$[
  [{"text": "🛒 Магазин GAME OVER", "url": "https://t.me/GAMEOVER_TG_BOT?startapp"}],
  [
    {"text": "📰 Источник", "url": "{source_url}"},
    {"text": "📣 Поделиться каналом", "url": "https://t.me/share/url?url=https://t.me/gameover_pubg"}
  ],
  [{"text": "🎮 Все новости PUBG", "url": "https://t.me/gameover_pubg"}]
]$buttons$::jsonb,
    updated_at = now()
WHERE id = '1aa9b0ab-b303-4459-96a2-ec4f9fb4eb03'
  AND name = 'GAME OVER — PUBG Mobile News';
