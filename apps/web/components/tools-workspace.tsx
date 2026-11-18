"use client";

import { useMemo, useState } from "react";
import { Link2, Calculator, Send, Copy, Check, ExternalLink } from "lucide-react";

type ToolTab = "utm" | "metrics" | "telegram";
const inputClass = "tool-input";

export default function ToolsWorkspace() {
  const [tab, setTab] = useState<ToolTab>("utm");
  const [copied, setCopied] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://example.com/");
  const [source, setSource] = useState("telegram");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [target, setTarget] = useState("https://t.me/");
  const [tgText, setTgText] = useState("");
  const [clicks, setClicks] = useState("1000");
  const [impressions, setImpressions] = useState("25000");
  const [spend, setSpend] = useState("100");
  const [leads, setLeads] = useState("40");
  const [sales, setSales] = useState("8");
  const [revenue, setRevenue] = useState("600");

  const utmUrl = useMemo(() => {
    try {
      const u = new URL(baseUrl);
      const params: Record<string,string> = { utm_source: source, utm_medium: medium };
      if (campaign.trim()) params.utm_campaign = campaign.trim();
      if (content.trim()) params.utm_content = content.trim();
      if (term.trim()) params.utm_term = term.trim();
      Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
      return u.toString();
    } catch { return "Введите корректный URL с http:// или https://"; }
  }, [baseUrl, source, medium, campaign, content, term]);

  const n = (v: string) => Math.max(0, Number(v) || 0);
  const ctr = n(impressions) ? n(clicks) / n(impressions) * 100 : 0;
  const cpm = n(impressions) ? n(spend) / n(impressions) * 1000 : 0;
  const cpl = n(leads) ? n(spend) / n(leads) : 0;
  const cr = n(clicks) ? n(leads) / n(clicks) * 100 : 0;
  const cpa = n(sales) ? n(spend) / n(sales) : 0;
  const aov = n(sales) ? n(revenue) / n(sales) : 0;
  const roi = n(spend) ? (n(revenue) - n(spend)) / n(spend) * 100 : 0;

  async function copy(value: string, key: string) {
    if (!value || value.startsWith("Введите")) return;
    try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(""), 1600); } catch { setCopied(""); }
  }
  const copyButton = (value: string, key: string) => <button className="tool-copy" onClick={() => copy(value,key)}>{copied === key ? <Check size={14}/> : <Copy size={14}/>} {copied === key ? "Скопировано" : "Копировать"}</button>;

  return <section className="panel tools-workspace">
    <div className="tools-tabs">
      <button className={tab === "utm" ? "tools-tab active" : "tools-tab"} onClick={() => setTab("utm")}><Link2 size={16}/> UTM-метки</button>
      <button className={tab === "metrics" ? "tools-tab active" : "tools-tab"} onClick={() => setTab("metrics")}><Calculator size={16}/> Маркетинг-калькулятор</button>
      <button className={tab === "telegram" ? "tools-tab active" : "tools-tab"} onClick={() => setTab("telegram")}><Send size={16}/> Telegram-ссылки</button>
    </div>

    {tab === "utm" && <div className="tools-layout">
      <div className="tools-form">
        <div className="tool-section-title"><h2>Генератор UTM-меток</h2><p>Формирует ссылку для отслеживания источников трафика.</p></div>
        <label>Целевая ссылка<input className={inputClass} value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://example.com/page"/></label>
        <div className="tools-two">
          <label>Источник · utm_source<input className={inputClass} value={source} onChange={e=>setSource(e.target.value)} placeholder="telegram"/></label>
          <label>Канал · utm_medium<input className={inputClass} value={medium} onChange={e=>setMedium(e.target.value)} placeholder="social"/></label>
        </div>
        <label>Кампания · utm_campaign<input className={inputClass} value={campaign} onChange={e=>setCampaign(e.target.value)} placeholder="launch_november"/></label>
        <div className="tools-two">
          <label>Контент · utm_content<input className={inputClass} value={content} onChange={e=>setContent(e.target.value)} placeholder="post_01"/></label>
          <label>Ключевое слово · utm_term<input className={inputClass} value={term} onChange={e=>setTerm(e.target.value)} placeholder="optional"/></label>
        </div>
      </div>
      <div className="tool-result"><span className="tool-kicker">ГОТОВАЯ ССЫЛКА</span><div className="tool-output">{utmUrl}</div>{copyButton(utmUrl,"utm")}<p>Параметры добавляются локально в браузере. Данные не отправляются на сервер.</p></div>
    </div>}

    {tab === "metrics" && <div className="tools-layout">
      <div className="tools-form">
        <div className="tool-section-title"><h2>Калькулятор рекламных метрик</h2><p>Введите данные кампании — показатели пересчитываются автоматически.</p></div>
        <div className="tools-two">
          <label>Показы<input className={inputClass} type="number" min="0" value={impressions} onChange={e=>setImpressions(e.target.value)}/></label>
          <label>Клики<input className={inputClass} type="number" min="0" value={clicks} onChange={e=>setClicks(e.target.value)}/></label>
          <label>Расход<input className={inputClass} type="number" min="0" value={spend} onChange={e=>setSpend(e.target.value)}/></label>
          <label>Лиды<input className={inputClass} type="number" min="0" value={leads} onChange={e=>setLeads(e.target.value)}/></label>
          <label>Продажи<input className={inputClass} type="number" min="0" value={sales} onChange={e=>setSales(e.target.value)}/></label>
          <label>Выручка<input className={inputClass} type="number" min="0" value={revenue} onChange={e=>setRevenue(e.target.value)}/></label>
        </div>
      </div>
      <div className="tool-results-grid">
        <Metric label="CTR" value={ctr.toFixed(2)+"%"} note="Клики / показы"/>
        <Metric label="CPM" value={cpm.toFixed(2)} note="Расход / 1000 показов"/>
        <Metric label="CPL" value={cpl.toFixed(2)} note="Расход / лиды"/>
        <Metric label="CR" value={cr.toFixed(2)+"%"} note="Лиды / клики"/>
        <Metric label="CPA" value={cpa.toFixed(2)} note="Расход / продажи"/>
        <Metric label="AOV" value={aov.toFixed(2)} note="Выручка / продажи"/>
        <Metric label="ROI" value={roi.toFixed(2)+"%"} note="(Выручка − расход) / расход"/>
      </div>
    </div>}

    {tab === "telegram" && <div className="tools-layout">
      <div className="tools-form">
        <div className="tool-section-title"><h2>Конструктор Telegram-ссылок</h2><p>Создаёт deep link на публичный канал, профиль или бота.</p></div>
        <label>Ссылка или username<input className={inputClass} value={target} onChange={e=>setTarget(e.target.value)} placeholder="@channel или https://t.me/channel"/></label>
        <label>Текст для предварительного сообщения (опционально)<input className={inputClass} value={tgText} onChange={e=>setTgText(e.target.value)} placeholder="Здравствуйте! Хочу узнать подробнее"/></label>
        <div className="tool-hint">Для бота можно использовать ссылку вида https://t.me/bot_username?start=campaign_id. Параметр start должен соответствовать логике самого бота.</div>
      </div>
      <div className="tool-result"><span className="tool-kicker">ССЫЛКА TELEGRAM</span><div className="tool-output">{buildTelegramLink(target,tgText)}</div>{copyButton(buildTelegramLink(target,tgText),"telegram")}<a className="tool-open" href={buildTelegramLink(target,tgText)} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Открыть ссылку</a><p>Генератор не определяет приватные chat_id и не обходит настройки доступа Telegram.</p></div>
    </div>}
  </section>;
}

function Metric({label,value,note}:{label:string;value:string;note:string}) {
  return <div className="tool-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function buildTelegramLink(raw:string,text:string) {
  const value = raw.trim();
  if (!value) return "Укажите Telegram username или ссылку";
  let url = value.startsWith("@") ? "https://t.me/"+value.slice(1) : value.startsWith("http") ? value : "https://t.me/"+value.replace(/^\//,"");
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "t.me" && parsed.hostname !== "telegram.me") return "Используйте ссылку t.me или username";
    if (text.trim()) parsed.searchParams.set("text",text.trim());
    return parsed.toString();
  } catch { return "Некорректная ссылка"; }
}
