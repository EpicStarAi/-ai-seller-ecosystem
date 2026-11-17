"use client";
import { useEffect, useState } from "react";
import { Bot, Plus, Save, Trash2, X, Play, History, RefreshCw } from "lucide-react";

type Agent = { id: string; name: string; status: string; version?: number; definition: { role?: string; provider?: string; model?: string; instructions?: string } };
type Run = { id: string; status: string; created_at: string; version: number; usage?: { provider?: string }; result?: { answer?: string; error?: string } };
const providers = [
  { value: "ollama", label: "Ollama · Qwen 3.5 9B", model: "qwen3.5:9b" },
  { value: "openai", label: "OpenAI", model: "gpt-6-astra" },
  { value: "anthropic", label: "Claude", model: "claude-sonnet-5-5" },
  { value: "gemini", label: "Google Gemini", model: "gemini-3.8-flash" }
];

export default function AgentStudio() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [task, setTask] = useState("Составь краткий план работы на основе своей роли.");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("qwen3.5:9b");
  const [instructions, setInstructions] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/agents", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setAgents(d.agents || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function loadRuns(agentId: string) {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/agents/" + agentId + "/runs", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRuns(d.runs || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка истории запусков"); }
    finally { setHistoryLoading(false); }
  }

  function edit(a: Agent | null) {
    setSelected(a);
    setModalOpen(true);
    setName(a?.name || "");
    setRole(a?.definition.role || "");
    setProvider(a?.definition.provider || "ollama");
    setModel(a?.definition.model || "qwen3.5:9b");
    setInstructions(a?.definition.instructions || "");
    setTask("Составь краткий план работы на основе своей роли.");
    setResult("");
    setRuns([]);
    setError("");
    if (a) void loadRuns(a.id);
  }

  async function save() {
    if (!name.trim() || !role.trim() || !instructions.trim()) {
      setError("Заполните название, роль и системную инструкцию.");
      return;
    }
    setSaving(true); setError("");
    try {
      const r = await fetch(selected ? "/api/agents/" + selected.id : "/api/agents", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, definition: { role, provider, model, instructions } })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setSelected(d.agent);
      setRuns([]);
      setResult("");
      setError("");
      if (d.agent?.id) await loadRuns(d.agent.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  async function remove(a: Agent) {
    if (!window.confirm("Удалить агента «" + a.name + "» и его версии и историю запусков?")) return;
    try {
      const r = await fetch("/api/agents/" + a.id, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (selected?.id === a.id) { setSelected(null); setModalOpen(false); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления"); }
  }

  async function run() {
    if (!selected) return;
    if (!task.trim()) { setError("Введите задачу для агента."); return; }
    setRunning(true); setError(""); setResult("");
    let organizationId = "";
    try {
      const bootResponse = await fetch("/api/bootstrap", { method: "POST" });
      const boot = await bootResponse.json();
      if (!bootResponse.ok || !boot.organizationId) throw Error(boot.error || "Не найдено рабочее пространство.");
      organizationId = boot.organizationId;
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, model, organizationId,
          systemPrompt: "Роль: " + role + "\n" + instructions,
          messages: [{ role: "user", content: task.trim() }]
        })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Ошибка AI Gateway");
      setResult(d.answer || "");
      const log = await fetch("/api/agents/" + selected.id + "/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "succeeded", provider, result: { answer: d.answer || "" } })
      });
      if (!log.ok) setError("Ответ получен, но запись истории запуска не сохранилась.");
      await loadRuns(selected.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ошибка запуска";
      setError(message);
      if (selected?.id) {
        await fetch("/api/agents/" + selected.id + "/runs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "failed", provider, result: { error: message } })
        }).catch(() => undefined);
        await loadRuns(selected.id);
      }
    } finally { setRunning(false); }
  }

  return <section className="panel">
    <div className="panel-head"><div><h2>AI Agent Studio</h2><p>Создание, версионирование, тестовый запуск и история · Ollama, OpenAI, Claude, Gemini</p></div><button className="primary" onClick={() => edit(null)}><Plus size={16}/> Создать агента</button></div>
    {error && <p role="alert" style={{ color: "#e58b8b" }}>{error}</p>}
    {loading ? <p>Загрузка…</p> : agents.length === 0 ? <div className="activity-empty"><Bot/>Пока нет агентов. Создайте первого.</div> :
      <div className="agent-grid">{agents.map(a => <article className="agent-card" key={a.id}>
        <div className="agent-icon"><Bot/></div><div className="agent-title"><b>{a.name}</b><span className="pill muted">{a.status === "active" ? "Активен" : "Черновик"}</span></div>
        <p>{a.definition.role || "Роль не задана"}</p><div className="card-foot"><span>v{a.version || 1} · {a.definition.provider} · {a.definition.model}</span><button className="text-button" onClick={() => edit(a)}>Настроить</button><button className="text-button" onClick={() => void remove(a)} aria-label="Удалить"><Trash2 size={14}/></button></div>
      </article>)}</div>}
    {modalOpen && <div className="modal-backdrop"><div className="modal agent-modal" role="dialog" aria-modal="true">
      <div className="modal-head"><h3>{selected ? "Настройка агента" : "Новый AI-агент"}</h3><button onClick={() => setModalOpen(false)} aria-label="Закрыть"><X size={18}/></button></div>
      <label>Название<input value={name} maxLength={100} onChange={e => setName(e.target.value)}/></label>
      <label>Роль<input value={role} maxLength={160} onChange={e => setRole(e.target.value)}/></label>
      <label>Провайдер<select value={provider} onChange={e => { const p = providers.find(x => x.value === e.target.value)!; setProvider(p.value); setModel(p.model); }}>{providers.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <label>Модель API<input value={model} maxLength={100} onChange={e => setModel(e.target.value)} /><small>Модель передаётся в AI Gateway. Доступность зависит от ключа и тарифа провайдера.</small></label>
      <label>Системная инструкция<textarea rows={5} maxLength={12000} value={instructions} onChange={e => setInstructions(e.target.value)}/></label>
      <button className="primary full" disabled={saving} onClick={() => void save()}><Save size={15}/>{saving ? "Сохранение…" : "Сохранить конфигурацию"}</button>
      {selected && <div className="agent-run-area">
        <h3>Тестовый запуск</h3><label>Задача<textarea rows={3} maxLength={12000} value={task} onChange={e => setTask(e.target.value)}/></label>
        <button className="secondary full" disabled={running} onClick={() => void run()}><Play size={15}/>{running ? "Выполняется…" : "Запустить агента"}</button>
        {result && <pre className="agent-result">{result}</pre>}
        <div className="agent-history-head"><h3><History size={15}/> История запусков</h3><button className="text-button" disabled={historyLoading} onClick={() => selected && void loadRuns(selected.id)}><RefreshCw size={13}/> Обновить</button></div>
        {historyLoading ? <small>Загрузка истории…</small> : runs.length === 0 ? <small>Запусков пока нет.</small> : <div className="agent-runs">{runs.map(run => <div className="agent-run-row" key={run.id}><span className={run.status === "succeeded" ? "health-dot good" : "health-dot"}/><span>{run.status === "succeeded" ? "Успешно" : "Ошибка"} · v{run.version}</span><small>{new Date(run.created_at).toLocaleString()}</small></div>)}</div>}
      </div>}
    </div></div>}
  </section>;
}
