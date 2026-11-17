"use client";

import { useMemo, useState } from "react";
import IntegrationsPanel from "@/components/integrations-panel";
import {
  Activity, Bot, Boxes, BrainCircuit, ChartNoAxesCombined, Check, ChevronDown,
  ChevronRight, CircleHelp, Command, ContactRound, CreditCard, FileText, GitBranch,
  LayoutDashboard, Menu, MessageCircle, Plus, Search, Send, Settings, ShieldCheck,
  Sparkles, Workflow, X, Zap, LogOut
} from "lucide-react";

type Section = "Обзор" | "AI Assistant" | "AI Agent Studio" | "Telegram Workspace" | "Воронки" | "Кампании" | "Контент-студия" | "CRM" | "Автоматизация" | "Интеграции" | "Использование" | "Настройки";

const nav: { group: string; items: { label: Section; icon: typeof LayoutDashboard }[] }[] = [
  { group: "РАБОЧЕЕ ПРОСТРАНСТВО", items: [
    { label: "Обзор", icon: LayoutDashboard }, { label: "AI Assistant", icon: BrainCircuit },
    { label: "AI Agent Studio", icon: Bot }, { label: "Telegram Workspace", icon: MessageCircle }
  ]},
  { group: "ПРОДАЖИ И МАРКЕТИНГ", items: [
    { label: "Воронки", icon: GitBranch }, { label: "Кампании", icon: Send },
    { label: "Контент-студия", icon: FileText }, { label: "CRM", icon: ContactRound }
  ]},
  { group: "СИСТЕМА", items: [
    { label: "Автоматизация", icon: Workflow }, { label: "Интеграции", icon: Boxes },
    { label: "Использование", icon: ChartNoAxesCombined }, { label: "Настройки", icon: Settings }
  ]}
];

const descriptions: Record<Section, string> = {
  "Обзор": "Сводка по рабочему пространству и быстрый доступ к инструментам.",
  "AI Assistant": "Единая точка работы с несколькими AI-провайдерами.",
  "AI Agent Studio": "Создавай специализированных агентов и управляй их конфигурациями.",
  "Telegram Workspace": "Подключение ботов, входящие сообщения и рабочие диалоги.",
  "Воронки": "Визуальная схема сценариев привлечения и обработки лидов.",
  "Кампании": "Планирование коммуникаций для согласованных аудиторий.",
  "Контент-студия": "Черновики текстов, идеи и контент-план.",
  "CRM": "Контакты, статусы лидов и история взаимодействий.",
  "Автоматизация": "Управление событиями и фоновыми процессами.",
  "Интеграции": "Подключение внешних сервисов и провайдеров.",
  "Использование": "Контроль активности и будущего учёта AI-расходов.",
  "Настройки": "Параметры профиля и рабочего пространства."
};

const initialAgents = [
  { name: "Lead Researcher", role: "Исследование и квалификация лидов", model: "OpenAI", status: "Черновик" },
  { name: "Content Strategist", role: "Контент и маркетинговые идеи", model: "Claude", status: "Черновик" },
  { name: "Sales Assistant", role: "Помощь в обработке обращений", model: "Gemini", status: "Черновик" }
];

export default function Home() {
  const [active, setActive] = useState<Section>("Обзор");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState(initialAgents);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("");
  const [provider, setProvider] = useState("OpenAI");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ from: string; text: string }[]>([]);
  const [enabledFlows, setEnabledFlows] = useState([true, false, true]);
  const [contacts, setContacts] = useState(["Alex Morgan", "Elena Petrova", "Mark Wilson"]);
  const [newContact, setNewContact] = useState("");
  const [showContactForm, setShowContactForm] = useState(false);
  const [notice, setNotice] = useState("Интеграции и авторизация сохраняются в Supabase. Остальные модули подключаются поэтапно.");

  const filteredContacts = useMemo(() => contacts.filter((name) => name.toLowerCase().includes(query.toLowerCase())), [contacts, query]);

  function sendMessage() {
    if (!message.trim()) return;
    setMessages((old) => [...old, { from: "Вы", text: message.trim() }, { from: "Демо-режим", text: "Интерфейс чата готов. Для реального ответа подключим AI Gateway и ключ выбранного провайдера." }]);
    setMessage("");
  }

  function addAgent() {
    if (!agentName.trim()) return;
    setAgents((old) => [...old, { name: agentName.trim(), role: agentRole.trim() || "Новая роль", model: provider, status: "Черновик" }]);
    setAgentName(""); setAgentRole(""); setShowAgentForm(false);
    setNotice("Агент добавлен в демонстрационный список.");
  }

  function addContact() {
    if (!newContact.trim()) return;
    setContacts((old) => [...old, newContact.trim()]);
    setNewContact(""); setShowContactForm(false);
    setNotice("Контакт добавлен в демонстрационный список.");
  }

  function content() {
    if (active === "Обзор") return <Dashboard setActive={setActive} agents={agents.length} />;
    if (active === "AI Assistant") return <section className="panel chat-panel"><div className="panel-head"><div><h2>AI Assistant</h2><p>Проверь пользовательский сценарий до подключения провайдеров.</p></div><select value={provider} onChange={(e) => setProvider(e.target.value)}><option>OpenAI</option><option>Claude</option><option>Gemini</option></select></div><div className="chat-messages">{messages.length === 0 ? <div className="empty-state"><Sparkles size={26}/><b>Начни диалог с AI</b><span>Ответы сейчас имитируются. API-ключи ещё не подключены.</span></div> : messages.map((m, i) => <div className={m.from === "Вы" ? "bubble user" : "bubble"} key={i}><small>{m.from}</small><p>{m.text}</p></div>)}</div><div className="chat-compose"><input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Напиши сообщение..."/><button className="primary icon-button" onClick={sendMessage} aria-label="Отправить"><Send size={17}/></button></div></section>;
    if (active === "AI Agent Studio") return <section className="panel"><div className="panel-head"><div><h2>AI Agent Studio</h2><p>Конфигурации агентов. Реальное выполнение подключим через Backend.</p></div><button className="primary" onClick={() => setShowAgentForm(true)}><Plus size={16}/> Создать агента</button></div><div className="agent-grid">{agents.map((a, i) => <article className="agent-card" key={a.name + i}><div className="agent-icon"><Bot/></div><div className="agent-title"><b>{a.name}</b><span className="pill muted">{a.status}</span></div><p>{a.role}</p><div className="card-foot"><span>{a.model}</span><button className="text-button" onClick={() => setNotice("Редактирование агента будет подключено в следующем этапе.")}>Настроить <ChevronRight size={14}/></button></div></article>)}</div>{showAgentForm && <Modal title="Новый AI-агент" onClose={() => setShowAgentForm(false)}><label>Название<input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Например, Lead Qualifier"/></label><label>Роль<input value={agentRole} onChange={(e) => setAgentRole(e.target.value)} placeholder="Что должен делать агент?"/></label><label>AI-провайдер<select value={provider} onChange={(e) => setProvider(e.target.value)}><option>OpenAI</option><option>Claude</option><option>Gemini</option></select></label><button className="primary full" onClick={addAgent}>Сохранить агента</button></Modal>}</section>;
    if (active === "CRM") return <section className="panel"><div className="panel-head"><div><h2>CRM · Контакты</h2><p>Демонстрационные записи, не реальные клиенты.</p></div><button className="primary" onClick={() => setShowContactForm(true)}><Plus size={16}/> Добавить контакт</button></div><div className="toolbar"><div className="searchbox"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск контактов"/></div><span className="pill muted">{filteredContacts.length} контакта</span></div><div className="contact-list">{filteredContacts.map((name, i) => <div className="contact-row" key={name}><div className="avatar">{name.split(" ").map((x) => x[0]).join("").slice(0,2)}</div><div><b>{name}</b><small>Демо-контакт · статус не задан</small></div><span className="pill muted">Новый</span></div>)}</div>{showContactForm && <Modal title="Добавить контакт" onClose={() => setShowContactForm(false)}><label>Имя или название<input value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Имя контакта"/></label><button className="primary full" onClick={addContact}>Добавить</button></Modal>}</section>;
    if (active === "Автоматизация") return <section className="panel"><div className="panel-head"><div><h2>Автоматизация</h2><p>Переключатели демонстрационные: процессы не запускаются.</p></div><span className="pill warning">Demo</span></div><div className="flow-list">{["Новый лид → уведомление","Новый диалог → классификация","Еженедельный отчёт"].map((name, i) => <div className="flow-row" key={name}><div className="flow-symbol"><Workflow size={18}/></div><div className="flow-name"><b>{name}</b><small>Локальный макет workflow</small></div><button className={enabledFlows[i] ? "toggle on" : "toggle"} onClick={() => setEnabledFlows((old) => old.map((v, j) => j === i ? !v : v))}>{enabledFlows[i] ? "Вкл." : "Выкл."}</button></div>)}</div></section>;
    if (active === "Интеграции") return <IntegrationsPanel />;
    if (active === "Воронки") return <section className="panel"><div className="panel-head"><div><h2>Конструктор воронок</h2><p>Черновая визуальная схема сценария.</p></div><span className="pill warning">Макет</span></div><div className="funnel-canvas">{["Триггер: новое обращение","AI: определить намерение","Условие: квалифицирован?","Действие: передать оператору"].map((x, i) => <div className="funnel-step" key={x}><span>{String(i + 1).padStart(2,"0")}</span><b>{x}</b>{i < 3 && <ChevronDown size={17}/>}</div>)}</div><button className="secondary" onClick={() => setNotice("Редактор узлов и сохранение схем будут следующим этапом.")}><Plus size={15}/> Добавить шаг</button></section>;
    if (active === "Telegram Workspace") return <Placeholder icon={MessageCircle} title="Telegram Workspace" text="Подключение Telegram Bot API, приём webhook-событий и inbox диалогов." status="Бот не подключён"/>;
    if (active === "Кампании") return <Placeholder icon={Send} title="Кампании" text="Планирование сообщений для пользователей, давших согласие на коммуникацию." status="Нет активных кампаний"/>;
    if (active === "Контент-студия") return <Placeholder icon={FileText} title="Контент-студия" text="Черновики публикаций, генерация материалов и контент-календарь." status="Черновиков пока нет"/>;
    if (active === "Использование") return <Placeholder icon={ChartNoAxesCombined} title="Использование ресурсов" text="Здесь появятся запросы к моделям, токены, стоимость и лимиты." status="Учёт расходов ещё не подключён"/>;
    return <Placeholder icon={Settings} title="Настройки" text="Профиль, рабочее пространство, безопасность и управление доступами." status="Локальный демо-профиль"/>;
  }

  return <div className="app-shell">
    <aside className={mobileOpen ? "sidebar open" : "sidebar"}><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><span>AI Seller<span className="brand-light"> Ecosystem</span></span><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18}/></button></div><div className="workspace-switch"><div className="workspace-avatar">E</div><div><b>Personal Workspace</b><small>Личное пространство</small></div><ChevronDown size={15}/></div><nav>{nav.map((group) => <div className="nav-group" key={group.group}><small>{group.group}</small>{group.items.map(({label, icon: Icon}) => <button key={label} className={active === label ? "nav-item active" : "nav-item"} onClick={() => {setActive(label);setMobileOpen(false);}}><Icon size={17}/><span>{label}</span>{label === "AI Agent Studio" && <em>NEW</em>}</button>)}</div>)}</nav><div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={16}/><span><b>Private workspace</b><small>Доступ только владельцу</small></span></div><div className="user-row"><div className="avatar user-avatar">ES</div><div><b>Owner</b><small>Personal account</small></div><Settings size={16}/></div></div></aside>
    {mobileOpen && <button className="scrim" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)}/>}
    <main className="main-area"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Открыть меню"><Menu/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><b>{active}</b></div><div className="top-actions"><div className="system-status"><span/>Система в разработке</div><button className="help-button" onClick={() => setNotice("Это ранняя тестовая сборка. Сообщай об ошибках и неудобствах.")}><CircleHelp size={18}/></button><div className="top-avatar">ES</div><form action="/auth/signout" method="post" className="logout-form"><button type="submit" className="logout-button" aria-label="Выйти" title="Выйти"><LogOut size={16}/></button></form></div></header>
      <div className="page-content"><div className="page-heading"><div><div className="eyebrow">AI SELLER ECOSYSTEM <span>· PERSONAL EDITION</span></div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="heading-actions"><span className="pill warning">MVP · INTEGRATIONS</span></div></div>
      <div className="notice"><Zap size={16}/><span>{notice}</span><button onClick={() => setNotice("Интеграции и авторизация сохраняются в Supabase. Остальные модули подключаются поэтапно.")} aria-label="Сбросить уведомление"><X size={14}/></button></div>
      {content()}
      <footer><span>AI Seller Ecosystem · Personal Workspace</span><span>MVP in progress · Integrations active</span></footer></div>
    </main>
  </div>;
}

function Dashboard({ setActive, agents }: { setActive: (s: Section) => void; agents: number }) {
  return <><div className="stats-grid"><Stat icon={Bot} label="AI-агенты" value={String(agents)} detail="демо-конфигурации"/><Stat icon={ContactRound} label="Контакты CRM" value="3" detail="пример записей"/><Stat icon={Workflow} label="Автоматизации" value="3" detail="локальные сценарии"/><Stat icon={Activity} label="API-интеграции" value="0" detail="ожидают подключения"/></div><div className="dashboard-grid"><section className="panel overview-panel"><div className="panel-head"><div><h2>Быстрый запуск</h2><p>Основные инструменты рабочего пространства.</p></div><span className="pill muted">Getting started</span></div><div className="quick-grid"><Quick icon={BrainCircuit} title="AI Assistant" text="Тестовый чат с выбором модели" onClick={() => setActive("AI Assistant")}/><Quick icon={Bot} title="Создать агента" text="Добавить конфигурацию агента" onClick={() => setActive("AI Agent Studio")}/><Quick icon={GitBranch} title="Собрать воронку" text="Посмотреть сценарий продаж" onClick={() => setActive("Воронки")}/><Quick icon={MessageCircle} title="Telegram" text="Перейти к настройке бота" onClick={() => setActive("Telegram Workspace")}/></div></section><section className="panel health-panel"><div className="panel-head"><div><h2>Состояние системы</h2><p>Фактический статус интеграций.</p></div></div><Health name="Frontend workspace" state="Доступен" good/><Health name="Server API routes" state="Подключены" good/><Health name="Supabase Auth / DB" state="Подключено" good/><Health name="AI Gateway" state="Следующий этап"/><Health name="Telegram Bot API" state="Не подключён"/></section></div><section className="panel activity-panel"><div className="panel-head"><div><h2>Последние действия</h2><p>Локальные действия в текущей сессии.</p></div><span className="pill muted">Session only</span></div><div className="activity-empty"><Activity size={18}/><span>Пока нет событий. Начни с AI Assistant или создай первого агента.</span></div></section></>;
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string; detail: string }) { return <article className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{detail}</small></article>; }
function Quick({ icon: Icon, title, text, onClick }: { icon: typeof Bot; title: string; text: string; onClick: () => void }) { return <button className="quick-card" onClick={onClick}><span className="quick-icon"><Icon size={19}/></span><b>{title}</b><small>{text}</small><ChevronRight size={16}/></button>; }
function Health({ name, state, good = false }: { name: string; state: string; good?: boolean }) { return <div className="health-row"><span className={good ? "health-dot good" : "health-dot"}/><span>{name}</span><small>{state}</small></div>; }
function Placeholder({ icon: Icon, title, text, status }: { icon: typeof Bot; title: string; text: string; status: string }) { return <section className="panel placeholder"><div className="placeholder-icon"><Icon size={25}/></div><h2>{title}</h2><p>{text}</p><span className="pill warning">{status}</span><div className="placeholder-note">Раздел предусмотрен архитектурой продукта. Реальное выполнение появится после подключения API и соответствующего backend-модуля.</div></section>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true"><div className="modal-head"><h3>{title}</h3><button onClick={onClose} aria-label="Закрыть"><X size={18}/></button></div>{children}</div></div>; }