"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, PlugZap, RefreshCw, ShieldCheck, Trash2, X, Plus } from "lucide-react";

type Provider = "telegram" | "openai" | "anthropic" | "gemini";
type Integration = {
  id: string;
  kind: Provider;
  label: string | null;
  status: string;
  external_account_id: string | null;
  metadata: Record<string, unknown> | null;
  last_tested_at: string | null;
};
const providers: { id: Provider; name: string; description: string; placeholder: string; help: string }[] = [
  { id: "telegram", name: "Telegram Bot API", description: "Несколько ботов для разных каналов и потоков автопостинга.", placeholder: "123456789:AA...", help: "Токен отдельного бота из @BotFather. Он проверяется и сохраняется зашифрованным." },
  { id: "openai", name: "OpenAI API · GPT", description: "Доступ к моделям OpenAI через API.", placeholder: "sk-...", help: "API key из platform.openai.com." },
  { id: "anthropic", name: "Anthropic Claude", description: "Claude через Anthropic API.", placeholder: "sk-ant-...", help: "API key из Anthropic Console." },
  { id: "gemini", name: "Google Gemini", description: "Доступ к моделям Gemini API.", placeholder: "AIza...", help: "API key из Google AI Studio." },
];

export default function IntegrationsPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/integrations?organizationId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить интеграции.");
    setIntegrations(result.integrations ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const bootstrap = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const data = await bootstrap.json();
        if (!bootstrap.ok) throw new Error(data.error ?? "Не удалось инициализировать рабочее пространство.");
        if (!active) return;
        setOrganizationId(data.organizationId);
        await refresh(data.organizationId);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!selected || !secret.trim() || !organizationId) return;
    setBusy("connect"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selected, secret: secret.trim(), label: label.trim(), organizationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось подключить провайдера.");
      setSecret(""); setLabel(""); setSelected(null);
      await refresh(organizationId);
      setNotice(selected === "telegram" ? "Telegram-бот проверен и добавлен. Другие боты не затронуты." : "Подключение проверено и сохранено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка подключения."); }
    finally { setBusy(null); }
  }

  async function test(item: Integration) {
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/integrations/${item.kind}/test?organizationId=${encodeURIComponent(organizationId)}&integrationId=${encodeURIComponent(item.id)}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Проверка не прошла.");
      await refresh(organizationId);
      setNotice(`${item.label || providers.find(p => p.id === item.kind)?.name}: соединение работает.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки."); await refresh(organizationId).catch(() => undefined); }
    finally { setBusy(null); }
  }

  async function disconnect(item: Integration) {
    if (!window.confirm(`Отключить «${item.label || item.kind}»? Связанные с Telegram-ботом каналы защищены от случайного удаления.`)) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/integrations/${item.kind}?organizationId=${encodeURIComponent(organizationId)}&integrationId=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? "Не удалось отключить интеграцию."); }
      await refresh(organizationId); setNotice("Интеграция отключена.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка отключения."); }
    finally { setBusy(null); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={22}/> Загрузка интеграций…</section>;

  const telegram = integrations.filter(item => item.kind === "telegram");
  const providerItem = (kind: Provider) => integrations.find(item => item.kind === kind);
  const identity = (item: Integration) => {
    const username = typeof item.metadata?.username === "string" ? item.metadata.username : "";
    return username ? `@${username.replace(/^@/, "")}` : item.external_account_id ? `ID ${item.external_account_id}` : item.label || "Telegram bot";
  };
  const renderItem = (item: Integration) => <article className="integration-card" key={item.id}>
    <div className="integration-mark"><PlugZap size={20}/></div>
    <b>{item.label || providers.find(p => p.id === item.kind)?.name}</b>
    {item.kind === "telegram" && <small>{identity(item)}</small>}
    <span className={item.status === "connected" ? "pill success" : item.status === "error" ? "pill warning" : "pill muted"}>{item.status === "connected" ? "Подключено" : item.status === "error" ? "Ошибка" : item.status}</span>
    {item.last_tested_at && <small>Проверено: {new Date(item.last_tested_at).toLocaleString("ru-RU")}</small>}
    <div className="integration-actions">
      <button className="secondary" disabled={!!busy} onClick={() => test(item)}>{busy === item.id ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>} Проверить</button>
      <button className="text-button danger" disabled={!!busy} onClick={() => disconnect(item)}><Trash2 size={14}/> Отключить</button>
    </div>
  </article>;

  return <section className="panel">
    <div className="panel-head">
      <div><h2>Подключения сервисов</h2><p>Telegram поддерживает несколько ботов в одном рабочем пространстве. Каждый канал будет закреплён за выбранным ботом.</p></div>
      <span className="pill muted">{integrations.length} подключений</span>
    </div>
    {error && <div className="integration-alert error"><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть"><X size={14}/></button></div>}
    {notice && <div className="integration-alert success"><Check size={16}/><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Закрыть"><X size={14}/></button></div>}
    {selected && <form className="integration-connect-form" onSubmit={connect}>
      <div className="panel-head"><div><h3>Подключить {providers.find(p => p.id === selected)?.name}</h3><p>{providers.find(p => p.id === selected)?.help}</p></div>
        <button type="button" className="text-button" onClick={() => { setSelected(null); setSecret(""); }}><X size={16}/> Закрыть</button>
      </div>
      <label>API key / bot token<input type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} required placeholder={providers.find(p => p.id === selected)?.placeholder}/></label>
      <label>Название подключения<input value={label} onChange={e => setLabel(e.target.value)} maxLength={120} placeholder={selected === "telegram" ? "Например, Ai Seller Bot" : "Основной аккаунт"}/></label>
      <div className="integration-security"><ShieldCheck size={16}/> Credential передаётся только серверному API и хранится зашифрованным. Не отправляйте токен в чат.</div>
      <button className="primary" type="submit" disabled={!secret.trim() || !!busy}>{busy === "connect" ? <><LoaderCircle className="spin" size={15}/> Проверяем…</> : "Проверить и подключить"}</button>
    </form>}
    <div className="panel-head" style={{ marginTop: 18 }}><div><h3>Telegram-боты</h3><p>{telegram.length} подключено. Существующие боты остаются независимыми.</p></div>
      <button className="secondary" disabled={!!busy} onClick={() => { setSelected("telegram"); setSecret(""); setLabel(""); setError(""); }}><Plus size={14}/> Добавить бота</button>
    </div>
    {telegram.length ? <div className="integration-grid">{telegram.map(renderItem)}</div> : <div className="activity-empty">Telegram-боты ещё не подключены.</div>}
    <div className="panel-head" style={{ marginTop: 24 }}><div><h3>AI-провайдеры</h3></div></div>
    <div className="integration-grid">
      {(["openai", "anthropic", "gemini"] as Provider[]).map(kind => {
        const item = providerItem(kind);
        const provider = providers.find(p => p.id === kind)!;
        return item ? renderItem(item) : <article className="integration-card" key={kind}>
          <div className="integration-mark"><PlugZap size={20}/></div><b>{provider.name}</b><p>{provider.description}</p>
          <button className="secondary" disabled={!!busy} onClick={() => { setSelected(kind); setSecret(""); setLabel(""); setError(""); }}>Подключить</button>
        </article>;
      })}
    </div>
  </section>;
}
