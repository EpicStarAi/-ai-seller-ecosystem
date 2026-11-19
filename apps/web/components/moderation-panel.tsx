"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Send, Trash2, WandSparkles } from "lucide-react";
import { parsePostMedia } from "@/lib/autoposting/media";

type Draft = {
  id: string;
  flow_id: string;
  content_item_id: string;
  status: string;
  original_text: string;
  draft_text: string;
  source_url: string | null;
  provider: string | null;
  model: string | null;
  rejection_reason: string | null;
  last_error: string | null;
  published_message_id: string | null;
  published_at: string | null;
  media?: unknown;
  created_at: string;
  updated_at: string;
  autoposting_flows?: { name: string; auto_publish_enabled?: boolean } | { name: string; auto_publish_enabled?: boolean }[] | null;
};

function flowName(post: Draft) {
  const rel = post.autoposting_flows;
  if (Array.isArray(rel)) return rel[0]?.name || "Поток";
  return rel?.name || "Поток";
}

function flowAutoPublish(post: Draft) {
  const rel = post.autoposting_flows;
  if (Array.isArray(rel)) return rel[0]?.auto_publish_enabled === true;
  return rel?.auto_publish_enabled === true;
}

function statusLabel(status: string) {
  if (status === "failed") return "Ошибка публикации";
  if (status === "approved") return "В очереди автопубликации";
  return "Ожидает проверки";
}

function illustrationReason(reason?: string) {
  if (reason === "no_image_provider") return "Иллюстрация пропущена: провайдер изображений не подключён.";
  if (reason === "provider_error") return "Иллюстрация пропущена: ошибка провайдера.";
  if (reason === "album_full") return "Иллюстрация пропущена: в альбоме уже 10 файлов.";
  return "Иллюстрация пропущена.";
}

export default function ModerationPanel() {
  const [organizationId, setOrganizationId] = useState("");
  const [posts, setPosts] = useState<Draft[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (org: string) => {
    const response = await fetch(`/api/autoposting/posts?organizationId=${encodeURIComponent(org)}&status=queue`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить очередь модерации.");
    const list = (data.posts || []) as Draft[];
    setPosts(list);
    setPendingCount(data.pendingCount ?? list.filter((post) => post.status === "pending_review").length);
    setEdits((old) => {
      const next = { ...old };
      for (const post of list) {
        if (next[post.id] == null) next[post.id] = post.draft_text || "";
      }
      return next;
    });
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

  async function act(id: string, action: "publish" | "reject" | "rewrite" | "approve") {
    if (!organizationId) return;
    if (action === "publish" && !window.confirm("Опубликовать этот текст в канал потока? Публикация уйдёт сразу.")) return;
    if (action === "approve" && !window.confirm("Поставить черновик в очередь автопубликации? Он уйдёт в канал по расписанию потока, не сразу.")) return;
    if (action === "reject" && !window.confirm("Отклонить этот черновик? Он больше не появится в очереди.")) return;
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/autoposting/posts/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draftText: edits[id] ?? "" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие.");
      if (action === "rewrite" && typeof data.draftText === "string") {
        setEdits((old) => ({ ...old, [id]: data.draftText }));
        const illustration = data.illustration as { status?: string; reason?: string } | undefined;
        if (illustration?.status === "generated") setNotice("Текст переписан, добавлена AI-иллюстрация. Проверьте черновик.");
        else if (illustration?.status === "skipped") setNotice(`Текст переписан. ${illustrationReason(illustration.reason)}`);
        else setNotice("Текст переписан. Проверьте черновик и опубликуйте вручную или поставьте в очередь.");
      } else if (action === "publish") {
        setNotice(data.messageId ? `Публикация отправлена (сообщение ${data.messageId}).` : "Публикация отправлена.");
      } else if (action === "approve") {
        setNotice("Черновик поставлен в очередь автопубликации.");
      } else {
        setNotice("Черновик отклонён.");
      }
      await refresh(organizationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка действия.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <section className="panel integration-loading"><LoaderCircle className="spin" size={20}/> Загрузка очереди модерации…</section>;

  return <div className="moderation-layout">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Модерация публикаций</h2>
          <p>Черновики после AI-переписывания. «Опубликовать» отправляет сразу. «Одобрить в очередь» появляется только у потоков с включённой автопубликацией.</p>
        </div>
        <div className="moderation-head-actions">
          <span className="pill warning">{pendingCount} на проверке</span>
          <button className="secondary" onClick={() => { setError(""); setNotice(""); refresh(organizationId); }} disabled={!organizationId || Boolean(busyId)}>
            <RefreshCw size={14}/> Обновить
          </button>
        </div>
      </div>
      {error && <div className="integration-alert error"><AlertCircle size={16}/><span>{error}</span></div>}
      {notice && <div className="integration-alert success"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      {posts.length === 0 ? (
        <div className="activity-empty">Очередь пуста. Новые посты доноров появятся здесь после AI-переписывания.</div>
      ) : (
        <div className="moderation-list">
          {posts.map((post) => {
            const busy = busyId === post.id;
            return <article className="moderation-card" key={post.id}>
              <div className="autoposting-flow-head">
                <div>
                  <b>{flowName(post)}</b>
                  <small>{new Date(post.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}</small>
                </div>
                <span className={post.status === "failed" ? "pill error" : post.status === "approved" ? "pill success" : "pill warning"}>
                  {statusLabel(post.status)}
                </span>
              </div>
              {post.source_url && (
                <p className="moderation-source">
                  <a href={post.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Источник</a>
                </p>
              )}
              {(() => {
                const media = parsePostMedia(post.media);
                if (!media.items.length && !media.skipped.length && !media.illustration) return null;
                return <div className="moderation-media">
                  {media.items.map((item, index) => {
                    const src = `/api/autoposting/posts/${encodeURIComponent(post.id)}/media/${index}?organizationId=${encodeURIComponent(organizationId)}`;
                    return item.kind === "video"
                      ? <video key={item.relpath} className="moderation-media-item" controls preload="metadata" src={src} />
                      : <img key={item.relpath} className="moderation-media-item" alt="" src={src} />;
                  })}
                  {media.skipped.length > 0 && <small>Часть медиа донора не сохранена ({media.skipped.length}).</small>}
                  {media.illustration?.status === "skipped" ? <small>{illustrationReason(media.illustration.reason)}</small> : null}
                  {media.illustration?.status === "generated" ? <small>Добавлена AI-иллюстрация.</small> : null}
                </div>;
              })()}
              {post.last_error && <div className="integration-alert error"><AlertCircle size={16}/><span>{post.last_error}</span></div>}
              <div className="moderation-grid">
                <label>Оригинал донора
                  <textarea readOnly value={post.original_text || ""} rows={8} />
                </label>
                <label>Текст для публикации
                  <textarea
                    value={edits[post.id] ?? post.draft_text ?? ""}
                    onChange={(e) => setEdits((old) => ({ ...old, [post.id]: e.target.value }))}
                    rows={8}
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="moderation-meta">
                {post.provider ? <span>Модель: {post.provider}{post.model ? ` · ${post.model}` : ""}</span> : <span>Модель не указана</span>}
                <span>{(edits[post.id] ?? post.draft_text ?? "").length} символов</span>
              </div>
              <div className="autoposting-flow-actions">
                <button className="primary" onClick={() => act(post.id, "publish")} disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={13}/> : <Send size={13}/>} {post.status === "approved" ? "Опубликовать сейчас" : "Опубликовать"}
                </button>
                {flowAutoPublish(post) && post.status !== "approved" ? (
                  <button className="secondary" onClick={() => act(post.id, "approve")} disabled={busy}>
                    <CheckCircle2 size={13}/> Одобрить в очередь
                  </button>
                ) : null}
                {post.status !== "approved" ? (
                  <button className="secondary" onClick={() => act(post.id, "rewrite")} disabled={busy}>
                    <WandSparkles size={13}/> Переписать
                  </button>
                ) : null}
                <button className="text-button danger" onClick={() => act(post.id, "reject")} disabled={busy}>
                  <Trash2 size={13}/> {post.status === "approved" ? "Убрать из очереди" : "Отклонить"}
                </button>
              </div>
            </article>;
          })}
        </div>
      )}
    </section>
  </div>;
}
