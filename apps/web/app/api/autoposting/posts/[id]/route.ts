import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { generateText, rewriteSystemPrompt, type ChatProvider } from "@/lib/ai/generate";
import { buildPostReplyMarkup } from "@/lib/telegram/post-buttons";
import { MEDIA_CAPTION_LIMIT, parsePostMedia, planPublish, readMediaFile } from "@/lib/autoposting/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(request: Request, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для модерации публикаций." }, { status: 403 }) };
  }
  return { supabase, user, organizationId };
}

async function loadPost(ctx: { supabase: Awaited<ReturnType<typeof createClient>>; organizationId: string }, id: string) {
  const { data, error } = await ctx.supabase.from("autoposting_posts")
    .select("id,flow_id,content_item_id,status,original_text,draft_text,source_url,media,last_error")
    .eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function resolveSecret(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string, kind: ChatProvider) {
  const { data: integration } = await supabase.from("integrations")
    .select("id").eq("organization_id", organizationId).eq("kind", kind).eq("status", "connected").maybeSingle();
  if (!integration) return null;
  const { data: secret } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", integration.id).maybeSingle();
  if (!secret) return null;
  return decryptIntegrationSecret(secret.nonce, secret.ciphertext, organizationId, kind);
}

async function resolveProvider(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string) {
  for (const kind of ["openai", "anthropic", "gemini"] as ChatProvider[]) {
    try {
      const secret = await resolveSecret(supabase, organizationId, kind);
      if (secret) return { provider: kind, secret };
    } catch {
      continue;
    }
  }
  return { provider: "ollama" as const, secret: undefined };
}

async function sendTelegram(token: string, method: string, payload: Record<string, unknown>, files?: { field: string; filename: string; bytes: Buffer; mime: string }[]) {
  let lastError = "Telegram не принял публикацию.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    if (files && files.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (value == null) continue;
        form.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      for (const file of files) {
        form.append(file.field, new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
      }
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });
    } else {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    }
    const result = await response.json() as Record<string, any>;
    if (response.ok && result.ok) return result;
    const retryAfter = Number(result?.parameters?.retry_after ?? 0);
    if ((response.status === 429 || result?.error_code === 429) && retryAfter > 0 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.5) * 1000));
      continue;
    }
    lastError = typeof result?.description === "string" ? result.description : lastError;
    break;
  }
  throw new Error(lastError);
}

function firstMessageId(result: Record<string, any>): string | null {
  const body = result?.result;
  if (Array.isArray(body) && body[0]?.message_id != null) return String(body[0].message_id);
  if (body?.message_id != null) return String(body.message_id);
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await access(request, true);
  if ("response" in ctx) return ctx.response;
  const { id } = await context.params;
  let body: { action?: string; draftText?: string } = {};
  try { body = await request.json(); } catch { body = {}; }
  const action = body.action;
  const post = await loadPost(ctx, id);
  if (!post) return NextResponse.json({ error: "Черновик не найден." }, { status: 404 });
  const now = new Date().toISOString();

  if (action === "reject") {
    if (!["pending_review", "failed"].includes(post.status)) {
      return NextResponse.json({ error: "Этот черновик нельзя отклонить." }, { status: 409 });
    }
    const { error } = await ctx.supabase.from("autoposting_posts").update({
      status: "rejected", reviewed_by: ctx.user.id, reviewed_at: now, updated_at: now, last_error: null,
    }).eq("id", post.id).eq("organization_id", ctx.organizationId);
    if (error) return NextResponse.json({ error: "Не удалось отклонить черновик." }, { status: 500 });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  if (action === "rewrite") {
    if (!["pending_review", "failed"].includes(post.status)) {
      return NextResponse.json({ error: "Этот черновик нельзя переписать." }, { status: 409 });
    }
    const { data: flow } = await ctx.supabase.from("autoposting_flows")
      .select("ai_prompt").eq("id", post.flow_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!flow) return NextResponse.json({ error: "Поток не найден." }, { status: 404 });
    try {
      const provider = await resolveProvider(ctx.supabase, ctx.organizationId);
      const generated = await generateText({
        provider: provider.provider,
        secret: provider.secret,
        systemPrompt: rewriteSystemPrompt(flow.ai_prompt || ""),
        userText: post.original_text || "[Публикация без текста]",
      });
      const { error } = await ctx.supabase.from("autoposting_posts").update({
        draft_text: generated.text, provider: generated.provider, model: generated.model,
        status: "pending_review", last_error: null, updated_at: now,
      }).eq("id", post.id).eq("organization_id", ctx.organizationId);
      if (error) return NextResponse.json({ error: "Не удалось сохранить новый текст." }, { status: 500 });
      return NextResponse.json({ ok: true, status: "pending_review", draftText: generated.text, provider: generated.provider, model: generated.model });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) || 502 : 502;
      const message = error instanceof Error ? error.message : "Не удалось переписать текст.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (action === "publish") {
    if (!["pending_review", "failed"].includes(post.status)) {
      return NextResponse.json({ error: "Этот черновик уже обработан." }, { status: 409 });
    }
    const draftText = typeof body.draftText === "string" && body.draftText.trim()
      ? body.draftText.trim().slice(0, 4096)
      : (post.draft_text || "").trim();
    const preparedMedia = parsePostMedia(post.media);
    if (!draftText && preparedMedia.items.length === 0) return NextResponse.json({ error: "Пустой текст нельзя опубликовать." }, { status: 422 });
    const { data: flow } = await ctx.supabase.from("autoposting_flows")
      .select("id,channel_id,moderation_enabled,post_buttons")
      .eq("id", post.flow_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!flow) return NextResponse.json({ error: "Поток не найден." }, { status: 404 });
    if (flow.moderation_enabled !== true) {
      return NextResponse.json({ error: "Для этого потока публикация возможна только с включённой модерацией и явным одобрением." }, { status: 409 });
    }
    const { data: channel } = await ctx.supabase.from("telegram_channels")
      .select("id,chat_id,integration_id,can_post_messages,username")
      .eq("id", flow.channel_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!channel?.can_post_messages || !channel.chat_id) {
      return NextResponse.json({ error: "Канал публикации не подтверждён или бот не имеет права постить." }, { status: 409 });
    }
    const { data: stored, error: secretError } = await ctx.supabase.from("integration_secrets")
      .select("nonce,ciphertext").eq("integration_id", channel.integration_id).maybeSingle();
    if (secretError || !stored) return NextResponse.json({ error: "Не найден Telegram credential бота." }, { status: 409 });
    let token: string;
    try { token = decryptIntegrationSecret(stored.nonce, stored.ciphertext, ctx.organizationId, "telegram"); }
    catch { return NextResponse.json({ error: "Не удалось расшифровать Telegram credential." }, { status: 500 }); }
    const replyMarkup = buildPostReplyMarkup(flow.post_buttons, { source_url: post.source_url });
    const media = preparedMedia;
    const steps = planPublish(draftText, media, Boolean(replyMarkup));
    try {
      let messageId: string | null = null;
      for (const step of steps) {
        if (step.method === "sendMessage") {
          const payload: Record<string, unknown> = { chat_id: channel.chat_id, text: draftText || " ", disable_web_page_preview: true };
          if (step.buttons && replyMarkup) payload.reply_markup = replyMarkup;
          const result = await sendTelegram(token, "sendMessage", payload);
          if (!messageId) messageId = firstMessageId(result);
          continue;
        }
        if (step.method === "sendMediaGroup") {
          const files: { field: string; filename: string; bytes: Buffer; mime: string }[] = [];
          const group: Record<string, unknown>[] = [];
          for (const [i, item] of media.items.entries()) {
            const file = readMediaFile(item.relpath);
            if (!file) continue;
            const field = `file${i}`;
            files.push({ field, filename: item.relpath.split("/").pop() || `${field}`, bytes: file.bytes, mime: item.mime });
            group.push({ type: item.kind === "video" ? "video" : "photo", media: `attach://${field}` });
          }
          if (!group.length) throw new Error("Не удалось прочитать медиафайлы для альбома.");
          const result = await sendTelegram(token, "sendMediaGroup", { chat_id: channel.chat_id, media: group }, files);
          if (!messageId) messageId = firstMessageId(result);
          continue;
        }
        const item = media.items[0];
        const file = item ? readMediaFile(item.relpath) : null;
        if (!file || !item) throw new Error("Не удалось прочитать медиафайл.");
        const field = step.method === "sendVideo" ? "video" : "photo";
        const payload: Record<string, unknown> = { chat_id: channel.chat_id };
        if (step.caption && draftText) payload.caption = draftText.slice(0, MEDIA_CAPTION_LIMIT);
        if (step.buttons && replyMarkup) payload.reply_markup = replyMarkup;
        const result = await sendTelegram(token, step.method, payload, [{ field, filename: item.relpath.split("/").pop() || field, bytes: file.bytes, mime: item.mime }]);
        if (!messageId) messageId = firstMessageId(result);
      }
      const { error } = await ctx.supabase.from("autoposting_posts").update({
        status: "published",
        draft_text: draftText,
        published_message_id: messageId,
        published_chat_id: channel.chat_id,
        published_at: now,
        reviewed_by: ctx.user.id,
        reviewed_at: now,
        last_error: null,
        updated_at: now,
      }).eq("id", post.id).eq("organization_id", ctx.organizationId);
      if (error) return NextResponse.json({ error: "Пост отправлен, но не удалось обновить статус черновика." }, { status: 500 });
      return NextResponse.json({ ok: true, status: "published", messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Ошибка публикации в Telegram.";
      await ctx.supabase.from("autoposting_posts").update({
        status: "failed", last_error: message, draft_text: draftText, updated_at: now,
      }).eq("id", post.id).eq("organization_id", ctx.organizationId);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Неизвестное действие." }, { status: 400 });
}
