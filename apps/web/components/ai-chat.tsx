"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Send, Sparkles, Trash2 } from "lucide-react";

type Provider = "openai" | "anthropic" | "gemini";
type Message = { role: "user" | "assistant"; content: string };

const providerLabels: Record<Provider, string> = {
  openai: "OpenAI · GPT",
  anthropic: "Claude",
  gemini: "Gemini",
};

export default function AIChat() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [organizationId, setOrganizationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/bootstrap", { method: "POST", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить рабочее пространство.");
        if (active) setOrganizationId(data.organizationId);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Ошибка инициализации.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || !organizationId || busy) return;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, organizationId, messages: next.slice(-20) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось получить ответ.");
      setModel(data.model ?? "");
      setMessages([...next, { role: "assistant", content: data.answer }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка AI Gateway.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel chat-panel">
    <div className="panel-head">
      <div><h2>AI Assistant</h2><p>Единый чат через серверный AI Gateway. API-ключи остаются на сервере.</p></div>
      <select value={provider} disabled={busy} onChange={(event) => { setProvider(event.target.value as Provider); setModel(""); }}>
        <option value="openai">OpenAI · GPT</option>
        <option value="anthropic">Claude</option>
        <option value="gemini">Gemini</option>
      </select>
    </div>
    <div className="chat-toolbar">
      <span className="chat-provider-status"><span/> {providerLabels[provider]} {model ? `· ${model}` : "· готов к запросу"}</span>
      <button className="text-button" disabled={!messages.length || busy} onClick={() => { setMessages([]); setError(""); setModel(""); }}><Trash2 size={14}/> Очистить</button>
    </div>
    <div className="chat-messages" ref={listRef}>
      {messages.length === 0 ? <div className="empty-state"><Sparkles size={26}/><b>Начни диалог с AI</b><span>Выбери модель и отправь сообщение. Для работы нужен активный API credential в разделе «Интеграции».</span></div> :
        messages.map((message, index) => <div className={message.role === "user" ? "bubble user" : "bubble"} key={index}><small>{message.role === "user" ? "Вы" : providerLabels[provider]}</small><p>{message.content}</p></div>)}
      {busy && <div className="bubble"><small>{providerLabels[provider]}</small><p className="typing"><LoaderCircle className="spin" size={14}/> Генерирую ответ…</p></div>}
    </div>
    {error && <div className="integration-alert error chat-error">{error}</div>}
    <form className="chat-compose" onSubmit={sendMessage}>
      <input value={input} onChange={(event) => setInput(event.target.value)} disabled={busy || !organizationId} placeholder={organizationId ? "Напиши сообщение..." : "Загрузка рабочего пространства…"} maxLength={12000}/>
      <button className="primary icon-button" type="submit" disabled={busy || !input.trim() || !organizationId} aria-label="Отправить">{busy ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>}</button>
    </form>
  </section>;
}
