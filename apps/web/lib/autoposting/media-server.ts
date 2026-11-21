import "server-only";

import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MEDIA_RELPATH_RE } from "@/lib/autoposting/media";

export const MEDIA_ROOT = process.env.TG_MEDIA_ROOT || "/var/lib/ai-seller-telegram-listener/media";

export function resolveMediaFile(relpath: string): string | null {
  if (!MEDIA_RELPATH_RE.test(relpath)) return null;
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
