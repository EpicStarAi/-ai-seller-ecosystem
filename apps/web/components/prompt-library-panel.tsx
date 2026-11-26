"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

type Prompt = { id: string; name: string; text: string; created_at: string; updated_at: string };

export default function PromptLibraryPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [form, setForm] = useState({ id: "", name: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (org: string) => {
    const response = await fetch(`/api/autoposting/prompts?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить промпты.");
    setPrompts(data.prompts || []);
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
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/autoposting/prompts", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, id: form.id || undefined, name: form.name, text: form.text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить промпт.");
      setForm({ id: "", name: "", text: "" });
      await refresh(organizationId);
      setNotice(form.id ? "Промпт обновлён." : "Промпт сохранён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить этот промпт? Потоки, которые его использовали, вернутся к своей AI-инструкции.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/prompts?organizationId=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось удалить промпт.");
      if (form.id === id) setForm({ id: "", name: "", text: "" });
      await refresh(organizationId);
      setNotice("Промпт удалён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка библиотеки промптов…</section>;

  return <div className="autoposting-layout">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{form.id ? "Редактировать промпт" : "Библиотека промптов"}</h2>
          <p>Сохраните инструкции для AI-переписывания и выбирайте их в настройках потока. До 13 000 символов.</p>
        </div>
        {form.id && <button className="secondary" type="button" onClick={() => setForm({ id: "", name: "", text: "" })}><Plus size={14}/> Новый</button>}
      </div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      <form className="integration-connect-form autoposting-form" onSubmit={save}>
        <label>Название
          <input value={form.name} onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))} maxLength={120} required placeholder="Новости PUBG, короткий стиль"/>
        </label>
        <label>Текст промпта
          <textarea value={form.text} onChange={(e) => setForm((old) => ({ ...old, text: e.target.value }))} rows={10} maxLength={13000} required placeholder="Как редактировать посты донора…"/>
        </label>
        <small>{form.text.length} / 13 000</small>
        <div className="autoposting-actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>} {form.id ? "Сохранить изменения" : "Сохранить промпт"}</button>
        </div>
      </form>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Сохранённые промпты</h2><p>{prompts.length} шт.</p></div></div>
      {prompts.length === 0 ? <div className="activity-empty">Пока нет сохранённых промптов.</div> :
        <div className="autoposting-flow-list">{prompts.map((prompt) => (
          <article className="autoposting-flow" key={prompt.id}>
            <div className="autoposting-flow-head"><div><b>{prompt.name}</b><small>{prompt.text.length} символов</small></div></div>
            <div className="autoposting-flow-meta">{prompt.text.slice(0, 280)}{prompt.text.length > 280 ? "…" : ""}</div>
            <div className="autoposting-flow-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => { setForm({ id: prompt.id, name: prompt.name, text: prompt.text }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Изменить</button>
              <button className="text-button danger" type="button" disabled={busy} onClick={() => remove(prompt.id)}><Trash2 size={13}/> Удалить</button>
            </div>
          </article>
        ))}</div>}
    </section>
  </div>;
}
