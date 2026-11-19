"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2, RadioTower, ShieldAlert } from "lucide-react";

type Flow = { id: string; name: string; source_type: string; status: string };
type Donor = { id: string; chat_id: string; username: string | null; title: string; access_status: string; bot_can_receive_posts: boolean; last_checked_at: string | null };

export default function DonorManagerPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState("");
  const [donors, setDonors] = useState<Donor[]>([]);
  const [chat, setChat] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDonors = useCallback(async (org: string, flow: string) => {
    if (!flow) { setDonors([]); return; }
    const response = await fetch(`/api/autoposting/donors?organizationId=${encodeURIComponent(org)}&flowId=${encodeURIComponent(flow)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить доноров.");
    setDonors(data.donors || []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось определить рабочее пространство.");
        const [flowResponse] = await Promise.all([
          fetch(`/api/autoposting/flows?organizationId=${encodeURIComponent(data.organizationId)}`, { cache: "no-store" }),
        ]);
        const flowData = await flowResponse.json();
        if (!flowResponse.ok) throw new Error(flowData.error || "Не удалось загрузить потоки.");
        if (!alive) return;
        const telegramFlows = (flowData.flows || []).filter((f: Flow) => f.source_type === "telegram_channels");
        setOrganizationId(data.organizationId); setFlows(telegramFlows);
        if (telegramFlows[0]) {
          setFlowId(telegramFlows[0].id);
          await loadDonors(data.organizationId, telegramFlows[0].id);
        }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [loadDonors]);

  async function add(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/donors?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flowId, chat }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось добавить источник.");
      setChat(""); await loadDonors(organizationId, flowId); setNotice(data.message || "Источник добавлен.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка добавления."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить этот источник из потока?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/autoposting/donors?organizationId=${encodeURIComponent(organizationId)}&flowId=${encodeURIComponent(flowId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Не удалось удалить источник."); }
      await loadDonors(organizationId, flowId); setNotice("Источник удалён.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка Donor Manager…</section>;
  return <div className="autoposting-layout">
    <section className="panel">
      <div className="panel-head"><div><h2>Donor Manager</h2><p>Реестр Telegram-каналов — источников контента для выбранного потока.</p></div><span className="pill warning">MVP</span></div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      {flows.length === 0 ? <div className="activity-empty">Нет потоков с источником «Telegram-каналы». Создайте такой поток в разделе AI Автопостинг.</div> :
        <form className="integration-connect-form autoposting-form" onSubmit={add}>
          <label>Поток автопостинга
            <select value={flowId} onChange={async e => { const id=e.target.value; setFlowId(id); setError(""); setNotice(""); try { await loadDonors(organizationId,id); } catch(err) { setError(err instanceof Error ? err.message : "Ошибка загрузки."); } }}>
              {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label>Telegram-канал-донор
            <input value={chat} onChange={e => setChat(e.target.value)} placeholder="@channel_name, https://t.me/channel_name или -1001234567890" required/>
            <small>Можно указать @username, публичную ссылку t.me или числовой Telegram Chat ID (например, -1001234567890). Мониторинг идёт через пользовательский аккаунт Telegram; для публичных каналов добавлять бота администратором не нужно.</small>
          </label>
          <button className="primary" type="submit" disabled={busy || !chat.trim()}>{busy ? <><LoaderCircle className="spin" size={14}/> Проверяем…</> : <><Plus size={14}/> Проверить и добавить источник</>}</button>
        </form>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Источники потока</h2><p>{donors.length} добавленных каналов</p></div><button className="secondary" onClick={() => loadDonors(organizationId,flowId)} disabled={busy || !flowId}><RefreshCw size={14}/> Обновить</button></div>
      {!flowId ? <div className="activity-empty">Выберите Telegram-поток.</div> : donors.length === 0 ? <div className="activity-empty"><RadioTower size={20}/> Добавьте первый канал-донор.</div> :
        <div className="autoposting-flow-list">{donors.map(d => <article className="autoposting-flow" key={d.id}>
          <div className="autoposting-flow-head"><div><b>{d.title}</b><small>{d.username ? "@" + d.username : d.chat_id}</small></div><span className="pill success">Сохранён</span></div>
          <div className="autoposting-flow-meta">Канал сохранён. Мониторинг публикаций идёт через пользовательский аккаунт Telegram, а не через бота. Для публичных каналов добавлять бота администратором не нужно.</div>
          <div className="autoposting-flow-actions"><button className="text-button danger" onClick={() => remove(d.id)} disabled={busy}><Trash2 size={13}/> Удалить</button></div>
        </article>)}</div>}
      <div className="integration-alert"><ShieldAlert size={16}/><span>Публикации читает пользовательский аккаунт Telegram, подключённый к слушателю. Для публичных каналов добавлять бота администратором не нужно.</span></div>
    </section>
  </div>;
}
