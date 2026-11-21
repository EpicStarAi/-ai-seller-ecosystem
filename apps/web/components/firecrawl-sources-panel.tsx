"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, FileText, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

type Flow = { id: string; name: string; source_type: string };
type Item = { id: string; title: string; canonical_url: string; review_status: string; fetched_at: string };
type Source = {
  id: string; flow_id: string; url: string; domain: string; title: string;
  permission_status: string; rights_note: string | null; ingest_enabled: boolean;
  last_scraped_at: string | null; last_error: string | null; items: Item[];
};

export default function FirecrawlSourcesPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [rightsBasis, setRightsBasis] = useState("owner_authorized");
  const [rightsNote, setRightsNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scrapingId, setScrapingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSources = useCallback(async (org: string, flow: string) => {
    if (!flow) { setSources([]); return; }
    const response = await fetch(`/api/autoposting/web-sources?organizationId=${encodeURIComponent(org)}&flowId=${encodeURIComponent(flow)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить веб-источники.");
    setSources(data.sources || []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось определить рабочее пространство.");
        const flowResponse = await fetch(`/api/autoposting/flows?organizationId=${encodeURIComponent(data.organizationId)}`, { cache: "no-store" });
        const flowData = await flowResponse.json();
        if (!flowResponse.ok) throw new Error(flowData.error || "Не удалось загрузить потоки.");
        if (!alive) return;
        const webFlows = (flowData.flows || []).filter((f: Flow) => f.source_type === "web_search");
        setOrganizationId(data.organizationId);
        setFlows(webFlows);
        if (webFlows[0]) {
          setFlowId(webFlows[0].id);
          await loadSources(data.organizationId, webFlows[0].id);
        }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [loadSources]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/web-sources?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, url, title, rightsConfirmed, rightsBasis, rightsNote }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось добавить сайт.");
      setUrl(""); setTitle(""); setRightsConfirmed(false); setRightsNote("");
      await loadSources(organizationId, flowId);
      setNotice(data.message || "Сайт добавлен.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка добавления."); }
    finally { setBusy(false); }
  }

  async function scrape(sourceId: string) {
    setScrapingId(sourceId); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/web-sources/scrape?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Firecrawl не смог извлечь страницу.");
      await loadSources(organizationId, flowId);
      setNotice(data.message || "Материал сохранён.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка Firecrawl."); }
    finally { setScrapingId(""); }
  }

  async function remove(sourceId: string) {
    if (!window.confirm("Удалить веб-источник и сохранённые материалы?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/web-sources?organizationId=${encodeURIComponent(organizationId)}&flowId=${encodeURIComponent(flowId)}&id=${encodeURIComponent(sourceId)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Не удалось удалить сайт."); }
      await loadSources(organizationId, flowId);
      setNotice("Источник и связанные материалы удалены.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка Firecrawl Sources…</section>;

  return <section className="panel">
    <div className="panel-head">
      <div><h2>Web Sources · Firecrawl</h2><p>Извлечение содержимого разрешённых веб-страниц в очередь проверки.</p></div>
      <span className="pill success">LOCAL API</span>
    </div>
    {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
    {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
    {flows.length === 0 ? <div className="activity-empty">Нет потоков с источником «Поиск по интернету». Создайте такой поток в AI Автопостинг — он появится здесь.</div> :
      <div className="autoposting-layout">
        <form className="integration-connect-form autoposting-form" onSubmit={add}>
          <label>Поток автопостинга
            <select value={flowId} onChange={async e => { const id=e.target.value; setFlowId(id); setError(""); setNotice(""); try { await loadSources(organizationId,id); } catch(err) { setError(err instanceof Error ? err.message : "Ошибка загрузки."); } }}>
              {flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
            </select>
          </label>
          <label>URL сайта
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/news" required/>
            <small>Только HTTPS и публичные домены. Внутренние IP и локальные адреса блокируются.</small>
          </label>
          <label>Название источника (необязательно)
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название сайта или раздела"/>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={rightsConfirmed} onChange={e => setRightsConfirmed(e.target.checked)}/>
            <span>Подтверждаю владение сайтом или наличие разрешения/лицензии на извлечение и использование материалов.</span>
          </label>
          {rightsConfirmed && <>
            <label>Основание прав
              <select value={rightsBasis} onChange={e => setRightsBasis(e.target.value)}>
                <option value="owner_authorized">Собственный сайт / разрешение владельца</option>
                <option value="licensed">Лицензия / договор</option>
              </select>
            </label>
            <label>Описание основания
              <input value={rightsNote} onChange={e => setRightsNote(e.target.value)} placeholder="Например: наш сайт / письменное разрешение от владельца" required/>
            </label>
          </>}
          <button className="primary" type="submit" disabled={busy || !url.trim() || !flowId}>
            {busy ? <><LoaderCircle className="spin" size={14}/> Сохраняем…</> : <><Plus size={14}/> Добавить веб-источник</>}
          </button>
          <div className="integration-alert"><ShieldCheck size={16}/><span>Без подтверждения источник сохранится в карантине. Извлечение запрещено, пока права не подтверждены. Полученные материалы всегда поступают на ручную проверку.</span></div>
        </form>
        <div>
          <div className="panel-head"><div><h3>Источники потока</h3><p>{sources.length} сайтов</p></div><button className="secondary" onClick={() => loadSources(organizationId,flowId)} disabled={busy || !!scrapingId}><RefreshCw size={14}/> Обновить</button></div>
          {sources.length === 0 ? <div className="activity-empty"><FileText size={20}/> Добавьте первый разрешённый сайт.</div> :
            <div className="autoposting-flow-list">{sources.map(source => <article className="autoposting-flow" key={source.id}>
              <div className="autoposting-flow-head"><div><b>{source.title}</b><small><a href={source.url} target="_blank" rel="noreferrer">{source.domain} <ExternalLink size={11}/></a></small></div>
                <span className={source.ingest_enabled ? "pill success" : "pill warning"}>{source.ingest_enabled ? "Разрешён" : "Карантин"}</span>
              </div>
              <div className="autoposting-flow-meta">{source.permission_status === "pending_review" ? "Права не подтверждены. Извлечение заблокировано." : source.rights_note || "Основание прав сохранено."}</div>
              <div className="autoposting-flow-meta">Последнее извлечение: {source.last_scraped_at ? new Date(source.last_scraped_at).toLocaleString() : "ещё не выполнялось"}</div>
              {source.last_error && <div className="integration-alert error"><AlertCircle size={14}/><span>{source.last_error}</span></div>}
              {source.items?.length > 0 && <div className="autoposting-flow-meta">Сохранённые материалы: {source.items.length}
                <ul>{source.items.slice(0,5).map(item => <li key={item.id}><a href={item.canonical_url} target="_blank" rel="noreferrer">{item.title || item.canonical_url}</a> · {item.review_status === "pending_review" ? "ожидает проверки" : item.review_status}</li>)}</ul>
              </div>}
              <div className="autoposting-flow-actions">
                <button className="secondary" onClick={() => scrape(source.id)} disabled={!source.ingest_enabled || !!scrapingId || busy}>
                  {scrapingId === source.id ? <><LoaderCircle className="spin" size={13}/> Firecrawl…</> : <><RefreshCw size={13}/> Извлечь страницу</>}
                </button>
                <button className="text-button danger" onClick={() => remove(source.id)} disabled={busy || !!scrapingId}><Trash2 size={13}/> Удалить</button>
              </div>
            </article>)}</div>}
        </div>
      </div>}
  </section>;
}
