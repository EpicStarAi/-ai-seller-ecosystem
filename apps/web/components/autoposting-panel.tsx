"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type Channel = { id: string; integration_id: string; title: string; username: string | null; can_post_messages: boolean };
type Flow = {
  id: string; name: string; channel_id: string; source_type: "web_search" | "telegram_channels"; keywords: string[];
  ai_prompt: string; use_ai_editor: boolean; generate_image: boolean; moderation_enabled: boolean;
  max_forwarding_enabled: boolean; schedule_mode: "interval" | "cron"; interval_minutes: number;
  cron_expression: string | null; status: string; prompt_id?: string | null; post_buttons?: { text: string; url: string }[][] | null;
  auto_publish_enabled?: boolean; auto_publish_mode?: "interval" | "slots"; auto_publish_interval_minutes?: number;
  auto_publish_slots?: string[]; auto_publish_timezone?: string | null; auto_publish_last_at?: string | null;
  telegram_channels?: { title: string; username: string | null } | null;
};
const blank = {
  id: "", name: "", channelId: "", sourceType: "web_search" as "web_search" | "telegram_channels",
  keywords: "", aiPrompt: "", promptId: "", useAiEditor: false, generateImage: false, moderationEnabled: false,
  maxForwardingEnabled: false, scheduleMode: "interval" as "interval" | "cron", intervalMinutes: 60, cronExpression: "",
  autoPublishEnabled: false, autoPublishMode: "interval" as "interval" | "slots", autoPublishIntervalMinutes: 60,
  autoPublishSlots: "", autoPublishTimezone: "Europe/Kyiv",
};

export default function AutopostingPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [botLabels, setBotLabels] = useState<Record<string, string>>({});
  const [flows, setFlows] = useState<Flow[]>([]);
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompts, setPrompts] = useState<{ id: string; name: string }[]>([]);

  const refresh = useCallback(async (org: string) => {
    const [channelResponse, flowResponse, promptResponse, integrationsResponse] = await Promise.all([
      fetch(`/api/telegram/channels?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
      fetch(`/api/autoposting/flows?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
      fetch(`/api/autoposting/prompts?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
      fetch(`/api/integrations?organizationId=${encodeURIComponent(org)}`, { cache: "no-store" }),
    ]);
    const channelData = await channelResponse.json();
    const flowData = await flowResponse.json();
    const promptData = await promptResponse.json();
    const integrationsData = await integrationsResponse.json();
    if (!channelResponse.ok) throw new Error(channelData.error || "Не удалось загрузить Telegram-каналы.");
    if (!flowResponse.ok) throw new Error(flowData.error || "Не удалось загрузить потоки.");
    if (!promptResponse.ok) throw new Error(promptData.error || "Не удалось загрузить промпты.");
    if (!integrationsResponse.ok) throw new Error(integrationsData.error || "Не удалось загрузить Telegram-ботов.");
    const labels: Record<string, string> = {};
    for (const item of integrationsData.integrations || []) {
      if (item.kind === "telegram") {
        const username = typeof item.metadata?.username === "string" ? "@" + item.metadata.username.replace(/^@/, "") : "";
        labels[item.id] = item.label || username || item.external_account_id || "Telegram bot";
      }
    }
    setBotLabels(labels);
    setChannels(channelData.channels || []);
    setFlows(flowData.flows || []);
    setPrompts(promptData.prompts || []);
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
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh]);

  function update<K extends keyof typeof blank>(key: K, value: typeof blank[K]) {
    setForm(old => ({ ...old, [key]: value }));
  }
  function edit(flow: Flow) {
    setForm({
      id: flow.id, name: flow.name, channelId: flow.channel_id, sourceType: flow.source_type,
      keywords: (flow.keywords || []).join(", "), aiPrompt: flow.ai_prompt, promptId: flow.prompt_id || "",
      useAiEditor: flow.use_ai_editor, generateImage: flow.generate_image,
      moderationEnabled: flow.moderation_enabled, maxForwardingEnabled: flow.max_forwarding_enabled,
      scheduleMode: flow.schedule_mode, intervalMinutes: flow.interval_minutes || 60,
      cronExpression: flow.cron_expression || "",
      autoPublishEnabled: flow.auto_publish_enabled === true,
      autoPublishMode: flow.auto_publish_mode === "slots" ? "slots" : "interval",
      autoPublishIntervalMinutes: flow.auto_publish_interval_minutes || 60,
      autoPublishSlots: Array.isArray(flow.auto_publish_slots) ? flow.auto_publish_slots.join(", ") : "",
      autoPublishTimezone: flow.auto_publish_timezone || "Europe/Kyiv",
    });
    setNotice("Поток загружен в форму редактирования.");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function reset() { setForm(blank); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = {
        organizationId, id: form.id || undefined, name: form.name, channelId: form.channelId,
        sourceType: form.sourceType, keywords: form.keywords.split(",").map(x => x.trim()).filter(Boolean),
        aiPrompt: form.aiPrompt, promptId: form.promptId || null, useAiEditor: form.useAiEditor, generateImage: form.generateImage,
        moderationEnabled: form.moderationEnabled, maxForwardingEnabled: form.maxForwardingEnabled,
        scheduleMode: form.scheduleMode, intervalMinutes: Number(form.intervalMinutes), cronExpression: form.cronExpression,
        autoPublishEnabled: form.autoPublishEnabled,
        autoPublishMode: form.autoPublishMode,
        autoPublishIntervalMinutes: Number(form.autoPublishIntervalMinutes),
        autoPublishSlots: form.autoPublishSlots,
        autoPublishTimezone: form.autoPublishTimezone,
      };
      const response = await fetch("/api/autoposting/flows", {
        method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки.");
      reset(); await refresh(organizationId);
      setNotice(data.message || "Настройки потока сохранены.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить этот поток?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/flows?organizationId=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Не удалось удалить поток."); }
      await refresh(organizationId); if (form.id === id) reset();
      setNotice("Поток удалён.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка AI Автопостинга…</section>;

  return <div className="autoposting-layout">
    <section className="panel">
      <div className="panel-head"><div><h2>{form.id ? "Редактировать поток" : "Настроить автопостинг"}</h2><p>Настройте источник, AI-инструкции и расписание. Сохранение пока создаёт черновик без автоматических публикаций.</p></div><span className="pill warning">Черновик · MVP</span></div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      <form className="integration-connect-form autoposting-form" onSubmit={save}>
        <label>Название потока
          <input value={form.name} onChange={e => update("name", e.target.value)} placeholder="Например: PUBG — новости и обновления" required maxLength={100}/>
        </label>
        <label>Целевой канал
          <select value={form.channelId} onChange={e => update("channelId", e.target.value)} required>
            <option value="">Выберите подключённый Telegram-канал</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.title}{c.username ? ` · @${c.username}` : ""} — {botLabels[c.integration_id] || "Telegram bot"}</option>)}
          </select>
        </label>
        {channels.length === 0 && <p className="integration-security">Сначала добавьте канал в Telegram Workspace и проверьте право бота на публикацию.</p>}
        <fieldset className="autoposting-fieldset"><legend>Источник контента</legend>
          <label className="autoposting-radio"><input type="radio" checked={form.sourceType === "web_search"} onChange={() => update("sourceType", "web_search")}/> Поиск по интернету</label>
          <label className="autoposting-radio"><input type="radio" checked={form.sourceType === "telegram_channels"} onChange={() => update("sourceType", "telegram_channels")}/> Telegram-каналы</label>
        </fieldset>
        <label>Ключевые слова для поиска
          <input value={form.keywords} onChange={e => update("keywords", e.target.value)} placeholder="Нейросети, стартапы, AI-агенты"/>
          <small>Перечислите темы через запятую. Каждый пост будет опираться на выбранные темы.</small>
        </label>
        <label>Инструкция для AI-генерации
          <textarea value={form.aiPrompt} onChange={e => update("aiPrompt", e.target.value)} placeholder="Опишите тематику канала, стиль и целевую аудиторию…" rows={5} required maxLength={10000}/>
        </label>
        <label>Сохранённый промпт для переписывания
          <select value={form.promptId} onChange={e => update("promptId", e.target.value)}>
            <option value="">Не выбран — использовать инструкцию выше</option>
            {prompts.map(prompt => <option value={prompt.id} key={prompt.id}>{prompt.name}</option>)}
          </select>
          <small>Если выбран промпт из библиотеки, именно он используется при AI-переписывании. Библиотека — в разделе «Промпты».</small>
        </label>
        <div className="autoposting-options">
          <label className="autoposting-check"><input type="checkbox" checked={form.useAiEditor} onChange={e => update("useAiEditor", e.target.checked)}/><span><b>AI-редактор</b><small>Дополнительная редактура, улучшение стиля и исправление ошибок.</small></span></label>
          <label className="autoposting-check"><input type="checkbox" checked={form.generateImage} onChange={e => update("generateImage", e.target.checked)}/><span><b>Генерировать иллюстрацию к посту</b><small>Только если в интеграциях подключён OpenAI. Если провайдер изображений не настроен, переписывание продолжится без картинки, а в модерации появится отметка.</small></span></label>
          <label className="autoposting-check"><input type="checkbox" checked={form.moderationEnabled} onChange={e => update("moderationEnabled", e.target.checked)}/><span><b>Модерация постов</b><small>Предусмотрим одобрение, редактирование или отмену до публикации. Review-бот пока не подключён.</small></span></label>
          <label className="autoposting-check disabled"><input type="checkbox" checked={form.maxForwardingEnabled} onChange={e => update("maxForwardingEnabled", e.target.checked)} /><span><b>Пересылка в MAX-канал <em>Недоступно</em></b><small>Опция сохраняется как настройка, но MAX-интеграция отсутствует и ничего не отправляет.</small></span></label>
        </div>
        <fieldset className="autoposting-fieldset"><legend>Расписание</legend>
          <label className="autoposting-radio"><input type="radio" checked={form.scheduleMode === "interval"} onChange={() => update("scheduleMode", "interval")}/> Интервал (в минутах)</label>
          <label className="autoposting-radio"><input type="radio" checked={form.scheduleMode === "cron"} onChange={() => update("scheduleMode", "cron")}/> CRON-выражение</label>
        </fieldset>
        {form.scheduleMode === "interval" ? <label>Интервал в минутах
          <input type="number" min={30} max={43200} step={1} value={form.intervalMinutes} onChange={e => update("intervalMinutes", Number(e.target.value))} required/>
          <small>Минимум 30 минут. Рекомендуем учитывать частоту появления новых материалов в источниках.</small>
        </label> : <label>CRON-выражение
          <input value={form.cronExpression} onChange={e => update("cronExpression", e.target.value)} placeholder="0 0/60 * * * ?" required/>
          <small>Синтаксис и проверку CRON согласуем с серверным планировщиком до активации.</small>
        </label>}
        <fieldset className="autoposting-fieldset"><legend>Автопубликация одобренных постов</legend>
          <label className="autoposting-check"><input type="checkbox" checked={form.autoPublishEnabled} onChange={e => update("autoPublishEnabled", e.target.checked)}/><span><b>Публиковать одобренные посты по расписанию</b><small>По умолчанию выключено: публикация только по кнопке «Опубликовать». Если включить, на модерации появится «Одобрить в очередь» — воркер отправит один одобренный пост, когда наступит интервал или слот.</small></span></label>
          {form.autoPublishEnabled ? <>
            <label className="autoposting-radio"><input type="radio" checked={form.autoPublishMode === "interval"} onChange={() => update("autoPublishMode", "interval")}/> Интервал (минимум 30 минут)</label>
            <label className="autoposting-radio"><input type="radio" checked={form.autoPublishMode === "slots"} onChange={() => update("autoPublishMode", "slots")}/> Слоты времени</label>
            {form.autoPublishMode === "interval" ? <label>Интервал автопубликации, минуты
              <input type="number" min={30} max={43200} step={1} value={form.autoPublishIntervalMinutes} onChange={e => update("autoPublishIntervalMinutes", Number(e.target.value))} required/>
            </label> : <label>Слоты (ЧЧ:ММ через запятую)
              <input value={form.autoPublishSlots} onChange={e => update("autoPublishSlots", e.target.value)} placeholder="09:00, 13:00, 18:30" required/>
              <small>Время в выбранном поясе, окно 2 минуты. За один слот уходит не больше одного одобренного поста.</small>
            </label>}
            <label>Часовой пояс
              <select value={form.autoPublishTimezone} onChange={e => update("autoPublishTimezone", e.target.value)}>
                <option value="Europe/Kyiv">Europe/Kyiv</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
          </> : null}
        </fieldset>
        <div className="autoposting-actions">
          <button className="primary" type="submit" disabled={busy || channels.length === 0}>{busy ? <><LoaderCircle className="spin" size={14}/> Сохраняем…</> : <><Save size={14}/> {form.id ? "Сохранить изменения" : "Сохранить настройки потока"}</>}</button>
          {form.id && <button className="secondary" type="button" onClick={reset} disabled={busy}>Отмена</button>}
        </div>
        <p className="autoposting-footnote"><Clock3 size={14}/> Автопубликация одобренных постов по умолчанию выключена и не включается сама. Расписание выше относится к настройке потока и не публикует посты без явного включения автопубликации.</p>
      </form>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Потоки автопостинга</h2><p>{flows.length} сохранённых конфигураций</p></div><button className="secondary" onClick={() => refresh(organizationId)} disabled={busy}><RefreshCw size={14}/> Обновить</button></div>
      {flows.length === 0 ? <div className="activity-empty">Пока нет потоков. Создайте первый поток в форме выше.</div> :
        <div className="autoposting-flow-list">{flows.map(flow => <article className="autoposting-flow" key={flow.id}>
          <div className="autoposting-flow-head"><div><b>{flow.name}</b><small>{flow.telegram_channels?.title || "Telegram-канал"} · {flow.source_type === "web_search" ? "Поиск в интернете" : "Telegram-каналы"}</small></div><span className="pill warning">Черновик</span></div>
          <div className="autoposting-flow-meta">{flow.schedule_mode === "interval" ? `Каждые ${flow.interval_minutes} мин.` : `CRON: ${flow.cron_expression}`} · {(flow.keywords || []).length} ключевых тем</div>
          <div className="autoposting-flow-meta">{flow.auto_publish_enabled
            ? (flow.auto_publish_mode === "slots"
              ? `Автопубликация: слоты ${(Array.isArray(flow.auto_publish_slots) ? flow.auto_publish_slots.join(", ") : "")} (${flow.auto_publish_timezone || "Europe/Kyiv"})`
              : `Автопубликация: каждые ${flow.auto_publish_interval_minutes || 60} мин.`)
            : "Автопубликация выключена — только ручная кнопка"}</div>
          {Array.isArray(flow.post_buttons) && flow.post_buttons.flat().length > 0 ? <div className="autoposting-flow-meta">Кнопки под постом: {flow.post_buttons.flat().map(b => b.text).filter(Boolean).join(" · ")}</div> : null}
          <div className="autoposting-flow-actions"><button className="text-button" onClick={() => edit(flow)}>Редактировать</button><button className="text-button danger" onClick={() => remove(flow.id)} disabled={busy}><Trash2 size={13}/> Удалить</button></div>
        </article>)}</div>}
    </section>
  </div>;
}
