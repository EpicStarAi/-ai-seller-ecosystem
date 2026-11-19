import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MEDIA_RELPATH_RE, type PostMedia, type StoredMediaItem } from "@/lib/autoposting/media";
import { MEDIA_ROOT } from "@/lib/autoposting/media-server";

const PHOTO_LIMIT = 10 * 1024 * 1024;
const ALBUM_LIMIT = 10;

function illustrationPrompt(draftText: string) {
  const sample = (draftText || "").trim().slice(0, 1200) || "a news update";
  return [
    "Create a single tasteful illustration for a Telegram news post.",
    "No captions, logos, watermarks, or readable text in the image.",
    "Photoreal or clean editorial style, 16:9 or square composition.",
    "Scene inspired by this post:",
    sample,
  ].join("\n");
}

async function requestOpenAIImage(secret: string, prompt: string) {
  const attempts: Array<{ model: string; body: Record<string, unknown> }> = [
    { model: "dall-e-3", body: { model: "dall-e-3", prompt, size: "1024x1024", response_format: "b64_json" } },
    { model: "gpt-image-1", body: { model: "gpt-image-1", prompt, size: "1024x1024" } },
  ];
  let lastError = "image provider rejected the request";
  for (const attempt of attempts) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(attempt.body),
      signal: AbortSignal.timeout(90000),
    });
    const result = await response.json() as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } };
    if (!response.ok) {
      lastError = "image_provider_http_" + response.status;
      continue;
    }
    const row = result?.data?.[0];
    if (row?.b64_json) {
      const bytes = Buffer.from(row.b64_json, "base64");
      if (!bytes.length || bytes.length > PHOTO_LIMIT) throw new Error("image_too_large");
      return bytes;
    }
    if (typeof row?.url === "string" && /^https:\/\//i.test(row.url)) {
      const imageResponse = await fetch(row.url, { signal: AbortSignal.timeout(60000) });
      if (!imageResponse.ok) {
        lastError = "image_download_failed";
        continue;
      }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > PHOTO_LIMIT) throw new Error("image_too_large");
      return bytes;
    }
    lastError = "empty_image_response";
  }
  throw new Error(lastError);
}

function saveIllustration(contentItemId: string, bytes: Buffer): StoredMediaItem {
  if (!/^[0-9a-f-]{36}$/i.test(contentItemId)) throw new Error("invalid_content_item");
  const relpath = `generated/${contentItemId.toLowerCase()}/${randomUUID()}.png`;
  if (!MEDIA_RELPATH_RE.test(relpath)) throw new Error("invalid_media_path");
  const root = resolve(MEDIA_ROOT);
  const full = resolve(root, relpath);
  if (full !== root && !full.startsWith(`${root}/`)) throw new Error("invalid_media_path");
  mkdirSync(resolve(root, "generated", contentItemId.toLowerCase()), { mode: 0o750, recursive: true });
  writeFileSync(full, bytes, { mode: 0o640 });
  return { kind: "photo", mime: "image/png", bytes: bytes.length, relpath };
}

export async function maybeIllustrate(options: {
  generateImage: boolean;
  openaiSecret?: string | null;
  draftText: string;
  contentItemId: string;
  media: PostMedia;
}): Promise<PostMedia> {
  if (!options.generateImage) return options.media;
  const media: PostMedia = {
    present: options.media.present,
    grouped: options.media.grouped,
    items: [...options.media.items],
    skipped: [...options.media.skipped],
  };
  if (!options.openaiSecret) {
    media.illustration = { status: "skipped", reason: "no_image_provider" };
    return media;
  }
  if (media.items.length >= ALBUM_LIMIT) {
    media.illustration = { status: "skipped", reason: "album_full" };
    return media;
  }
  try {
    const bytes = await requestOpenAIImage(options.openaiSecret, illustrationPrompt(options.draftText));
    const item = saveIllustration(options.contentItemId, bytes);
    media.items.push(item);
    media.present = true;
    media.grouped = media.items.length > 1;
    media.illustration = { status: "generated" };
    return media;
  } catch {
    media.illustration = { status: "skipped", reason: "provider_error" };
    return media;
  }
}
