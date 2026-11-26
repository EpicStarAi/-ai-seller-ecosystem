export const DEFAULT_SHOP_URL = "https://t.me/GAMEOVER_TG_BOT?startapp";
export const DEFAULT_CHANNEL = "@gameover_pubg";
export const DEFAULT_CHANNEL_URL = "https://t.me/gameover_pubg";

export const DEFAULT_TRAFFIC_WELCOME = [
  "🎮 Добро пожаловать в GAME OVER!",
  "",
  "Свежие новости PUBG MOBILE, розыгрыши и магазин в одном месте.",
  "",
  "🎁 Участвуй в розыгрышах за подписку на канал",
  "👥 Приглашай друзей: каждый подписавшийся друг = +1 билет",
  "🏆 Попади в топ приглашающих",
].join("\n");

export function channelUrl(channel: string | null | undefined) {
  const value = (channel || DEFAULT_CHANNEL).trim();
  if (/^@[A-Za-z0-9_]{4,64}$/.test(value)) return `https://t.me/${value.slice(1)}`;
  return DEFAULT_CHANNEL_URL;
}

export function refLink(botUsername: string, code: string) {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=ref_${code}`;
}

export function sourceLink(botUsername: string, tag: string) {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=src_${tag}`;
}

export const TRAFFIC_BOT_COLUMNS = "traffic_enabled,traffic_channel,traffic_welcome";
