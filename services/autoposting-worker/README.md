# Autoposting rewrite worker

Oneshot job that turns new `telegram_content_items` into `autoposting_posts` drafts.

- Ads and giveaways are stored as `rejected_auto` and never enter the review queue.
- Everything else is rewritten with the flow `ai_prompt` via the already configured AI provider (OpenAI, otherwise Anthropic, otherwise Gemini, otherwise local Ollama).
- The worker does **not** publish to Telegram.

Install the systemd units from `infra/systemd/` and enable the timer. Manual checks:

```bash
/usr/local/bin/node /opt/ai-seller-ci/services/autoposting-worker/worker.mjs
/usr/local/bin/node /opt/ai-seller-ci/services/autoposting-worker/worker.mjs --dry-run-publish
```

`--dry-run-publish` only builds the send payload (chat, text length, inline buttons). It never calls the Bot API.
