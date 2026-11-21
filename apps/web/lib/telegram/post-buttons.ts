/**
 * Build Telegram Bot API reply_markup.inline_keyboard from a flow's
 * post_buttons config. URL templates may include {source_url}.
 * Buttons whose URL is missing after substitution (e.g. no source link)
 * are omitted. The autoposting publisher passes {source_url} from the content item.
 */

export type PostButton = { text: string; url: string };
export type PostButtons = PostButton[][];
export type InlineKeyboardMarkup = { inline_keyboard: PostButton[][] };

const SOURCE_PLACEHOLDER = "{source_url}";
const MAX_ROWS = 8;
const MAX_BUTTONS_PER_ROW = 8;
const MAX_TEXT = 64;
const MAX_URL = 2048;

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function parsePostButtons(value: unknown): PostButtons | { error: string } {
  if (value == null) return [];
  if (!Array.isArray(value)) return { error: "post_buttons must be an array of rows." };
  if (value.length > MAX_ROWS) return { error: "Too many button rows." };
  const rows: PostButtons = [];
  for (const rawRow of value) {
    if (!Array.isArray(rawRow)) return { error: "Each post_buttons row must be an array." };
    if (rawRow.length > MAX_BUTTONS_PER_ROW) return { error: "Too many buttons in a row." };
    const row: PostButton[] = [];
    for (const raw of rawRow) {
      if (!raw || typeof raw !== "object") return { error: "Each button must be an object with text and url." };
      const text = typeof (raw as PostButton).text === "string" ? (raw as PostButton).text.trim() : "";
      const url = typeof (raw as PostButton).url === "string" ? (raw as PostButton).url.trim() : "";
      if (!text || text.length > MAX_TEXT) return { error: "Button text must be 1–64 characters." };
      if (!url || url.length > MAX_URL) return { error: "Button URL is missing or too long." };
      const unresolved = url.includes(SOURCE_PLACEHOLDER) ? url.split(SOURCE_PLACEHOLDER).join("https://t.me/placeholder") : url;
      if (!isSafeHttpUrl(unresolved)) return { error: "Button URL must be http(s) or use {source_url}." };
      row.push({ text, url });
    }
    if (row.length) rows.push(row);
  }
  return rows;
}

export function buildPostReplyMarkup(
  buttons: unknown,
  vars: { source_url?: string | null } = {},
): InlineKeyboardMarkup | undefined {
  const parsed = parsePostButtons(buttons);
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const sourceUrl = typeof vars.source_url === "string" ? vars.source_url.trim() : "";
  const keyboard: PostButton[][] = [];
  for (const row of parsed) {
    const next: PostButton[] = [];
    for (const button of row) {
      let url = button.url;
      if (url.includes(SOURCE_PLACEHOLDER)) {
        if (!sourceUrl || !isSafeHttpUrl(sourceUrl)) continue;
        url = url.split(SOURCE_PLACEHOLDER).join(sourceUrl);
      }
      if (!isSafeHttpUrl(url) || url.length > MAX_URL) continue;
      next.push({ text: button.text, url });
    }
    if (next.length) keyboard.push(next);
  }
  return keyboard.length ? { inline_keyboard: keyboard } : undefined;
}
