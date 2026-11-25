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
import { createDecipheriv, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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



const MEDIA_RELPATH_RE = /^(?:[0-9a-f-]{36}\/[0-9]{1,20}\/\d{1,2}|generated\/[0-9a-f-]{36}\/[0-9a-f-]{36})\.(jpg|jpeg|png|webp|mp4|mov)$/i;

function illustrationPrompt(draftText) {
  const sample = (draftText || "").trim().slice(0, 1200) || "a news update";
  return [
    "Create a single tasteful illustration for a Telegram news post.",
    "No captions, logos, watermarks, or readable text in the image.",
    "Photoreal or clean editorial style, 16:9 or square composition.",
    "Scene inspired by this post:",
    sample,
  ].join("\n");
}

async function requestOpenAIImage(secret, prompt) {
  const attempts = [
    { body: { model: "dall-e-3", prompt, size: "1024x1024", response_format: "b64_json" } },
    { body: { model: "gpt-image-1", prompt, size: "1024x1024" } },
  ];
  let lastError = "image provider rejected the request";
  for (const attempt of attempts) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(attempt.body),
      signal: AbortSignal.timeout(90000),
    });
    const result = await response.json();
    if (!response.ok) {
      lastError = `image_provider_http_${response.status}`;
      continue;
    }
    const row = result?.data?.[0];
    if (row?.b64_json) {
      const bytes = Buffer.from(row.b64_json, "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("image_too_large");
      return bytes;
    }
    if (typeof row?.url === "string" && /^https:\/\//i.test(row.url)) {
      const imageResponse = await fetch(row.url, { signal: AbortSignal.timeout(60000) });
      if (!imageResponse.ok) { lastError = "image_download_failed"; continue; }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("image_too_large");
      return bytes;
    }
    lastError = "empty_image_response";
  }
  throw new Error(lastError);
}

function saveIllustration(contentItemId, bytes) {
  if (!/^[0-9a-f-]{36}$/i.test(contentItemId)) throw new Error("invalid_content_item");
  const relpath = `generated/${contentItemId.toLowerCase()}/${randomUUID()}.png`;
  if (!MEDIA_RELPATH_RE.test(relpath)) throw new Error("invalid_media_path");
  const root = resolve(process.env.TG_MEDIA_ROOT || "/var/lib/ai-seller-telegram-listener/media");
  const full = resolve(root, relpath);
  if (full !== root && !full.startsWith(`${root}/`)) throw new Error("invalid_media_path");
  mkdirSync(resolve(root, "generated", contentItemId.toLowerCase()), { mode: 0o750, recursive: true });
  writeFileSync(full, bytes, { mode: 0o640 });
  return { kind: "photo", mime: "image/png", bytes: bytes.length, relpath };
}

async function maybeIllustrate(generateImage, openaiSecret, draftText, contentItemId, mediaIn) {
  const media = mediaIn && typeof mediaIn === "object"
    ? { ...mediaIn, items: Array.isArray(mediaIn.items) ? [...mediaIn.items] : [], skipped: Array.isArray(mediaIn.skipped) ? [...mediaIn.skipped] : [] }
    : { items: [], skipped: [] };
  if (!generateImage) return media;
  if (!openaiSecret) {
    media.illustration = { status: "skipped", reason: "no_image_provider" };
    return media;
  }
  if (media.items.length >= 10) {
    media.illustration = { status: "skipped", reason: "album_full" };
    return media;
  }
  try {
    const bytes = await requestOpenAIImage(openaiSecret, illustrationPrompt(draftText));
    const item = saveIllustration(contentItemId, bytes);
    media.items.push(item);
    media.present = true;
    media.grouped = media.items.length > 1;
    media.illustration = { status: "generated" };
    return media;
  } catch (error) {
    media.illustration = { status: "skipped", reason: "provider_error" };
    log("rewrite: illustration skipped", error instanceof Error ? error.message : "error");
    return media;
  }
}

function extractMedia(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  if (metadata.media && typeof metadata.media === "object") return metadata.media;
  return metadata;
}

async function rewriteOnce() {
  const items = await sb("telegram_content_items?select=id,organization_id,flow_id,donor_id,source_url,source_message_id,title,body,metadata,created_at&order=created_at.desc&limit=40");
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
      const rows = await sb(`autoposting_flows?id=eq.${item.flow_id}&select=id,organization_id,ai_prompt,prompt_id,source_type,channel_id,post_buttons,name,generate_image`);
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
      let promptText = flow.ai_prompt || "";
      if (flow.prompt_id) {
        const saved = await sb(`user_prompts?id=eq.${flow.prompt_id}&select=prompt_text`);
        if (saved?.[0]?.prompt_text) promptText = saved[0].prompt_text;
      }
      const generated = await generateWithFallback(
        providers,
        rewriteSystemPrompt(promptText),
        original,
      );
      const openai = providers.find((row) => row.provider === "openai" && row.secret);
      const media = await maybeIllustrate(
        flow.generate_image === true,
        openai?.secret || null,
        generated.text,
        item.id,
        extractMedia(item.metadata),
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
          media,
          provider: generated.provider,
          model: generated.model,
          updated_at: now,
        },
      });
      pending += 1;
      processed += 1;
      seen.add(key);
      log("rewrite: draft ready", generated.provider, generated.model, media.illustration || "no_illustration");
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


function slotMatches(now, slots, lastAt, timeZone) {
  const list = Array.isArray(slots) ? slots : [];
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const hm = `${parts.hour}:${parts.minute}`;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  let lastDay = "", lastHm = "";
  if (lastAt) {
    const lp = Object.fromEntries(fmt.formatToParts(new Date(lastAt)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    lastDay = `${lp.year}-${lp.month}-${lp.day}`;
    lastHm = `${lp.hour}:${lp.minute}`;
  }
  for (const raw of list) {
    if (typeof raw !== "string" || !/^\d{2}:\d{2}$/.test(raw)) continue;
    const [h, m] = raw.split(":").map(Number);
    const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
    const slotMin = h * 60 + m;
    let delta = nowMin - slotMin;
    if (delta < 0) delta += 24 * 60;
    if (delta <= 2 && !(lastDay === day && lastHm === raw)) return raw;
  }
  return null;
}

function isIntervalDue(now, lastAt, minutes) {
  if (!lastAt) return true;
  const elapsed = (now.getTime() - new Date(lastAt).getTime()) / 60000;
  return elapsed >= minutes;
}

async function sendTelegram(token, method, payload, files) {
  let lastError = "Telegram rejected the scheduled publish.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    if (files && files.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (value == null) continue;
        form.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      for (const file of files) {
        form.append(file.field, new Blob([file.bytes], { type: file.mime }), file.filename);
      }
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    } else {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
    }
    const result = await response.json();
    if (response.ok && result.ok) return result;
    const retryAfter = Number(result?.parameters?.retry_after ?? 0);
    if ((response.status === 429 || result?.error_code === 429) && retryAfter > 0 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.5) * 1000));
      continue;
    }
    lastError = typeof result?.description === "string" ? result.description : lastError;
    break;
  }
  throw new Error(lastError);
}

function firstMessageId(result) {
  const body = result?.result;
  if (Array.isArray(body) && body[0]?.message_id != null) return String(body[0].message_id);
  if (body?.message_id != null) return String(body.message_id);
  return null;
}

function mediaRoot() {
  return process.env.TG_MEDIA_ROOT || "/var/lib/ai-seller-telegram-listener/media";
}

function readStoredMedia(relpath) {
  if (!/^(?:[0-9a-f-]{36}\/[0-9]{1,20}\/\d{1,2}|generated\/[0-9a-f-]{36}\/[0-9a-f-]{36})\.(jpg|jpeg|png|webp|mp4|mov)$/i.test(relpath)) return null;
  const root = resolve(mediaRoot());
  const full = resolve(root, relpath);
  if (full !== root && !full.startsWith(`${root}/`)) return null;
  try { return { bytes: readFileSync(full), filename: relpath.split("/").pop() }; }
  catch { return null; }
}

async function publishDue() {
  const flows = await sb("autoposting_flows?auto_publish_enabled=eq.true&select=id,organization_id,name,channel_id,auto_publish_enabled,post_buttons,auto_publish_mode,auto_publish_interval_minutes,auto_publish_slots,auto_publish_timezone,auto_publish_last_at,moderation_enabled");
  if (!Array.isArray(flows) || flows.length === 0) {
    log("schedule: no flows with auto-publish enabled");
    return { published: 0 };
  }
  const now = new Date();
  let published = 0;
  for (const flow of flows) {
    if (flow.auto_publish_enabled !== true) continue;
    const due = flow.auto_publish_mode === "slots"
      ? Boolean(slotMatches(now, flow.auto_publish_slots, flow.auto_publish_last_at, flow.auto_publish_timezone || "Europe/Kyiv"))
      : isIntervalDue(now, flow.auto_publish_last_at, Number(flow.auto_publish_interval_minutes) || 60);
    if (!due) continue;
    const rows = await sb(`autoposting_posts?flow_id=eq.${flow.id}&status=eq.approved&select=id,organization_id,flow_id,draft_text,source_url,media&order=created_at.desc&limit=1`);
    const post = rows?.[0];
    if (!post) continue;
    const text = String(post.draft_text || "").trim();
    const media = extractMedia(post.media);
    const items = Array.isArray(media.items) ? media.items : [];
    if (!text && !items.length) {
      await sb(`autoposting_posts?id=eq.${post.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", last_error: "empty approved draft", updated_at: now.toISOString() } });
      log("schedule: empty approved draft marked failed");
      continue;
    }
    const channels = await sb(`telegram_channels?id=eq.${flow.channel_id}&select=id,chat_id,integration_id,can_post_messages`);
    const channel = channels?.[0];
    if (!channel?.can_post_messages || !channel.chat_id) {
      log("schedule: channel cannot post, skip flow");
      continue;
    }
    const secrets = await sb(`integration_secrets?integration_id=eq.${channel.integration_id}&select=nonce,ciphertext`);
    if (!secrets?.[0]) {
      log("schedule: missing telegram secret, skip flow");
      continue;
    }
    let token;
    try { token = decryptSecret(secrets[0].nonce, secrets[0].ciphertext, post.organization_id, "telegram"); }
    catch (error) {
      log("schedule: decrypt failed", error instanceof Error ? error.message : "error");
      continue;
    }
    const reply_markup = buttonMarkup(flow.post_buttons, post.source_url);
    const steps = [];
    if (items.length === 1) {
      const method = items[0].kind === "video" ? "sendVideo" : "sendPhoto";
      if (text && text.length <= 1024) steps.push({ method, caption: true, buttons: Boolean(reply_markup) });
      else {
        steps.push({ method, caption: false, buttons: false });
        if (text || reply_markup) steps.push({ method: "sendMessage", caption: false, buttons: Boolean(reply_markup) });
      }
    } else if (items.length > 1) {
      steps.push({ method: "sendMediaGroup", caption: false, buttons: false });
      if (text || reply_markup) steps.push({ method: "sendMessage", caption: false, buttons: Boolean(reply_markup) });
    } else {
      steps.push({ method: "sendMessage", caption: false, buttons: Boolean(reply_markup) });
    }
    const stamp = now.toISOString();
    try {
      let messageId = null;
      for (const step of steps) {
        if (step.method === "sendMessage") {
          const payload = { chat_id: channel.chat_id, text: text || " ", disable_web_page_preview: true };
          if (step.buttons && reply_markup) payload.reply_markup = reply_markup;
          const result = await sendTelegram(token, "sendMessage", payload);
          if (!messageId) messageId = firstMessageId(result);
          continue;
        }
        if (step.method === "sendMediaGroup") {
          const files = [];
          const group = [];
          items.forEach((item, i) => {
            const file = readStoredMedia(item.relpath);
            if (!file) return;
            const field = `file${i}`;
            files.push({ field, filename: file.filename, bytes: file.bytes, mime: item.mime || "application/octet-stream" });
            group.push({ type: item.kind === "video" ? "video" : "photo", media: `attach://${field}` });
          });
          if (!group.length) throw new Error("media files missing");
          const result = await sendTelegram(token, "sendMediaGroup", { chat_id: channel.chat_id, media: group }, files);
          if (!messageId) messageId = firstMessageId(result);
          continue;
        }
        const item = items[0];
        const file = item ? readStoredMedia(item.relpath) : null;
        if (!file || !item) throw new Error("media file missing");
        const field = step.method === "sendVideo" ? "video" : "photo";
        const payload = { chat_id: channel.chat_id };
        if (step.caption && text) payload.caption = text.slice(0, 1024);
        if (step.buttons && reply_markup) payload.reply_markup = reply_markup;
        const result = await sendTelegram(token, step.method, payload, [{ field, filename: file.filename, bytes: file.bytes, mime: item.mime || "application/octet-stream" }]);
        if (!messageId) messageId = firstMessageId(result);
      }
      await sb(`autoposting_posts?id=eq.${post.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: "published", published_message_id: messageId, published_chat_id: channel.chat_id, published_at: stamp, last_error: null, updated_at: stamp },
      });
      await sb(`autoposting_flows?id=eq.${flow.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { auto_publish_last_at: stamp, updated_at: stamp },
      });
      published += 1;
      log("schedule: published approved draft", flow.name || flow.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "scheduled publish failed";
      await sb(`autoposting_posts?id=eq.${post.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: "failed", last_error: message, updated_at: stamp },
      });
      log("schedule: publish failed", message);
    }
  }
  log("schedule done", { published, enabled_flows: flows.length });
  return { published };
}

async function run() {
  await rewriteOnce();
  await publishDue();
}
const mode = process.argv.includes("--dry-run-publish") ? "dry-run-publish" : "rewrite";
mode === "dry-run-publish" ? dryRunPublish().catch((error) => { log("fatal", error instanceof Error ? error.message : "error"); process.exit(1); })
  : run().catch((error) => { log("fatal", error instanceof Error ? error.message : "error"); process.exit(1); });
