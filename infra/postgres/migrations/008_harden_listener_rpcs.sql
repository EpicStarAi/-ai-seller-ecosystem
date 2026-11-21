-- 008_harden_listener_rpcs.sql
--
-- Harden Telegram listener RPCs:
--   * store the ingest shared-secret SHA-256 digest in private.app_secrets
--   * read that digest from SECURITY DEFINER functions
--   * revoke EXECUTE from anon and authenticated; keep service_role
--
-- The digest is NOT stored in this repository. On production cutover it is
-- copied server-side from the previous function body (see the DO block).
-- On a fresh database, insert one row out-of-band:
--   INSERT INTO private.app_secrets(name, value)
--   VALUES ('ingest_secret_sha256', '<sha256-hex-of-ingest-shared-secret>');
-- Do not apply this file to production automatically if a cutover script
-- has already been applied.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
-- service_role is not granted on this schema or table.

CREATE TABLE IF NOT EXISTS private.app_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE private.app_secrets ENABLE ROW LEVEL SECURITY;
-- Not FORCED: table owner (postgres) can be read by SECURITY DEFINER
-- functions. No policies and no grants for anon/authenticated/service_role.

REVOKE ALL ON TABLE private.app_secrets FROM PUBLIC;
REVOKE ALL ON TABLE private.app_secrets FROM anon, authenticated, service_role;

-- Production cutover: if the current function body still embeds a sha256
-- hex digest, copy it into private.app_secrets without returning it.
-- If no digest literal is present, leave an existing row as-is.
DO $cutover$
DECLARE
  def text;
  digest text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'list_telegram_listener_donors'
    AND pg_get_function_identity_arguments(p.oid) = 'p_secret text';

  digest := (regexp_match(
    def,
    $re$encode\(extensions\.digest\(p_secret, 'sha256'\), 'hex'\) <> '([0-9a-f]{64})'$re$
  ))[1];

  IF digest IS NOT NULL THEN
    INSERT INTO private.app_secrets(name, value)
    VALUES ('ingest_secret_sha256', digest)
    ON CONFLICT (name) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now();
  ELSIF NOT EXISTS (
    SELECT 1 FROM private.app_secrets WHERE name = 'ingest_secret_sha256'
  ) THEN
    RAISE NOTICE 'private.app_secrets.ingest_secret_sha256 is not populated; insert it out-of-band';
  END IF;
END
$cutover$;

CREATE OR REPLACE FUNCTION public.list_telegram_listener_donors(p_secret text)
 RETURNS TABLE(id uuid, organization_id uuid, flow_id uuid, chat_id text, username text, title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_digest text;
begin
  select s.value into v_digest
  from private.app_secrets s
  where s.name = 'ingest_secret_sha256';
  if p_secret is null or v_digest is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_digest then
    raise exception 'unauthorized';
  end if;
  return query
    select d.id, d.organization_id, d.flow_id, d.chat_id, d.username, d.title
    from public.autoposting_donors d
    join public.autoposting_flows f on f.id=d.flow_id and f.organization_id=d.organization_id
    where d.source_type='telegram_channel' and f.source_type='telegram_channels';
end;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_telegram_listener_post(p_secret text, p_donor_id uuid, p_message_id text, p_message_text text, p_message_date timestamp with time zone, p_media jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d public.autoposting_donors%rowtype;
  v_body text;
  v_hash text;
  v_url text;
  v_id uuid;
  v_digest text;
begin
  select s.value into v_digest
  from private.app_secrets s
  where s.name = 'ingest_secret_sha256';
  if p_secret is null or v_digest is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_digest then
    raise exception 'unauthorized';
  end if;
  if p_donor_id is null or p_message_id is null or p_message_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid source message';
  end if;
  select * into d from public.autoposting_donors where id=p_donor_id;
  if not found then raise exception 'donor not found'; end if;
  v_body := left(coalesce(nullif(trim(p_message_text),''),'[Публикация содержит медиа без текстового описания]'),50000);
  v_hash := encode(extensions.digest(v_body, 'sha256'),'hex');
  if d.username is not null and length(trim(d.username)) > 0 then
    v_url := 'https://t.me/' || regexp_replace(d.username, '^@', '') || '/' || p_message_id;
  else
    v_url := 'https://t.me/c/' || regexp_replace(d.chat_id, '^-100', '') || '/' || p_message_id;
  end if;
  insert into public.telegram_content_items (
    organization_id, flow_id, donor_id, source_url, source_message_id, title, body,
    content_hash, rights_basis, rights_note, review_status, metadata, submitted_by
  ) values (
    d.organization_id, d.flow_id, d.id, v_url, p_message_id, d.title, v_body,
    v_hash, 'pending_rights_review',
    'Получено автоматическим мониторингом. Проверьте право на повторное использование до публикации.',
    'pending_review',
    jsonb_build_object('intake_method','mtproto_listener','message_date',p_message_date,'media',coalesce(p_media,'{}'::jsonb)),
    null
  )
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.telegram_content_items
    where donor_id=d.id and (source_message_id=p_message_id or content_hash=v_hash)
    order by created_at desc limit 1;
    return jsonb_build_object('id',v_id,'duplicate',true);
  end if;
  return jsonb_build_object('id',v_id,'duplicate',false);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_telegram_listener_donors(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_telegram_listener_post(text, uuid, text, text, timestamp with time zone, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_telegram_listener_donors(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ingest_telegram_listener_post(text, uuid, text, text, timestamp with time zone, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_telegram_listener_donors(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_telegram_listener_post(text, uuid, text, text, timestamp with time zone, jsonb) TO service_role;
