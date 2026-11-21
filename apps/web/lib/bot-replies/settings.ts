import { MAIN_MESSAGE_LIMIT, KNOWLEDGE_WORD_LIMIT, KNOWLEDGE_CHAR_LIMIT, NAME_LIMIT, wordCount } from "@/lib/bot-replies/constants";

export function parseBotSettings(body: Record<string, unknown>, partial = false) {
  const value: Record<string, unknown> = {};
  if (!partial || Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > NAME_LIMIT) return { error: "Укажите название бота (до 120 символов)." };
    value.name = name;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "mainMessage") || Object.prototype.hasOwnProperty.call(body, "main_message")) {
    const main = String(body.mainMessage ?? body.main_message ?? "");
    if (main.length > MAIN_MESSAGE_LIMIT) return { error: `Основное сообщение не длиннее ${MAIN_MESSAGE_LIMIT} символов.` };
    value.main_message = main;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "aiEnabled") || Object.prototype.hasOwnProperty.call(body, "ai_enabled")) {
    value.ai_enabled = body.aiEnabled === true || body.ai_enabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "promptId") || Object.prototype.hasOwnProperty.call(body, "prompt_id")) {
    const raw = body.promptId ?? body.prompt_id;
    if (raw === null || raw === "") value.prompt_id = null;
    else if (typeof raw === "string" && raw.trim()) value.prompt_id = raw.trim();
    else return { error: "Некорректный сохранённый промпт." };
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "knowledgeBase") || Object.prototype.hasOwnProperty.call(body, "knowledge_base")) {
    const kb = String(body.knowledgeBase ?? body.knowledge_base ?? "");
    if (kb.length > KNOWLEDGE_CHAR_LIMIT) return { error: "База знаний слишком длинная." };
    if (wordCount(kb) > KNOWLEDGE_WORD_LIMIT) return { error: `База знаний не длиннее ${KNOWLEDGE_WORD_LIMIT} слов.` };
    value.knowledge_base = kb;
  }
  if (Object.prototype.hasOwnProperty.call(body, "replyLimitPerUser") || Object.prototype.hasOwnProperty.call(body, "reply_limit_per_user")) {
    const raw = body.replyLimitPerUser ?? body.reply_limit_per_user;
    if (raw === null || raw === "" || raw === 0) value.reply_limit_per_user = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1000000) return { error: "Лимит ответов на пользователя — целое число от 1, либо пусто (без лимита)." };
      value.reply_limit_per_user = n;
    }
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "operatorModeEnabled") || Object.prototype.hasOwnProperty.call(body, "operator_mode_enabled")) {
    value.operator_mode_enabled = body.operatorModeEnabled === true || body.operator_mode_enabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "operatorChatId") || Object.prototype.hasOwnProperty.call(body, "operator_chat_id")) {
    const raw = String(body.operatorChatId ?? body.operator_chat_id ?? "").trim();
    if (!raw) value.operator_chat_id = null;
    else if (!/^-?\d{3,20}$/.test(raw)) return { error: "ID чата оператора должен быть числом (личный чат или группа)." };
    else value.operator_chat_id = raw;
  }
  if (value.operator_mode_enabled === true && !value.operator_chat_id) {
    // allow patch of the flag only if a chat id already stored; checked by the route
  }
  return { value };
}
