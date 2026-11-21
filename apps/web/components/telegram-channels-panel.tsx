"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

type Channel = { id: string; integration_id: string; chat_id: string; username: string | null; title: string; chat_type: string; bot_status: string; can_post_messages: boolean };
type Bot = { id: string; label: string | null; external_account_id: string | null; metadata: Record<string, unknown> | null; status: string };

export default function TelegramChannelsPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [integrationId, setIntegrationId] = useState("");
  const [chat, setChat] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (org: string) => {
    const [channelsResponse, integrationsResponse] = await Promise.all([
      fetch(`/api/telegram/channels?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
      fetch(`/api/integrations?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
    ]);
    const [channelData, integrationData] = await Promise.all([channelsResponse.json(), integrationsResponse.json()]);
    if (!channelsResponse.ok) throw new Error(channelData.error || "Не удалось загрузить каналы.");
    if (!integrationsResponse.ok) throw new Error(integrationData.error || "Не удалось загрузить Telegram-ботов.");
    setChannels(channelData.channels || []);
    const nextBots = (integrationData.integrations || []).filter((item: Bot & { kind: string }) => item.kind === "telegram" && item.status === "connected");
    setBots(nextBots);
    setIntegrationId(current => nextBots.some((bot: Bot) => bot.id === current) ? current : nextBots[0]?.id || "");
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
        await refresh(data.organizationId);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh]);

  function botName(id: string) {
    const bot = bots.find(item => item.id === id);
    const username = typeof bot?.metadata?.username === "string" ? String(bot.metadata.username).replace(/^@/, "") : "";
    return bot?.label || (username ? `@${username}` : bot?.external_account_id || "Telegram bot");
  }

  async function addChannel(event: FormEvent) {
    event.preventDefault();
    if (!chat.trim() || !organizationId || !integrationId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/telegram/channels?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat: chat.trim(), integrationId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось добавить канал.");
      setChat(""); await refresh(organizationId);
      setNotice(`Канал «${data.channel.title}» подключён через ${botName(data.channel.integration_id)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки канала."); }
    finally { setBusy(false); }
  }

  async function testPublish(id: string) {
    if (!window.confirm("Опубликовать одно тестовое сообщение в выбранный Telegram-канал?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/telegram/channels/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, channelId: id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Тестовая публикация не выполнена.");
      setNotice("Тестовое сообщение опубликовано. Telegram message_id: " + data.message_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка тестовой публикации."); }
    finally { setBusy(false); }
  }

  async function removeChannel(id: string) {
    if (!window.confirm("Удалить канал из рабочего пространства? Потоки, ссылающиеся на него, могут запретить удаление.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/telegram/channels?organizationId=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Не удалось удалить канал."); }
      await refresh(organizationId); setNotice("Канал удалён из реестра.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка Telegram Workspace…</section>;

  return <section className="panel">
    <div className="panel-head"><div><h2>Telegram Connections</h2><p>Каждый канал закреплён за конкретным ботом. Потоки автопостинга используют именно этот бот.</p></div><button className="secondary" disabled={busy || !organizationId} onClick={() => refresh(organizationId)}><RefreshCw size={14}/> Обновить</button></div>
    {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
    {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
    <form className="integration-connect-form" onSubmit={addChannel}>
      <h3>Добавить канал</h3>
      <label>Telegram-бот
        <select value={integrationId} onChange={e => setIntegrationId(e.target.value)} required>
          {bots.length === 0 && <option value="">Нет подключённых ботов</option>}
          {bots.map(bot => <option key={bot.id} value={bot.id}>{bot.label || (typeof bot.metadata?.username === "string" ? "@" + String(bot.metadata.username).replace(/^@/, "") : bot.external_account_id)}</option>)}
        </select>
      </label>
      <label>Публичный @username или числовой chat_id
        <input value={chat} onChange={e => setChat(e.target.value)} placeholder="@my_channel или -1001234567890" required />
      </label>
      <p className="integration-security">Выбранный бот должен быть администратором канала с разрешением «Публикация сообщений». Проверка выполняется именно выбранным ботом.</p>
      <button className="primary" type="submit" disabled={busy || !chat.trim() || !integrationId}>{busy ? <><LoaderCircle className="spin" size={14}/> Проверяем…</> : <><Plus size={14}/> Проверить и добавить</>}</button>
    </form>
    <div className="panel-head" style={{ marginTop: 24 }}><div><h3>Подключённые каналы</h3><p>{channels.length} записей в текущем рабочем пространстве.</p></div></div>
    {channels.length === 0 ? <div className="activity-empty">Каналы пока не добавлены. Сначала подключите Telegram Bot API в разделе «Интеграции».</div> :
      <div className="contact-list">{channels.map(channel => <div className="contact-row" key={channel.id}>
        <div className="flow-symbol"><CheckCircle2 size={17}/></div>
        <div><b>{channel.title}</b><small>{channel.username ? `@${channel.username} · ` : ""}{channel.chat_id} · Бот: {botName(channel.integration_id)}</small></div>
        <span className={channel.can_post_messages ? "pill success" : "pill warning"}>{channel.can_post_messages ? "Публикация разрешена" : "Нет права публикации"}</span>
        <button className="text-button" disabled={busy || !channel.can_post_messages} onClick={() => testPublish(channel.id)}>Тест публикации</button>
        <button className="text-button danger" disabled={busy} onClick={() => removeChannel(channel.id)} aria-label="Удалить канал"><Trash2 size={15}/></button>
      </div>)}</div>}
  </section>;
}
