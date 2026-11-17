"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, PlugZap, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";

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
  { id: "telegram", name: "Telegram Bot API", description: "Подключение бота, входящие сообщения и отправка ответов.", placeholder: "123456789:AA...", help: "Токен бота из @BotFather. Это не пароль от личного Telegram-аккаунта." },
  { id: "openai", name: "OpenAI API · GPT", description: "Доступ к моделям OpenAI через API.", placeholder: "sk-...", help: "Нужен API key с platform.openai.com. Подписка ChatGPT Plus/Pro не включает API-баланс." },
  { id: "anthropic", name: "Anthropic Claude", description: "Claude Sonnet, Opus и Haiku через Anthropic API.", placeholder: "sk-ant-...", help: "API key из Anthropic Console. Ключ хранится зашифрованным на сервере." },
  { id: "gemini", name: "Google Gemini", description: "Доступ к моделям Gemini API.", placeholder: "AIza...", help: "API key из Google AI Studio. Ключ хранится зашифрованным на сервере." },
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
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refresh]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!selected || !secret.trim() || !organizationId) return;
    setBusy(selected);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selected, secret: secret.trim(), label: label.trim(), organizationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось подключить провайдера.");
      setSecret("");
      setLabel("");
      setSelected(null);
      await refresh(organizationId);
      setNotice("Подключение проверено и сохранено.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка подключения.");
    } finally {
      setBusy(null);
    }
  }

  async function test(provider: Provider) {
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/${provider}/test?organizationId=${encodeURIComponent(organizationId)}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Проверка не прошла.");
      await refresh(organizationId);
      setNotice(`${providers.find((p) => p.id === provider)?.name}: соединение работает.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка проверки.");
      await refresh(organizationId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: Provider) {
    if (!window.confirm("Отключить интеграцию и удалить сохранённый credential?")) return;
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/${provider}?organizationId=${encodeURIComponent(organizationId)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Не удалось отключить интеграцию.");
      }
      await refresh(organizationId);
      setNotice("Интеграция отключена, сохранённый credential удалён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отключения.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={22}/> Инициализация личного рабочего пространства и загрузка интеграций…</section>;

  return <section className="panel">
    <div className="panel-head">
      <div><h2>Подключения сервисов</h2><p>Реальные проверки credentials через сервер. Секреты не передаются в браузер повторно и не выводятся в интерфейсе.</p></div>
      <span className="pill muted">{integrations.length} подключено</span>
    </div>
    {error && <div className="integration-alert error"><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть"><X size={14}/></button></div>}
    {notice && <div className="integration-alert success"><Check size={16}/><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Закрыть"><X size={14}/></button></div>}
    {selected && <form id="integration-connect-form" className="integration-connect-form" onSubmit={connect}>
      <div className="panel-head">
        <div><h3>Подключить {providers.find((p) => p.id === selected)?.name}</h3><p>{providers.find((p) => p.id === selected)?.help}</p></div>
        <button type="button" className="text-button" onClick={() => { setSelected(null); setSecret(""); }}><X size={16}/> Закрыть</button>
      </div>
      <label>API key / bot token
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} required placeholder={providers.find((p) => p.id === selected)?.placeholder}/>
      </label>
      <label>Название подключения (необязательно)
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Например, основной аккаунт"/>
      </label>
      <div className="integration-security"><ShieldCheck size={16}/> Credential будет зашифрован AES-256-GCM и сохранён на сервере. Он не попадёт в GitHub или клиентский JavaScript.</div>
      <button className="primary" type="submit" disabled={!secret.trim() || !!busy}>{busy === selected ? <><LoaderCircle className="spin" size={15}/> Проверяем и сохраняем…</> : "Проверить и подключить"}</button>
    </form>}
    <div className="integration-grid">
      {providers.map((provider) => {
        const connected = integrations.find((item) => item.kind === provider.id);
        const isBusy = busy === provider.id;
        return <article className="integration-card" key={provider.id}>
          <div className="integration-mark"><PlugZap size={20}/></div>
          <b>{provider.name}</b>
          <p>{provider.description}</p>
          <span className={connected?.status === "connected" ? "pill success" : connected?.status === "error" ? "pill warning" : "pill muted"}>
            {connected?.status === "connected" ? "Подключено" : connected?.status === "error" ? "Ошибка проверки" : "Не подключено"}
          </span>
          {connected?.label && <small>{connected.label}</small>}
          {connected?.last_tested_at && <small>Проверено: {new Date(connected.last_tested_at).toLocaleString("ru-RU")}</small>}
          {connected ? <div className="integration-actions">
            <button className="secondary" disabled={isBusy} onClick={() => test(provider.id)}>{isBusy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>} Проверить</button>
            <button className="text-button danger" disabled={isBusy} onClick={() => disconnect(provider.id)}><Trash2 size={14}/> Отключить</button>
          </div> : <button className="secondary" disabled={!!busy} onClick={() => { setSelected(provider.id); setSecret(""); setLabel(""); setError(""); }}>{isBusy ? "Подключение…" : "Подключить"}</button>}
        </article>;
      })}
    </div>

  </section>;
}
