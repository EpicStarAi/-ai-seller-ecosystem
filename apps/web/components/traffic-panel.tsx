"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Copy, Gift, LoaderCircle, Plus, RefreshCw, Trash2, Trophy } from "lucide-react";

type BotRow = { id: string; name: string; telegram_username: string | null; enabled: boolean; traffic_enabled: boolean; traffic_channel: string | null };
type SourceRow = { id: string; tag: string; name: string; invite_link: string | null; deep_link: string | null; users: number; subscribed: number; created_at: string };
type GiveawayRow = { id: string; title: string; prize: string; description: string; status: "draft" | "active" | "finished"; ends_at: string | null; entries: number; created_at: string };
type Leader = { userId: string; name: string; username: string | null; invited: number; subscribed: number };
type Summary = {
  bots: BotRow[];
  bot: (BotRow & { start_link: string | null; example_ref_link: string | null }) | null;
  stats?: { users: number; subscribed: number; referred: number; referredSubscribed: number };
  sources?: SourceRow[];
  giveaways?: GiveawayRow[];
  leaderboard?: Leader[];
};

const statusLabel: Record<GiveawayRow["status"], string> = { draft: "Черновик", active: "Идёт", finished: "Завершён" };

export default function TrafficPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [botId, setBotId] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState({ name: "", tag: "" });
  const [giveaway, setGiveaway] = useState({ title: "", prize: "", description: "", endsAt: "" });

  const refresh = useCallback(async (org: string, bot?: string) => {
    const qs = new URLSearchParams({ organizationId: org });
    if (bot) qs.set("botId", bot);
    const response = await fetch(`/api/traffic?${qs}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Не удалось загрузить данные трафика.");
    setData(json);
    if (json.bot?.id) setBotId(json.bot.id);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/bootstrap", { method: "POST", cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Не удалось определить рабочее пространство.");
        if (!active) return;
        setOrganizationId(json.organizationId);
        await refresh(json.organizationId);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refresh]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch(`/api/traffic?organizationId=${encodeURIComponent(organizationId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botId, ...payload }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Не удалось выполнить действие.");
    return json;
  }

  async function run(fn: () => Promise<string | void>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
      await refresh(organizationId, botId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка.");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string | null) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => setNotice("Ссылка скопирована."), () => setNotice(text));
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const json = await post({ action: "create_source", name: source.name, tag: source.tag });
      setSource({ name: "", tag: "" });
      return json.inviteError ? `Источник создан. ${json.inviteError}` : "Источник создан.";
    });
  }

  async function addGiveaway(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await post({ action: "create_giveaway", ...giveaway });
      setGiveaway({ title: "", prize: "", description: "", endsAt: "" });
      return "Розыгрыш создан как черновик. Бот начнёт принимать участников только после «Запустить».";
    });
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка трафика…</section>;

  const bot = data?.bot;
  const stats = data?.stats;
  return <div className="autoposting-layout">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Рефералы, розыгрыши и источники</h2>
          <p>Бесплатный трафик через бота: личные реферальные ссылки, розыгрыши с проверкой подписки и метки источников. Бот сам ничего не публикует в каналы.</p>
        </div>
        <button className="secondary" type="button" disabled={busy} onClick={() => run(async () => undefined)}><RefreshCw size={14}/> Обновить</button>
      </div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      {(data?.bots || []).length > 1 && <label>Бот
        <select value={botId} onChange={(e) => { setBotId(e.target.value); run(async () => { await refresh(organizationId, e.target.value); }); }}>
          {(data?.bots || []).map((row) => <option key={row.id} value={row.id}>{row.name}{row.telegram_username ? ` (@${row.telegram_username})` : ""}{row.traffic_enabled ? "" : " — трафик выкл."}</option>)}
        </select>
      </label>}
      {!bot ? <div className="activity-empty">Нет бота с включёнными функциями трафика.</div> : <>
        <div className="autoposting-flow-meta" style={{ margin: "12px 0" }}>
          Бот: <b>@{bot.telegram_username}</b> · канал для проверки подписки: <b>{bot.traffic_channel || "не задан"}</b> · {bot.traffic_enabled ? "трафик включён" : "трафик выключен"} · {bot.enabled ? "webhook включён" : "бот выключен"}
        </div>
        <div className="moderation-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <article className="autoposting-flow"><small>Пользователей бота</small><b style={{ fontSize: 24 }}>{stats?.users ?? 0}</b></article>
          <article className="autoposting-flow"><small>Подписаны на канал</small><b style={{ fontSize: 24 }}>{stats?.subscribed ?? 0}</b></article>
          <article className="autoposting-flow"><small>Пришли по рефералке</small><b style={{ fontSize: 24 }}>{stats?.referred ?? 0}</b></article>
          <article className="autoposting-flow"><small>Из них подписались</small><b style={{ fontSize: 24 }}>{stats?.referredSubscribed ?? 0}</b></article>
        </div>
        <div className="autoposting-flow-actions" style={{ marginTop: 12 }}>
          {bot.start_link && <button className="text-button" type="button" onClick={() => copy(bot.start_link)}><Copy size={13}/> {bot.start_link}</button>}
          <span className="pill muted">Реферальная ссылка: {bot.example_ref_link}</span>
        </div>

        <h3 style={{ marginTop: 24 }}>Источники трафика</h3>
        <form className="integration-connect-form autoposting-form" onSubmit={addSource}>
          <label>Название<input value={source.name} onChange={(e) => setSource((old) => ({ ...old, name: e.target.value }))} placeholder="Взаимопиар с каналом PUBG Daily" maxLength={120}/></label>
          <label>Метка (латиница, цифры, _)<input value={source.tag} onChange={(e) => setSource((old) => ({ ...old, tag: e.target.value }))} placeholder="pubg_daily" maxLength={32}/></label>
          <div className="autoposting-actions"><button className="primary" type="submit" disabled={busy || !source.name.trim()}><Plus size={14}/> Создать источник</button></div>
        </form>
        {(data?.sources || []).length === 0 ? <div className="activity-empty">Источников пока нет. Создайте по одному на каждую площадку, чтобы видеть, откуда приходят люди.</div> :
          <div className="autoposting-flow-list">{(data?.sources || []).map((row) => <article className="autoposting-flow" key={row.id}>
            <div className="autoposting-flow-head"><div><b>{row.name}</b><small>src_{row.tag}</small></div><span className="pill muted">{row.users} польз. · {row.subscribed} подписались</span></div>
            <div className="autoposting-flow-meta">Ссылка в бота: {row.deep_link}{row.invite_link ? <><br/>Ссылка-приглашение в канал: {row.invite_link}</> : null}</div>
            <div className="autoposting-flow-actions">
              <button className="text-button" type="button" onClick={() => copy(row.deep_link)}><Copy size={13}/> Ссылка в бота</button>
              {row.invite_link && <button className="text-button" type="button" onClick={() => copy(row.invite_link)}><Copy size={13}/> Ссылка в канал</button>}
              <button className="text-button danger" type="button" disabled={busy} onClick={() => { if (window.confirm("Удалить источник? Статистика пользователей сохранится без метки.")) run(async () => { await post({ action: "delete_source", id: row.id }); return "Источник удалён."; }); }}><Trash2 size={13}/> Удалить</button>
            </div>
          </article>)}</div>}
      </>}
    </section>

    {bot && <section className="panel">
      <div className="panel-head"><div><h2><Gift size={18}/> Розыгрыши</h2><p>Новый розыгрыш создаётся черновиком. Анонс в канале публикуете вы сами.</p></div></div>
      <form className="integration-connect-form autoposting-form" onSubmit={addGiveaway}>
        <label>Название<input value={giveaway.title} onChange={(e) => setGiveaway((old) => ({ ...old, title: e.target.value }))} maxLength={200} placeholder="Розыгрыш GAME OVER"/></label>
        <label>Приз<input value={giveaway.prize} onChange={(e) => setGiveaway((old) => ({ ...old, prize: e.target.value }))} maxLength={1000}/></label>
        <label>Описание<textarea rows={3} value={giveaway.description} onChange={(e) => setGiveaway((old) => ({ ...old, description: e.target.value }))} maxLength={4000}/></label>
        <label>Дата итогов<input type="date" value={giveaway.endsAt} onChange={(e) => setGiveaway((old) => ({ ...old, endsAt: e.target.value }))}/></label>
        <div className="autoposting-actions"><button className="primary" type="submit" disabled={busy || !giveaway.title.trim()}><Plus size={14}/> Создать черновик</button></div>
      </form>
      <div className="autoposting-flow-list">{(data?.giveaways || []).map((row) => <article className="autoposting-flow" key={row.id}>
        <div className="autoposting-flow-head"><div><b>{row.title}</b><small>{row.prize}</small></div><span className={row.status === "active" ? "pill success" : row.status === "draft" ? "pill warning" : "pill muted"}>{statusLabel[row.status]}</span></div>
        <div className="autoposting-flow-meta">Участников: {row.entries}{row.ends_at ? ` · итоги ${new Date(row.ends_at).toLocaleDateString("ru-RU")}` : ""}</div>
        <div className="autoposting-flow-actions">
          {row.status !== "active" && <button className="secondary" type="button" disabled={busy} onClick={() => { if (window.confirm("Запустить розыгрыш? Бот начнёт принимать участников (в каналы ничего не публикуется).")) run(async () => { await post({ action: "giveaway_status", id: row.id, status: "active" }); return "Розыгрыш запущен в боте."; }); }}>Запустить</button>}
          {row.status === "active" && <button className="secondary" type="button" disabled={busy} onClick={() => run(async () => { await post({ action: "giveaway_status", id: row.id, status: "finished" }); return "Розыгрыш завершён."; })}>Завершить</button>}
          {row.entries > 0 && <button className="secondary" type="button" disabled={busy} onClick={() => run(async () => {
            const json = await post({ action: "draw_winner", id: row.id });
            const w = json.winner;
            return `Победитель: ${w.name || "без имени"}${w.username ? ` (@${w.username})` : ""}, id ${w.telegram_user_id}, билетов ${w.tickets} из ${json.totalTickets}. Свяжитесь с ним сами.`;
          })}><Trophy size={13}/> Выбрать победителя</button>}
        </div>
      </article>)}</div>

      <h3 style={{ marginTop: 24 }}><Trophy size={16}/> Топ приглашающих</h3>
      {(data?.leaderboard || []).length === 0 ? <div className="activity-empty">Пока никто не пригласил друзей.</div> :
        <ol>{(data?.leaderboard || []).map((row) => <li key={row.userId}>{row.name}{row.username ? ` (@${row.username})` : ""} — {row.subscribed} подписались / {row.invited} приглашено</li>)}</ol>}
    </section>}
  </div>;
}
