"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock3, Copy, GitBranch, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

type StepType = "trigger" | "message" | "delay" | "condition" | "ai_response" | "action" | "end";
type Step = { id: string; type: StepType; title: string; message: string; delaySeconds: number; buttons: { text: string; url: string }[]; condition: string };
type Definition = { steps: Step[]; settings: { loopEnabled: boolean; defaultReply: string; consentRequired: boolean } };
type Funnel = { id: string; name: string; status: string; version: number; definition: Definition; versions: { version: number; created_at: string }[] };
const labels: Record<StepType, string> = { trigger: "Триггер", message: "Сообщение", delay: "Задержка", condition: "Условие", ai_response: "AI-ответ", action: "Действие", end: "Завершение" };
const blankDefinition = (): Definition => ({ steps: [{ id: crypto.randomUUID(), type: "trigger", title: "Новый подписчик", message: "", delaySeconds: 0, buttons: [], condition: "" }, { id: crypto.randomUUID(), type: "message", title: "Приветственное сообщение", message: "Привет! Добро пожаловать.", delaySeconds: 0, buttons: [], condition: "" }, { id: crypto.randomUUID(), type: "end", title: "Конец сценария", message: "", delaySeconds: 0, buttons: [], condition: "" }], settings: { loopEnabled: false, defaultReply: "", consentRequired: false } });

export default function FunnelBuilder() {
  const [organizationId, setOrganizationId] = useState("");
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<Definition>(blankDefinition);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (org: string) => {
    const response = await fetch(`/api/funnels?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить воронки.");
    setFunnels(data.funnels || []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось определить рабочее пространство.");
        if (!alive) return;
        setOrganizationId(data.organizationId);
        await refresh(data.organizationId);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [refresh]);

  function newFunnel() { setSelectedId(""); setName("Новая воронка"); setDefinition(blankDefinition()); setError(""); setNotice(""); }
  function selectFunnel(f: Funnel) { setSelectedId(f.id); setName(f.name); setDefinition(f.definition?.steps ? f.definition : blankDefinition()); setError(""); setNotice(`Загружена версия v${f.version || 1}.`); }
  function updateStep(id: string, patch: Partial<Step>) { setDefinition(old => ({ ...old, steps: old.steps.map(s => s.id === id ? { ...s, ...patch } : s) })); }
  function addStep(type: StepType) {
    const step: Step = { id: crypto.randomUUID(), type, title: labels[type], message: "", delaySeconds: type === "delay" ? 3600 : 0, buttons: [], condition: "" };
    setDefinition(old => ({ ...old, steps: [...old.steps.filter(s => s.type !== "end"), step, ...old.steps.filter(s => s.type === "end")] }));
  }
  function removeStep(id: string) { setDefinition(old => ({ ...old, steps: old.steps.filter(s => s.id !== id) })); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !name.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/funnels", { method: selectedId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, id: selectedId || undefined, name, definition }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить воронку.");
      await refresh(organizationId);
      if (data.funnel?.id) setSelectedId(data.funnel.id);
      setNotice(data.message || "Воронка сохранена.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить воронку и все её версии?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/funnels?organizationId=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Не удалось удалить воронку."); }
      await refresh(organizationId);
      if (selectedId === id) newFunnel();
      setNotice("Воронка удалена.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка конструктора воронок…</section>;

  return <div className="funnel-builder">
    <section className="panel funnel-sidebar">
      <div className="panel-head"><div><h2>Мои воронки</h2><p>{funnels.length} сохранённых сценариев</p></div><button className="primary" onClick={newFunnel}><Plus size={14}/> Создать</button></div>
      {funnels.length === 0 ? <div className="activity-empty">Пока нет сохранённых воронок.</div> : <div className="funnel-list">{funnels.map(f => <article className={selectedId === f.id ? "funnel-list-item selected" : "funnel-list-item"} key={f.id}>
        <button onClick={() => selectFunnel(f)}><b>{f.name}</b><small>Версия v{f.version || 1} · {f.definition?.steps?.length || 0} шагов</small></button>
        <button className="funnel-delete" title="Удалить" onClick={() => remove(f.id)} disabled={busy}><Trash2 size={13}/></button>
      </article>)}</div>}
      <div className="funnel-version-note"><Clock3 size={14}/> Каждое сохранение создаёт новую версию схемы.</div>
    </section>
    <section className="panel funnel-editor">
      <div className="panel-head"><div><h2>{selectedId ? "Редактор воронки" : "Новая воронка"}</h2><p>Соберите последовательность сообщений и логики.</p></div><span className="pill warning">Draft · без запуска</span></div>
      {error && <div className="integration-alert error"><AlertCircle size={15}/>{error}</div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={15}/>{notice}</div>}
      <form onSubmit={save}>
        <label className="funnel-name-label">Название воронки<input value={name} onChange={e => setName(e.target.value)} maxLength={120} required placeholder="Например: Welcome funnel"/></label>
        <div className="funnel-steps-head"><b>Сценарий · {definition.steps.length} шагов</b><span>До 40 шагов</span></div>
        <div className="funnel-step-list">{definition.steps.map((step, index) => <article className="funnel-editor-step" key={step.id}>
          <div className="funnel-editor-step-head"><span className="funnel-step-index">{String(index + 1).padStart(2, "0")}</span><select value={step.type} onChange={e => updateStep(step.id, { type: e.target.value as StepType, title: labels[e.target.value as StepType] })}>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button type="button" className="funnel-delete" onClick={() => removeStep(step.id)} title="Удалить шаг"><Trash2 size={13}/></button></div>
          <input value={step.title} onChange={e => updateStep(step.id, { title: e.target.value })} placeholder="Название шага" maxLength={120}/>
          {(step.type === "message" || step.type === "ai_response" || step.type === "action") && <textarea value={step.message} onChange={e => updateStep(step.id, { message: e.target.value })} placeholder={step.type === "ai_response" ? "Инструкция или контекст для AI-ответа…" : "Текст сообщения или описание действия…"} rows={3}/>}
          {step.type === "delay" && <label className="funnel-inline-label">Задержка, секунд<input type="number" min={0} max={2592000} value={step.delaySeconds} onChange={e => updateStep(step.id, { delaySeconds: Number(e.target.value) })}/></label>}
          {step.type === "condition" && <textarea value={step.condition} onChange={e => updateStep(step.id, { condition: e.target.value })} placeholder="Условие перехода (например: пользователь нажал кнопку «Да»)…" rows={2}/>}
          {step.type === "message" && <div className="funnel-button-fields"><b>Inline-кнопки</b>{step.buttons.map((button, i) => <div className="funnel-button-row" key={i}><input value={button.text} onChange={e => updateStep(step.id, { buttons: step.buttons.map((b, j) => j === i ? { ...b, text: e.target.value } : b) })} placeholder="Текст кнопки"/><input value={button.url} onChange={e => updateStep(step.id, { buttons: step.buttons.map((b, j) => j === i ? { ...b, url: e.target.value } : b) })} placeholder="https://…"/><button type="button" className="funnel-delete" onClick={() => updateStep(step.id, { buttons: step.buttons.filter((_, j) => j !== i) })}>×</button></div>)}<button type="button" className="text-button" onClick={() => updateStep(step.id, { buttons: [...step.buttons, { text: "", url: "" }] })}><Plus size={12}/> Добавить кнопку</button></div>}
        </article>)}</div>
        <div className="funnel-add-actions">{(["message", "delay", "condition", "ai_response", "action", "end"] as StepType[]).map(type => <button type="button" className="secondary" key={type} onClick={() => addStep(type)} disabled={definition.steps.length >= 40}><Plus size={12}/>{labels[type]}</button>)}</div>
        <div className="funnel-settings">
          <b>Настройки сценария</b>
          <label><input type="checkbox" checked={definition.settings.loopEnabled} onChange={e => setDefinition(old => ({ ...old, settings: { ...old.settings, loopEnabled: e.target.checked } }))}/> Зацикливать после последнего шага</label>
          <label><input type="checkbox" checked={definition.settings.consentRequired} onChange={e => setDefinition(old => ({ ...old, settings: { ...old.settings, consentRequired: e.target.checked } }))}/> Запрашивать согласие подписчика (opt-in)</label>
          <label>Ответ по умолчанию<textarea value={definition.settings.defaultReply} onChange={e => setDefinition(old => ({ ...old, settings: { ...old.settings, defaultReply: e.target.value } }))} rows={2} placeholder="Ответ на нераспознанные сообщения"/></label>
        </div>
        <div className="funnel-save-row"><button className="primary" type="submit" disabled={busy || !name.trim()}>{busy ? <><LoaderCircle className="spin" size={14}/> Сохраняем…</> : <><Save size={14}/> Сохранить версию</>}</button><button type="button" className="secondary" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(definition, null, 2)); setNotice("JSON схемы скопирован."); }}><Copy size={13}/> Копировать JSON</button></div>
      </form>
      <p className="funnel-runtime-note"><GitBranch size={14}/> Сейчас доступно создание и версионирование схем. Telegram-триггеры, отправка сообщений и runtime-исполнение — следующий этап.</p>
    </section>
  </div>;
}
