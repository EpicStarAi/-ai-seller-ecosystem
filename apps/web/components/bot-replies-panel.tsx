"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Download, LoaderCircle, MessageCircle, Save, Trash2, WandSparkles } from "lucide-react";

type Bot = {
  id: string; name: string; telegram_username: string | null; enabled: boolean;
  main_message: string; ai_enabled: boolean; prompt_id: string | null; knowledge_base: string;
  reply_limit_per_user: number | null; operator_mode_enabled: boolean; operator_chat_id: string | null;
  has_token?: boolean; user_count?: number;
};
type Prompt = { id: string; name: string };
type UserRow = {
  id: string; telegram_user_id: number; username: string | null; first_name: string | null;
  last_name: string | null; reply_count: number; first_seen_at: string; last_seen_at: string;
};
type Msg = { id: string; direction: string; source: string; body: string; created_at: string };

const blank = {
  id: "", name: "", token: "", mainMessage: "", aiEnabled: false, promptId: "", knowledgeBase: "",
  replyLimitPerUser: "", operatorModeEnabled: false, operatorChatId: "",
};

function userLabel(user: UserRow) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || (user.username ? `@${user.username}` : `id ${user.telegram_user_id}`);
}

export default function BotRepliesPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [bots, setBots] = useState<Bot[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [form, setForm] = useState(blank);
  const [tab, setTab] = useState<"settings" | "dialogs" | "test">("settings");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = bots.find((bot) => bot.id === form.id) || null;

  const refreshBots = useCallback(async (org: string) => {
    const [botResponse, promptResponse] = await Promise.all([
      fetch(`/api/bot-replies/bots?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
      fetch(`/api/autoposting/prompts?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
    ]);
    const botData = await botResponse.json();
    const promptData = await promptResponse.json();
    if (!botResponse.ok) throw new Error(botData.error || "Не удалось загрузить ботов.");
    if (!promptResponse.ok) throw new Error(promptData.error || "Не удалось загрузить промпты.");
    setBots(botData.bots || []);
    setPrompts(promptData.prompts || []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось определить рабочее пространство.");
        if (!active) return;
        setOrganizationId(data.organizationId);
        await refreshBots(data.organizationId);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshBots]);

  function fill(bot: Bot) {
    setForm({
      id: bot.id, name: bot.name, token: "", mainMessage: bot.main_message,
      aiEnabled: bot.ai_enabled, promptId: bot.prompt_id || "", knowledgeBase: bot.knowledge_base,
      replyLimitPerUser: bot.reply_limit_per_user == null ? "" : String(bot.reply_limit_per_user),
      operatorModeEnabled: bot.operator_mode_enabled, operatorChatId: bot.operator_chat_id || "",
    });
    setTab("settings");
    setSelectedUser(null);
    setMessages([]);
    setNotice(`Бот ${bot.telegram_username ? `@${bot.telegram_username}` : bot.name} загружен в форму. Токен не показывается.`);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload: Record<string, unknown> = {
        organizationId, name: form.name, mainMessage: form.mainMessage, aiEnabled: form.aiEnabled,
        promptId: form.promptId || null, knowledgeBase: form.knowledgeBase,
        replyLimitPerUser: form.replyLimitPerUser === "" ? null : Number(form.replyLimitPerUser),
        operatorModeEnabled: form.operatorModeEnabled, operatorChatId: form.operatorChatId || null,
      };
      if (form.token.trim()) payload.token = form.token.trim();
      const response = await fetch(form.id ? `/api/bot-replies/bots/${encodeURIComponent(form.id)}` : "/api/bot-replies/bots", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить бота.");
      setForm((old) => ({ ...old, id: data.bot?.id || old.id, token: "" }));
      await refreshBots(organizationId);
      setNotice(data.message || "Настройки сохранены. Токен хранится только на сервере.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения.");
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(bot: Bot, enabled: boolean) {
    if (!organizationId) return;
    if (enabled && !window.confirm("Включить автоответы для этого бота? Будет установлен отдельный webhook только на него. Не подключайте @GAMEOVER_TG_BOT.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/bot-replies/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось изменить статус.");
      await refreshBots(organizationId);
      setNotice(enabled ? "Автоответы включены. Webhook установлен только для этого бота." : "Автоответы выключены, webhook снят.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка переключения.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(bot: Bot) {
    if (!window.confirm(`Удалить бота ${bot.telegram_username ? `@${bot.telegram_username}` : bot.name}? Диалоги тоже будут удалены.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/bot-replies/bots/${encodeURIComponent(bot.id)}?organizationId=${encodeURIComponent(organizationId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось удалить бота.");
      if (form.id === bot.id) setForm(blank);
      await refreshBots(organizationId);
      setNotice("Бот удалён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления.");
    } finally {
      setBusy(false);
    }
  }

  async function loadUsers(botId: string, page = 1, q = userQuery) {
    const response = await fetch(`/api/bot-replies/users?organizationId=${encodeURIComponent(organizationId)}&botId=${encodeURIComponent(botId)}&page=${page}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить пользователей.");
    setUsers(data.users || []);
    setUserTotal(data.total || 0);
    setUserPage(data.page || page);
  }

  async function openDialogs(bot: Bot) {
    fill(bot);
    setTab("dialogs");
    setBusy(true); setError(""); setNotice("");
    try { await loadUsers(bot.id, 1, ""); setUserQuery(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка загрузки диалогов."); }
    finally { setBusy(false); }
  }

  async function openUser(user: UserRow) {
    if (!form.id) return;
    setSelectedUser(user);
    const response = await fetch(`/api/bot-replies/messages?organizationId=${encodeURIComponent(organizationId)}&botId=${encodeURIComponent(form.id)}&userId=${encodeURIComponent(user.id)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Не удалось загрузить сообщения."); return; }
    setMessages(data.messages || []);
  }

  async function runTest(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !form.id) return;
    setBusy(true); setError(""); setNotice(""); setTestResult("");
    try {
      const response = await fetch("/api/bot-replies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, botId: form.id, text: testText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить тест.");
      setTestResult(data.text || "");
      setNotice(data.provider ? `Тестовый ответ (${data.provider}${data.model ? ` · ${data.model}` : ""}). В Telegram ничего не отправлялось.` : "Тестовый ответ. В Telegram ничего не отправлялось.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка теста.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка автоответов…</section>;

  const kbWords = form.knowledgeBase.trim() ? form.knowledgeBase.trim().split(/\s+/).length : 0;

  return <div className="autoposting-layout">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{form.id ? "Настройки бота" : "Подключить бота для автоответов"}</h2>
          <p>Подключите отдельного бота по токену. Всё по умолчанию выключено. Не подключайте @GAMEOVER_TG_BOT — это живой магазин.</p>
        </div>
        <span className="pill warning">Выкл. по умолчанию</span>
      </div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      {form.id && <div className="autoposting-flow-actions" style={{ marginBottom: 16 }}>
        <button className={tab === "settings" ? "secondary" : "text-button"} type="button" onClick={() => setTab("settings")}>Настройки</button>
        <button className={tab === "dialogs" ? "secondary" : "text-button"} type="button" onClick={() => openDialogs(selected || { ...(bots.find((b) => b.id === form.id)! ) })}>Диалоги</button>
        <button className={tab === "test" ? "secondary" : "text-button"} type="button" onClick={() => setTab("test")}>Тест AI</button>
      </div>}
      {tab === "settings" && <form className="integration-connect-form autoposting-form" onSubmit={save}>
        <label>Название
          <input value={form.name} onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))} maxLength={120} required placeholder="Поддержка магазина"/>
        </label>
        <label>{form.id ? "Новый токен (оставьте пустым, чтобы не менять)" : "Токен Telegram-бота"}
          <input type="password" autoComplete="new-password" value={form.token} onChange={(e) => setForm((old) => ({ ...old, token: e.target.value }))} required={!form.id} placeholder={form.id ? "Токен не отображается" : "123456789:ABC…"}/>
          <small>Токен хранится в зашифрованном виде на сервере и никогда не возвращается в интерфейс.</small>
        </label>
        <label>Основное сообщение (оно же на /start)
          <textarea value={form.mainMessage} onChange={(e) => setForm((old) => ({ ...old, mainMessage: e.target.value }))} rows={5} maxLength={4096} placeholder="Здравствуйте! Напишите ваш вопрос…"/>
          <small>{form.mainMessage.length} / 4096</small>
        </label>
        <label className="autoposting-check"><input type="checkbox" checked={form.aiEnabled} onChange={(e) => setForm((old) => ({ ...old, aiEnabled: e.target.checked }))}/><span><b>Отвечать через AI</b><small>Нейроассистент по сохранённому промпту и базе знаний. Если провайдер недоступен, используется запасной, как у воркера.</small></span></label>
        {form.aiEnabled && <>
          <label>Сохранённый промпт
            <select value={form.promptId} onChange={(e) => setForm((old) => ({ ...old, promptId: e.target.value }))}>
              <option value="">Без отдельного промпта</option>
              {prompts.map((prompt) => <option value={prompt.id} key={prompt.id}>{prompt.name}</option>)}
            </select>
          </label>
          <label>База знаний
            <textarea value={form.knowledgeBase} onChange={(e) => setForm((old) => ({ ...old, knowledgeBase: e.target.value }))} rows={8} placeholder="Факты, FAQ, условия доставки…"/>
            <small>{kbWords} / 13 000 слов</small>
          </label>
          <label>Лимит автоответов на пользователя
            <input type="number" min={1} value={form.replyLimitPerUser} onChange={(e) => setForm((old) => ({ ...old, replyLimitPerUser: e.target.value }))} placeholder="Без лимита"/>
          </label>
        </>}
        <label className="autoposting-check"><input type="checkbox" checked={form.operatorModeEnabled} onChange={(e) => setForm((old) => ({ ...old, operatorModeEnabled: e.target.checked }))}/><span><b>Режим оператора</b><small>Входящие сообщения пересылаются в чат оператора. Ответ оператора через «Reply» уходит пользователю.</small></span></label>
        {form.operatorModeEnabled && <label>ID чата оператора
          <input value={form.operatorChatId} onChange={(e) => setForm((old) => ({ ...old, operatorChatId: e.target.value }))} placeholder="например 123456789"/>
        </label>}
        <div className="autoposting-actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>} {form.id ? "Сохранить настройки" : "Подключить бота (выключен)"}</button>
          {form.id && <button className="secondary" type="button" disabled={busy} onClick={() => { setForm(blank); setTab("settings"); }}>Новый бот</button>}
        </div>
      </form>}
      {tab === "dialogs" && form.id && <div>
        <div className="toolbar">
          <div className="searchbox"><input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Поиск по имени, @username или ID"/>
            <button className="secondary" type="button" disabled={busy} onClick={() => loadUsers(form.id, 1, userQuery)}>Найти</button>
          </div>
          <a className="secondary" href={`/api/bot-replies/users/export?organizationId=${encodeURIComponent(organizationId)}&botId=${encodeURIComponent(form.id)}`}><Download size={14}/> CSV</a>
          <span className="pill muted">{userTotal} пользователей</span>
        </div>
        {users.length === 0 ? <div className="activity-empty">Пока нет диалогов. Они появятся после входящих сообщений включённого бота.</div> :
          <div className="moderation-grid">
            <div className="autoposting-flow-list">{users.map((user) => (
              <article className="autoposting-flow" key={user.id}>
                <div className="autoposting-flow-head"><div><b>{userLabel(user)}</b><small>{user.username ? `@${user.username}` : `id ${user.telegram_user_id}`} · ответов: {user.reply_count}</small></div></div>
                <div className="autoposting-flow-actions"><button className="text-button" type="button" onClick={() => openUser(user)}><MessageCircle size={13}/> Диалог</button></div>
              </article>
            ))}</div>
            <div>
              {selectedUser ? <div>
                <h3>{userLabel(selectedUser)}</h3>
                <div className="autoposting-flow-list">{messages.map((msg) => (
                  <article className="autoposting-flow" key={msg.id}>
                    <div className="autoposting-flow-meta">{msg.direction === "in" ? "Входящее" : "Исходящее"} · {msg.source} · {new Date(msg.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}</div>
                    <div>{msg.body}</div>
                  </article>
                ))}</div>
              </div> : <div className="activity-empty">Выберите пользователя, чтобы увидеть переписку.</div>}
            </div>
          </div>}
        {userTotal > 20 && <div className="autoposting-flow-actions">
          <button className="secondary" type="button" disabled={userPage <= 1 || busy} onClick={() => loadUsers(form.id, userPage - 1)}>Назад</button>
          <span className="pill muted">Стр. {userPage}</span>
          <button className="secondary" type="button" disabled={userPage * 20 >= userTotal || busy} onClick={() => loadUsers(form.id, userPage + 1)}>Далее</button>
        </div>}
      </div>}
      {tab === "test" && form.id && <form className="integration-connect-form autoposting-form" onSubmit={runTest}>
        <p>Проверка нейроассистента без Telegram. Сообщения пользователям не отправляются.</p>
        <label>Сообщение пользователя
          <textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={5} required placeholder="Сколько стоит доставка?"/>
        </label>
        <div className="autoposting-actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <WandSparkles size={14}/>} Получить тестовый ответ</button>
        </div>
        {testResult && <label>Ответ AI
          <textarea readOnly value={testResult} rows={8}/>
        </label>}
      </form>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Подключённые боты</h2><p>{bots.length} шт. Автоответы не запускаются сами.</p></div></div>
      {bots.length === 0 ? <div className="activity-empty">Пока нет ботов. Подключите нового слева — он останется выключенным, пока вы сами не включите его.</div> :
        <div className="autoposting-flow-list">{bots.map((bot) => (
          <article className="autoposting-flow" key={bot.id}>
            <div className="autoposting-flow-head">
              <div><b>{bot.name}</b><small>{bot.telegram_username ? `@${bot.telegram_username}` : "username ещё не получен"} · {bot.user_count || 0} пользователей</small></div>
              <span className={bot.enabled ? "pill success" : "pill warning"}>{bot.enabled ? "Включен" : "Выключен"}</span>
            </div>
            <div className="autoposting-flow-meta">
              {bot.ai_enabled ? "AI включён" : "Только основное сообщение"}
              {bot.operator_mode_enabled ? " · режим оператора" : ""}
            </div>
            <div className="autoposting-flow-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => fill(bot)}>Изменить</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => openDialogs(bot)}>Диалоги</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => setEnabled(bot, !bot.enabled)}>{bot.enabled ? "Выключить" : "Включить"}</button>
              <button className="text-button danger" type="button" disabled={busy} onClick={() => remove(bot)}><Trash2 size={13}/> Удалить</button>
            </div>
          </article>
        ))}</div>}
    </section>
  </div>;
}
