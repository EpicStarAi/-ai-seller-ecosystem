import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MEDIA_ROOT = process.env.TG_MEDIA_ROOT || "/var/lib/ai-seller-telegram-listener/media";
export const MEDIA_CAPTION_LIMIT = 1024;

export type MediaKind = "photo" | "video";
export type StoredMediaItem = { kind: MediaKind; mime: string; bytes: number; relpath: string };
export type PostMedia = { present?: boolean; grouped?: boolean; items: StoredMediaItem[]; skipped: { reason: string }[] };
export type PublishStep = { method: "sendPhoto" | "sendVideo" | "sendMediaGroup" | "sendMessage"; caption: boolean; buttons: boolean; count: number };

const RELPATH_RE = /^[0-9a-f-]{36}\/[0-9]{1,20}\/\d{1,2}\.(jpg|jpeg|png|webp|mp4|mov)$/i;

function asItem(value: unknown): StoredMediaItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "photo" && row.kind !== "video") return null;
  if (typeof row.relpath !== "string" || !RELPATH_RE.test(row.relpath)) return null;
  const mime = typeof row.mime === "string" && row.mime ? row.mime : row.kind === "photo" ? "image/jpeg" : "video/mp4";
  const bytes = typeof row.bytes === "number" && row.bytes >= 0 ? row.bytes : 0;
  return { kind: row.kind, mime, bytes, relpath: row.relpath };
}

export function parsePostMedia(value: unknown): PostMedia {
  if (!value || typeof value !== "object") return { items: [], skipped: [] };
  const obj = value as Record<string, unknown>;
  const inner = obj.media && typeof obj.media === "object" && !Array.isArray(obj.media)
    ? obj.media as Record<string, unknown>
    : obj;
  const items = Array.isArray(inner.items) ? inner.items.map(asItem).filter((item): item is StoredMediaItem => Boolean(item)) : [];
  const skipped = Array.isArray(inner.skipped)
    ? inner.skipped.flatMap((row) => row && typeof row === "object" && typeof (row as { reason?: unknown }).reason === "string"
      ? [{ reason: (row as { reason: string }).reason }] : [])
    : [];
  return { present: items.length > 0 || skipped.length > 0 || inner.present === true, grouped: inner.grouped === true || items.length > 1, items, skipped };
}

export function extractContentMedia(metadata: unknown): PostMedia {
  return parsePostMedia(metadata);
}

export function resolveMediaFile(relpath: string): string | null {
  if (!RELPATH_RE.test(relpath)) return null;
  const root = resolve(MEDIA_ROOT);
  const full = resolve(root, relpath);
  if (full !== root && !full.startsWith(`${root}/`)) return null;
  try {
    accessSync(full, constants.R_OK);
  } catch {
    return null;
  }
  return full;
}

export function readMediaFile(relpath: string): { path: string; bytes: Buffer } | null {
  const path = resolveMediaFile(relpath);
  if (!path) return null;
  return { path, bytes: readFileSync(path) };
}

export function planPublish(text: string, media: PostMedia, hasButtons: boolean): PublishStep[] {
  const items = media.items;
  const steps: PublishStep[] = [];
  if (items.length === 1) {
    const method = items[0].kind === "video" ? "sendVideo" : "sendPhoto";
    if (text.length > 0 && text.length <= MEDIA_CAPTION_LIMIT) {
      steps.push({ method, caption: true, buttons: hasButtons, count: 1 });
    } else {
      steps.push({ method, caption: false, buttons: false, count: 1 });
      if (text || hasButtons) steps.push({ method: "sendMessage", caption: false, buttons: hasButtons, count: 0 });
    }
    return steps;
  }
  if (items.length > 1) {
    steps.push({ method: "sendMediaGroup", caption: false, buttons: false, count: items.length });
    if (text || hasButtons) steps.push({ method: "sendMessage", caption: false, buttons: hasButtons, count: 0 });
    return steps;
  }
  steps.push({ method: "sendMessage", caption: false, buttons: hasButtons, count: 0 });
  return steps;
}
