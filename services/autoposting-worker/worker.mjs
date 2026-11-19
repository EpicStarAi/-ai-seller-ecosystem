#!/usr/bin/env node
/**
 * Autoposting rewrite worker. Reads new telegram_content_items, skips obvious
 * ads/giveaways, rewrites the rest with the flow's AI prompt, and inserts
 * autoposting_posts drafts. Does not publish to Telegram.
 *
 * Usage:
 *   node worker.mjs
 *   node worker.mjs --dry-run-publish
 */
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

const AD_RULES = [
  { reason: "розыгрыш / giveaway", pattern: /розыгрыш|giveaway|\braffle\b|выиграй\s+(приз|uc|юс)|подпишись.{0,40}выигра/i },
  { reason: "промокод", pattern: /промокод|\bpromo\s*code\b|промо-код/i },
  { reason: "продажа UC / донат-магазин", pattern: /купи(ть|те)?\s+(uc|юс)|дешев(ые|ый|о)\s+(uc|юс)|донат(ы|ов)?\s+(uc|юс)|пополни(ть|те)?\s+(uc|юс)|(uc|юс)\s+за\s+\d+|\buc[\s-]*shop\b/i },
  { reason: "маркированная реклама", pattern: /#реклама\b|\berid\s*[:=]|реклама\s+(от|магазина|партн)/i },
];

const DEFAULT_MODELS = {
  ollama: process.env.OLLAMA_MODEL || "qwen3.5:9b",
  openai: "gpt-6-astra",
  anthropic: "claude-sonnet-5-5",
  gemini: "gemini-3.8-flash",
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function detectDonorAd(text) {
  const sample = (text || "").trim();
  if (!sample) return { rejected: false };
  for (const rule of AD_RULES) {
    if (rule.pattern.test(sample)) return { rejected: true, reason: rule.reason };
  }
  return { rejected: false };
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("Supabase URL or service role key is missing");
  return { url, key };
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = supabaseConfig();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw.slice(0, 200); }
  }
  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}`);
  }
  return data;
}

function encryptionKey() {
  const file = process.env.INTEGRATION_ENCRYPTION_KEY_FILE;
  if (!file) throw new Error("INTEGRATION_ENCRYPTION_KEY_FILE is not set");
  const raw = readFileSync(file, "utf8").trim();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("Integration encryption key must be 32 bytes");
  return key;
}

function fromBytea(value) {
  return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "base64");
}

function decryptSecret(nonce, ciphertext, organizationId, provider) {
  const iv = fromBytea(nonce);
  const packed = fromBytea(ciphertext);
  if (iv.length !== 12 || packed.length < 17) throw new Error("Stored credential is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(`${organizationId}:${provider}:v1`));
  decipher.setAuthTag(packed.subarray(0, 16));
  return Buffer.concat([decipher.update(packed.subarray(16)), decipher.final()]).toString("utf8");
}

function rewriteSystemPrompt(flowPrompt) {
  return [
    "Ты редактор Telegram-канала с новостями. Перепиши исходный пост донора по инструкции канала ниже.",
    "Верни только готовый текст публикации, без предисловия и без кавычек вокруг всего текста.",
    "Не выдумывай факты. Сохрани важные имена, даты, цифры и ссылки.",
    "Не добавляй рекламу, магазины UC, промокоды и розыгрыши.",
    "Текст должен подходить для Telegram (обычный текст, до 3500 символов).",
    "",
    "Инструкция канала:",
    (flowPrompt || "").trim() || "Пиши коротко, ясно и по-русски, в стиле новостного канала.",
  ].join("\n");
}

function parseAnswer(provider, result) {
  if (provider === "ollama") {
    return result?.message?.content || "";
  }
  if (provider === "openai") {
    if (typeof result.output_text === "string") return result.output_text;
    if (Array.isArray(result.output)) {
      return result.output.flatMap((item) => {
        const content = item?.content;
        if (!Array.isArray(content)) return [];
        return content.filter((part) => part?.type === "output_text" && typeof part.text === "string").map((part) => part.text);
      }).join("\n");
    }
  }
  if (provider === "anthropic") {
    if (Array.isArray(result.content)) {
      return result.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    }
  }
  const parts = result?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n");
  }
  return "";
}

async function generateText(provider, secret, model, systemPrompt, userText) {
  let endpoint, headers = { "Content-Type": "application/json" }, payload;
  if (provider === "ollama") {
    const base = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11435").replace(/\/+$/, "");
    endpoint = `${base}/api/chat`;
    payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      stream: false,
      think: false,
      options: { num_predict: 1600, num_ctx: 8192 },
    };
  } else if (provider === "openai") {
    endpoint = "https://api.openai.com/v1/responses";
    headers.Authorization = `Bearer ${secret}`;
    payload = {
      model,
      input: [
        { role: "developer", content: systemPrompt },
        { role: "user", content: userText },
      ],
      max_output_tokens: 1600,
    };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = secret;
    headers["anthropic-version"] = "2026-10-21";
    payload = { model, max_tokens: 1600, system: systemPrompt, messages: [{ role: "user", content: userText }] };
  } else {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers["x-goog-api-key"] = secret;
    payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 1600 },
    };
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(provider === "ollama" ? 180000 : 60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${provider}_http_${response.status}`);
  const text = String(parseAnswer(provider, result) || "").trim();
  if (!text) throw new Error("empty_provider_answer");
  return { text: text.slice(0, 4000), provider, model };
}

async function loadProviders(organizationId) {
  const integrations = await sb(`integrations?organization_id=eq.${organizationId}&status=eq.connected&kind=in.(openai,anthropic,gemini)&select=id,kind`);
  const candidates = [];
  for (const kind of ["openai", "anthropic", "gemini"]) {
    const chosen = (integrations || []).find((row) => row.kind === kind);
    if (!chosen) continue;
    try {
      const secrets = await sb(`integration_secrets?integration_id=eq.${chosen.id}&select=nonce,ciphertext`);
      if (!secrets?.[0]) {
        log("rewrite: skipping provider, missing secret", kind);
        continue;
      }
      const secret = decryptSecret(secrets[0].nonce, secrets[0].ciphertext, organizationId, kind);
      candidates.push({ provider: kind, secret, model: DEFAULT_MODELS[kind] });
    } catch (error) {
      log("rewrite: skipping provider", kind, error instanceof Error ? error.message : "error");
    }
  }
  candidates.push({ provider: "ollama", secret: "", model: DEFAULT_MODELS.ollama });
  return candidates;
}

async function generateWithFallback(providers, systemPrompt, userText) {
  let lastError = "no_provider";
  for (const cfg of providers) {
    try {
      return await generateText(cfg.provider, cfg.secret, cfg.model, systemPrompt, userText);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "error";
      log("rewrite: provider failed, trying next", cfg.provider, lastError);
    }
  }
  throw new Error(lastError);
}

function buttonMarkup(postButtons, sourceUrl) {
  const placeholder = "{source_url}";
  if (!Array.isArray(postButtons)) return undefined;
  const keyboard = [];
  for (const row of postButtons) {
    if (!Array.isArray(row)) continue;
    const next = [];
    for (const button of row) {
      if (!button || typeof button.text !== "string" || typeof button.url !== "string") continue;
      let url = button.url;
      if (url.includes(placeholder)) {
        if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
        url = url.split(placeholder).join(sourceUrl);
      }
      if (!/^https?:\/\//i.test(url)) continue;
      next.push({ text: button.text.trim().slice(0, 64), url });
    }
    if (next.length) keyboard.push(next);
  }
  return keyboard.length ? { inline_keyboard: keyboard } : undefined;
}


function extractMedia(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  if (metadata.media && typeof metadata.media === "object") return metadata.media;
  return metadata;
}

async function rewriteOnce() {
  const items = await sb("telegram_content_items?select=id,organization_id,flow_id,donor_id,source_url,source_message_id,title,body,metadata,created_at&order=created_at.asc&limit=40");
  if (!Array.isArray(items) || items.length === 0) {
    log("rewrite: no content items");
    return { processed: 0, pending: 0, rejected: 0, skipped: 0 };
  }
  const existing = await sb("autoposting_posts?select=flow_id,content_item_id");
  const seen = new Set((existing || []).map((row) => `${row.flow_id}:${row.content_item_id}`));
  const flowCache = new Map();
  const providerCache = new Map();
  let pending = 0, rejected = 0, skipped = 0, processed = 0;
  for (const item of items) {
    const key = `${item.flow_id}:${item.id}`;
    if (seen.has(key)) { skipped += 1; continue; }
    if (processed >= 8) break;
    let flow = flowCache.get(item.flow_id);
    if (!flow) {
      const rows = await sb(`autoposting_flows?id=eq.${item.flow_id}&select=id,organization_id,ai_prompt,source_type,channel_id,post_buttons,name`);
      flow = rows?.[0];
      if (flow) flowCache.set(item.flow_id, flow);
    }
    if (!flow) { log("rewrite: missing flow, skip item"); skipped += 1; continue; }
    const original = [item.title, item.body].filter(Boolean).join("\n\n").trim() || "[Публикация без текста]";
    const ad = detectDonorAd(original);
    const now = new Date().toISOString();
    if (ad.rejected) {
      await sb("autoposting_posts", {
        method: "POST",
        prefer: "return=minimal,resolution=ignore-duplicates",
        body: {
          organization_id: item.organization_id,
          flow_id: item.flow_id,
          content_item_id: item.id,
          status: "rejected_auto",
          original_text: original.slice(0, 20000),
          draft_text: "",
          source_url: item.source_url || null,
          media: extractMedia(item.metadata),
          rejection_reason: ad.reason,
          updated_at: now,
        },
      });
      rejected += 1;
      processed += 1;
      seen.add(key);
      log("rewrite: auto-rejected", ad.reason);
      continue;
    }
    try {
      let providers = providerCache.get(item.organization_id);
      if (!providers) {
        providers = await loadProviders(item.organization_id);
        providerCache.set(item.organization_id, providers);
      }
      const generated = await generateWithFallback(
        providers,
        rewriteSystemPrompt(flow.ai_prompt),
        original,
      );
      await sb("autoposting_posts", {
        method: "POST",
        prefer: "return=minimal,resolution=ignore-duplicates",
        body: {
          organization_id: item.organization_id,
          flow_id: item.flow_id,
          content_item_id: item.id,
          status: "pending_review",
          original_text: original.slice(0, 20000),
          draft_text: generated.text,
          source_url: item.source_url || null,
          media: extractMedia(item.metadata),
          provider: generated.provider,
          model: generated.model,
          updated_at: now,
        },
      });
      pending += 1;
      processed += 1;
      seen.add(key);
      log("rewrite: draft ready", generated.provider, generated.model);
    } catch (error) {
      log("rewrite: all providers or insert failed, will retry later", error instanceof Error ? error.message : "error");
      // Keep going so later items (including auto-rejected ads) are not stuck behind one AI failure.
      continue;
    }
  }
  log("rewrite done", { processed, pending, rejected, skipped });
  return { processed, pending, rejected, skipped };
}

async function dryRunPublish() {
  const rows = await sb("autoposting_posts?status=eq.pending_review&select=id,flow_id,source_url,draft_text,media,organization_id&order=created_at.desc&limit=1");
  if (!rows?.[0]) {
    log("dry-run-publish: no pending drafts");
    return;
  }
  const post = rows[0];
  const flows = await sb(`autoposting_flows?id=eq.${post.flow_id}&select=id,name,channel_id,post_buttons`);
  const flow = flows?.[0];
  if (!flow) throw new Error("dry-run missing flow");
  const channels = await sb(`telegram_channels?id=eq.${flow.channel_id}&select=id,username,chat_id,title`);
  const channel = channels?.[0];
  const reply_markup = buttonMarkup(flow.post_buttons, post.source_url);
  const media = extractMedia(post.media);
  const items = Array.isArray(media.items) ? media.items : [];
  const text = String(post.draft_text || "");
  let steps;
  if (items.length === 1) {
    const method = items[0].kind === "video" ? "sendVideo" : "sendPhoto";
    steps = text && text.length <= 1024
      ? [{ method, caption: true, buttons: Boolean(reply_markup), count: 1 }]
      : [{ method, caption: false, buttons: false, count: 1 }].concat(text || reply_markup ? [{ method: "sendMessage", caption: false, buttons: Boolean(reply_markup), count: 0 }] : []);
  } else if (items.length > 1) {
    steps = [{ method: "sendMediaGroup", caption: false, buttons: false, count: items.length }];
    if (text || reply_markup) steps.push({ method: "sendMessage", caption: false, buttons: Boolean(reply_markup), count: 0 });
  } else {
    steps = [{ method: "sendMessage", caption: false, buttons: Boolean(reply_markup), count: 0 }];
  }
  const payload = {
    chat_id: channel?.chat_id || null,
    channel: channel?.username ? `@${channel.username}` : channel?.title,
    text_length: text.length,
    media_count: items.length,
    media_kinds: items.map((item) => item.kind),
    steps,
    disable_web_page_preview: true,
    reply_markup: reply_markup || null,
    would_send: false,
  };
  log("dry-run-publish payload", JSON.stringify(payload));
}

const mode = process.argv.includes("--dry-run-publish") ? "dry-run-publish" : "rewrite";
mode === "dry-run-publish" ? dryRunPublish().catch((error) => { log("fatal", error instanceof Error ? error.message : "error"); process.exit(1); })
  : rewriteOnce().catch((error) => { log("fatal", error instanceof Error ? error.message : "error"); process.exit(1); });
