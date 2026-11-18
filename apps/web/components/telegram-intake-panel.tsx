"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, Send } from "lucide-react";

type Flow = { id: string; name: string };
type Donor = { id: string; username: string | null; title: string };

export default function TelegramIntakePanel() {
  const [org, setOrg] = useState("");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState("");
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donorId, setDonorId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [basis, setBasis] = useState("explicit_permission");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (organizationId: string, selectedFlow: string) => {
    if (!organizationId || !selectedFlow) return;
    const [dRes, iRes] = await Promise.all([
      fetch(`/api/autoposting/donors?organizationId=${encodeURIComponent(organizationId)}&flowId=${encodeURIComponent(selectedFlow)}`, { cache: "no-store" }),
      fetch(`/api/autoposting/telegram-intake?organizationId=${encodeURIComponent(organizationId)}&flowId=${encodeURIComponent(selectedFlow)}`, { cache: "no-store" }),
    ]);
    const dd = await dRes.json(), ii = await iRes.json();
    if (!dRes.ok) throw new Error(dd.error || "Не удалось загрузить доноров.");
    if (!iRes.ok) throw new Error(ii.error || "Не удалось загрузить входящую очередь.");
    setDonors(dd.donors || []);
    setItems(ii.items || []);
    if (dd.donors?.length) setDonorId((old) => dd.donors.some((x: Donor) => x.id === old) ? old : dd.donors[0].id);
    else setDonorId("");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const bd = await b.json();
        if (!b.ok) throw new Error(bd.error || "Не удалось определить рабочее пространство.");
        const f = await fetch(`/api/autoposting/flows?organizationId=${encodeURIComponent(bd.organizationId)}`, { cache: "no-store" });
        const fd = await f.json();
        if (!f.ok) throw new Error(fd.error || "Не удалось загрузить потоки.");
        const telegramFlows = (fd.flows || []).filter((x: any) => x.source_type === "telegram_channels");
        if (!alive) return;
        setOrg(bd.organizationId); setFlows(telegramFlows);
        if (telegramFlows[0]) { setFlowId(telegramFlows[0].id); await load(bd.organizationId, telegramFlows[0].id); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
    })();
    return () => { alive = false; };
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/autoposting/telegram-intake?organizationId=${encodeURIComponent(org)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, donorId, sourceUrl: url, title, content, rightsBasis: basis, rightsNote: note }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Не удалось принять публикацию.");
      setUrl(""); setTitle(""); setContent(""); setNote("");
      setNotice(data.message || "Материал помещён во входящую очередь.");
      await load(org, flowId);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка приёма материала."); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-head"><div><h2>Telegram Content Intake</h2><p>Ручная передача публикации в защищённую очередь материалов. Автоматический сбор из Telegram не включён.</p></div><span className="pill warning">Review required</span></div>
    {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
    {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
    {!flows.length ? <div className="activity-empty">Нет Telegram-потоков. Создайте поток в AI Автопостинг.</div> : <>
      <form className="integration-connect-form autoposting-form" onSubmit={submit}>
        <label>Поток<select value={flowId} onChange={async e => { const id=e.target.value; setFlowId(id); setError(""); try { await load(org,id); } catch(err) { setError(err instanceof Error ? err.message : "Ошибка загрузки."); } }}>
          {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Донор<select value={donorId} onChange={e=>setDonorId(e.target.value)} required>
          {donors.map(d=><option key={d.id} value={d.id}>{d.title}{d.username ? " · @"+d.username : ""}</option>)}
        </select></label>
        <label>Ссылка на конкретную публикацию<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://t.me/channel/12345" required/></label>
        <label>Заголовок (необязательно)<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Тема публикации"/></label>
        <label>Текст публикации<textarea value={content} onChange={e=>setContent(e.target.value)} rows={5} maxLength={50000} placeholder="Вставьте текст, на использование которого у вас есть разрешение…" required/></label>
        <label>Основание использования<select value={basis} onChange={e=>setBasis(e.target.value)}>
          <option value="explicit_permission">Явное разрешение правообладателя</option>
          <option value="licensed">Лицензия</option>
          <option value="owner_authorized">Собственный контент / правообладатель</option>
        </select></label>
        <label>Пояснение к правам<input value={note} onChange={e=>setNote(e.target.value)} minLength={8} placeholder="Например: разрешение автора от 18.11.2026" required/></label>
        <button className="primary" type="submit" disabled={busy || !donorId || !content.trim()}>{busy ? <><LoaderCircle className="spin" size={14}/> Сохраняем…</> : <><Send size={14}/> Передать в очередь проверки</>}</button>
      </form>
    </>}
    <div className="panel-head" style={{marginTop:24}}><div><h2>Входящая очередь</h2><p>{items.length} материалов · последние 100</p></div><button className="secondary" onClick={()=>load(org,flowId)} disabled={busy || !flowId}><RefreshCw size={14}/> Обновить</button></div>
    {!items.length ? <div className="activity-empty">Очередь пока пуста.</div> : <div className="autoposting-flow-list">{items.map(item=><article className="autoposting-flow" key={item.id}>
      <div className="autoposting-flow-head"><div><b>{item.title || "Публикация без заголовка"}</b><small>{item.source_url}</small></div><span className={item.review_status==="approved"?"pill success":"pill warning"}>{item.review_status==="approved"?"Одобрено":item.review_status==="rejected"?"Отклонено":"Ожидает проверки"}</span></div>
      <div className="autoposting-flow-meta" style={{whiteSpace:"pre-wrap"}}>{item.body}</div>
      <small>Основание: {item.rights_basis} · {new Date(item.created_at).toLocaleString("ru-RU")}</small>
    </article>)}</div>}
  </section>;
}
