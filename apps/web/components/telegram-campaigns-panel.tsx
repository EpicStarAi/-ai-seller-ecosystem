"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Megaphone, Plus, RefreshCw, Trash2, Users } from "lucide-react";

type Channel = { id: string; title: string; username: string | null; can_post_messages: boolean };
type Campaign = { id: string; name: string; message_text: string; status: string; created_at: string; telegram_channels?: { title?: string; username?: string | null } | null };

export default function TelegramCampaignsPanel() {
  const [org, setOrg] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [subscribers, setSubscribers] = useState(0);
  const [channelId, setChannelId] = useState("");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (organizationId: string) => {
    const [cRes, tRes] = await Promise.all([
      fetch(`/api/telegram/channels?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" }),
      fetch(`/api/telegram/campaigns?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" }),
    ]);
    const cd = await cRes.json(), td = await tRes.json();
    if (!cRes.ok) throw new Error(cd.error || "Не удалось загрузить каналы.");
    if (!tRes.ok) throw new Error(td.error || "Не удалось загрузить кампании.");
    const usable = (cd.channels || []).filter((x: Channel) => x.can_post_messages);
    setChannels(usable);
    setCampaigns(td.campaigns || []);
    setSubscribers(td.optedInSubscribers || 0);
    setChannelId(old => usable.some((x: Channel) => x.id === old) ? old : usable[0]?.id || "");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Не удалось определить рабочее пространство.");
        if (!alive) return;
        setOrg(d.organizationId);
        await load(d.organizationId);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
    })();
    return () => { alive = false; };
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/telegram/campaigns?organizationId=${encodeURIComponent(org)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, messageText, channelId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Не удалось сохранить кампанию.");
      setName(""); setMessageText(""); setShowForm(false);
      setNotice(d.message || "Черновик сохранён.");
      await load(org);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Удалить этот черновик кампании?")) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/telegram/campaigns?organizationId=${encodeURIComponent(org)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Не удалось удалить черновик.");
      await load(org);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-head">
      <div><h2>Telegram Campaign Manager</h2><p>Кампании сообщений для собственной аудитории, подписавшейся на вашего бота.</p></div>
      <button className="primary" onClick={() => setShowForm(v => !v)} disabled={!channels.length}><Plus size={15}/> Новая кампания</button>
    </div>
    {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
    {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
    <div className="stats-grid" style={{gridTemplateColumns:"repeat(2,minmax(0,1fr))"}}>
      <article className="stat-card"><div className="stat-top"><span>Подписчики с согласием</span><Users size={17}/></div><strong>{subscribers}</strong><small>Telegram bot subscribers</small></article>
      <article className="stat-card"><div className="stat-top"><span>Черновики и кампании</span><Megaphone size={17}/></div><strong>{campaigns.length}</strong><small>Сохранённые кампании</small></article>
    </div>
    {showForm && <form className="integration-connect-form autoposting-form" onSubmit={create} style={{marginTop:18}}>
      <label>Название кампании<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="Например: Weekly product update" required/></label>
      <label>Канал / бот<select value={channelId} onChange={e=>setChannelId(e.target.value)} required>
        {channels.map(c=><option key={c.id} value={c.id}>{c.title}{c.username ? " · @"+c.username : ""}</option>)}
      </select></label>
      <label>Текст сообщения<textarea value={messageText} onChange={e=>setMessageText(e.target.value)} rows={6} maxLength={4096} placeholder="Подготовьте полезное сообщение для подписчиков…" required/></label>
      <div className="tool-hint">Аудитория фиксирована: только пользователи, которые самостоятельно открыли диалог с ботом и дали согласие. Сейчас сохраняется черновик — отправка и планировщик ещё не активированы.</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="primary" type="submit" disabled={busy || !channelId || !name.trim() || !messageText.trim()}>{busy ? <><LoaderCircle className="spin" size={14}/> Сохраняем…</> : "Сохранить черновик"}</button><button className="secondary" type="button" onClick={()=>setShowForm(false)}>Отмена</button></div>
    </form>}
    {!channels.length && <div className="activity-empty">Нет подключённых Telegram-каналов с правом публикации. Сначала настройте Telegram Workspace.</div>}
    <div className="panel-head" style={{marginTop:22}}><div><h2>Список кампаний</h2><p>{campaigns.length} записей</p></div><button className="secondary" onClick={()=>load(org)} disabled={busy || !org}><RefreshCw size={14}/> Обновить</button></div>
    {!campaigns.length ? <div className="activity-empty">Кампаний пока нет. Создайте первый черновик.</div> : <div className="autoposting-flow-list">{campaigns.map(c=><article className="autoposting-flow" key={c.id}>
      <div className="autoposting-flow-head"><div><b>{c.name}</b><small>{c.telegram_channels?.title || "Telegram destination"} · {new Date(c.created_at).toLocaleString("ru-RU")}</small></div><span className="pill warning">{c.status === "draft" ? "Черновик" : c.status}</span></div>
      <div className="autoposting-flow-meta" style={{whiteSpace:"pre-wrap"}}>{c.message_text}</div>
      <div className="autoposting-flow-meta">Аудитория: подписчики Telegram-бота с согласием</div>
      {c.status === "draft" && <button className="secondary" onClick={()=>remove(c.id)} disabled={busy}><Trash2 size={14}/> Удалить черновик</button>}
    </article>)}</div>}
  </section>;
}
