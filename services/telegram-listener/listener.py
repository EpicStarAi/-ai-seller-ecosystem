#!/opt/ai-seller-telegram/venv/bin/python
import asyncio
import getpass
import json
import logging
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient, events, utils
from telethon.errors import (
    ChannelInvalidError,
    ChannelPrivateError,
    ChatIdInvalidError,
    FloodWaitError,
    PeerIdInvalidError,
    SessionPasswordNeededError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)
from telethon.tl.types import (
    DocumentAttributeAnimated,
    DocumentAttributeFilename,
    DocumentAttributeVideo,
    MessageMediaDocument,
    MessageMediaPhoto,
)

ENV_FILE = Path("/etc/ai-seller-telegram-listener.env")
def load_env():
    for line in ENV_FILE.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value=line.split("=",1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env()
API_ID=int(os.environ["TELEGRAM_API_ID"])
API_HASH=os.environ["TELEGRAM_API_HASH"]
SUPABASE_URL=os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY","").strip()
if not SERVICE_ROLE_KEY:
    raise SystemExit("Missing SUPABASE_SERVICE_ROLE_KEY")
SHARED_SECRET=os.environ["INGEST_SHARED_SECRET"]
SESSION=os.environ.get("TELEGRAM_SESSION","/var/lib/ai-seller-telegram-listener/session")
POLL=int(os.environ.get("POLL_INTERVAL_SECONDS","60"))
CACHE_PATH=Path(os.environ.get("TG_ENTITY_CACHE","/var/lib/ai-seller-telegram-listener/entity-cache.json"))
DONOR_REFRESH_SECONDS=max(60, int(os.environ.get("DONOR_REFRESH_SECONDS", "300")))
MEDIA_ROOT=Path(os.environ.get("TG_MEDIA_ROOT","/var/lib/ai-seller-telegram-listener/media"))
MAX_PHOTO_BYTES=10*1024*1024
MAX_VIDEO_BYTES=50*1024*1024
MAX_ALBUM_ITEMS=10
MAX_TOTAL_BYTES=80*1024*1024
DONOR_SKIP_ERRORS=(
    ChannelPrivateError,
    ChannelInvalidError,
    ChatIdInvalidError,
    PeerIdInvalidError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log=logging.getLogger("telegram-donor-listener")

def rpc(name, payload):
    url=f"{SUPABASE_URL}/rest/v1/rpc/{name}"
    data=json.dumps(payload,ensure_ascii=False).encode()
    req=urllib.request.Request(url,data=data,method="POST",headers={
        "apikey":SERVICE_ROLE_KEY,
        "Authorization":f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type":"application/json",
        "Accept":"application/json",
    })
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            raw=response.read()
            return json.loads(raw.decode()) if raw else None
    except urllib.error.HTTPError as exc:
        detail=exc.read().decode(errors="replace")[:1000]
        raise RuntimeError(f"Supabase RPC {name} HTTP {exc.code}: {detail}") from exc

def list_donors():
    result=rpc("list_telegram_listener_donors",{"p_secret":SHARED_SECRET})
    if not isinstance(result,list):
        raise RuntimeError("Unexpected donor list response")
    return result

def media_metadata(message):
    media=message.media
    if not media:
        return {}
    result={"present":True}
    if isinstance(media,MessageMediaPhoto):
        result["type"]="photo"
        if media.photo:
            result["id"]=str(media.photo.id)
    elif isinstance(media,MessageMediaDocument):
        result["type"]="document"
        doc=media.document
        if doc:
            result["id"]=str(doc.id)
            result["mime_type"]=doc.mime_type
            result["size_bytes"]=doc.size
            result["attributes"]=[type(a).__name__ for a in doc.attributes]
    else:
        result["type"]=type(media).__name__
    return result

def _ensure_media_root():
    MEDIA_ROOT.mkdir(parents=True,exist_ok=True)
    tmp=MEDIA_ROOT/"tmp"
    tmp.mkdir(parents=True,exist_ok=True)
    try:
        os.chmod(MEDIA_ROOT,0o750)
        os.chmod(tmp,0o750)
    except PermissionError:
        pass

def _message_size(message):
    media=message.media
    if isinstance(media,MessageMediaDocument) and media.document and media.document.size:
        return int(media.document.size)
    file=getattr(message,"file",None)
    size=getattr(file,"size",None) if file is not None else None
    return int(size) if size else 0

def _classify_media(message):
    media=message.media
    if isinstance(media,MessageMediaPhoto):
        return "photo",".jpg","image/jpeg",_message_size(message)
    if not isinstance(media,MessageMediaDocument) or not media.document:
        return None,None,None,_message_size(message)
    doc=media.document
    mime=(doc.mime_type or "").lower()
    attrs=list(doc.attributes or [])
    is_video=any(isinstance(a,DocumentAttributeVideo) for a in attrs)
    is_animated=any(isinstance(a,DocumentAttributeAnimated) for a in attrs)
    name=""
    for a in attrs:
        if isinstance(a,DocumentAttributeFilename) and a.file_name:
            name=a.file_name.lower()
    if mime.startswith("image/") and mime in {"image/jpeg","image/jpg","image/png","image/webp"} and not is_video:
        ext={ "image/jpeg":".jpg","image/jpg":".jpg","image/png":".png","image/webp":".webp"}[mime]
        return "photo",ext,mime,_message_size(message)
    if (is_video and not is_animated) or mime in {"video/mp4","video/quicktime"}:
        ext=".mp4" if not name.endswith(".mov") else ".mov"
        if mime=="video/quicktime":
            ext=".mov"
        return "video",ext,mime or "video/mp4",_message_size(message)
    return None,None,mime,_message_size(message)

async def collect_message_media(client, donor_id, message_id, messages):
    """Download photo/video (and album items) under MEDIA_ROOT. Never follows user-controlled paths."""
    _ensure_media_root()
    items=[]
    skipped=[]
    total=0
    dest_dir=MEDIA_ROOT/str(donor_id)/str(message_id)
    dest_dir.mkdir(parents=True,exist_ok=True)
    try:
        os.chmod(dest_dir,0o750)
        os.chmod(dest_dir.parent,0o750)
    except PermissionError:
        pass
    for raw in messages[:MAX_ALBUM_ITEMS]:
        kind,ext,mime,size=_classify_media(raw)
        if not kind:
            skipped.append({"reason":"unsupported_type","mime":mime,"size_bytes":size})
            continue
        limit=MAX_PHOTO_BYTES if kind=="photo" else MAX_VIDEO_BYTES
        if size and size>limit:
            skipped.append({"reason":"too_large","kind":kind,"size_bytes":size})
            continue
        if total+size>MAX_TOTAL_BYTES and size:
            skipped.append({"reason":"album_too_large","kind":kind,"size_bytes":size})
            continue
        filename=f"{len(items)}{ext}"
        dest=dest_dir/filename
        tmp=MEDIA_ROOT/"tmp"/f"{donor_id}-{message_id}-{filename}"
        try:
            path=await _retry_flood(
                f"download media message={getattr(raw,'id',message_id)}",
                lambda t=tmp, m=raw: m.download_media(file=str(t)),
            )
            if not path:
                skipped.append({"reason":"download_failed","kind":kind})
                continue
            tmp_path=Path(path)
            actual=tmp_path.stat().st_size
            limit=MAX_PHOTO_BYTES if kind=="photo" else MAX_VIDEO_BYTES
            if actual>limit or total+actual>MAX_TOTAL_BYTES:
                tmp_path.unlink(missing_ok=True)
                skipped.append({"reason":"too_large","kind":kind,"size_bytes":actual})
                continue
            os.replace(tmp_path,dest)
            os.chmod(dest,0o640)
            relpath=f"{donor_id}/{message_id}/{filename}"
            items.append({"kind":kind,"mime":mime or ("image/jpeg" if kind=="photo" else "video/mp4"),"bytes":actual,"relpath":relpath})
            total+=actual
        except Exception as exc:
            log.info("Media download skipped donor=%s message=%s: %s",donor_id,message_id,type(exc).__name__)
            skipped.append({"reason":"download_error","kind":kind or "unknown"})
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass
    if len(messages)>MAX_ALBUM_ITEMS:
        skipped.append({"reason":"album_truncated","count":len(messages)-MAX_ALBUM_ITEMS})
    result={"present":bool(items or skipped),"grouped":len(messages)>1,"items":items}
    if skipped:
        result["skipped"]=skipped
    return result

def _describe_sent_code(sent):
    typ = type(sent.type).__name__ if getattr(sent, "type", None) is not None else "unknown"
    nxt = type(sent.next_type).__name__ if getattr(sent, "next_type", None) is not None else "none"
    print(f"Login code delivery: {typ}")
    print(f"next_type: {nxt}")
    hints = {
        "SentCodeTypeApp": "The code was sent to the official Telegram chat (account named Telegram / service notifications), not by SMS. Open that chat. Some phone notifications hide the digits.",
        "SentCodeTypeSms": "The code was sent by SMS to the phone number.",
        "SentCodeTypeSmsWord": "Telegram sent a WORD, not a numeric code. Enter that word.",
        "SentCodeTypeSmsPhrase": "Telegram sent a PHRASE, not a numeric code. Enter that phrase.",
        "SentCodeTypeCall": "Telegram will call the number with the code.",
        "SentCodeTypeFlashCall": "Telegram will place a flash call; use the calling number as instructed.",
        "SentCodeTypeMissedCall": "Telegram will place a missed call; use the calling number as instructed.",
        "SentCodeTypeEmailCode": "The code was sent by email.",
        "SentCodeTypeSetUpEmailRequired": "Telegram is asking to set up or verify an email before sending a code.",
        "SentCodeTypeFragmentSms": "The code was sent via Fragment SMS.",
        "SentCodeTypeFirebaseSms": "The code was sent via Firebase SMS.",
    }
    if typ in hints:
        print(hints[typ])
    else:
        print("Enter exactly what Telegram sent (digits, a word, or a phrase).")

async def authenticate():
    client=TelegramClient(SESSION,API_ID,API_HASH)
    await client.connect()
    if await client.is_user_authorized():
        me=await client.get_me()
        print(f"AUTHORIZED: user_id={me.id}, username=@{me.username or ''}")
        await client.disconnect()
        return
    phone=input("Telegram phone number (international format): ").strip()
    if not phone:
        raise SystemExit("Phone number is required")
    sent=await client.send_code_request(phone)
    _describe_sent_code(sent)
    from telethon.errors import PhoneCodeInvalidError, PhoneCodeExpiredError, FloodWaitError
    while True:
        raw=input("Login code (or 'sms' to resend via the next method, 'abort' to exit): ").strip()
        if not raw:
            continue
        lowered=raw.lower()
        if lowered in ("abort", "exit", "quit"):
            await client.disconnect()
            raise SystemExit("Auth cancelled")
        if lowered in ("sms", "resend"):
            # force_sms is deprecated in Telethon 1.46 and is ignored on the first request.
            # A second send_code_request uses auth.ResendCodeRequest (next delivery method).
            try:
                sent=await client.send_code_request(phone)
            except FloodWaitError as exc:
                print(f"Telegram asked to wait {getattr(exc, 'seconds', '?')} seconds before resending.")
                continue
            _describe_sent_code(sent)
            continue
        try:
            await client.sign_in(phone=phone,code=raw,phone_code_hash=sent.phone_code_hash)
            break
        except PhoneCodeInvalidError:
            print("That code/word was not accepted. Try again, or type 'sms' to resend.")
            continue
        except PhoneCodeExpiredError:
            print("That code expired. Type 'sms' to request a new one, or 'abort' to exit.")
            continue
        except SessionPasswordNeededError:
            password=getpass.getpass("Telegram 2FA password: ")
            await client.sign_in(password=password)
            break
    me=await client.get_me()
    os.chmod(SESSION+".session",0o600)
    print(f"AUTHORIZED: user_id={me.id}, username=@{me.username or ''}")
    await client.disconnect()

async def _sleep_flood(exc, context):
    seconds=int(getattr(exc,"seconds",1) or 1)
    wait=seconds+random.uniform(0.5,2.5)
    log.warning("FloodWait %ss (sleeping %.1fs) during %s",seconds,wait,context)
    await asyncio.sleep(wait)

async def _retry_flood(context, factory):
    while True:
        try:
            return await factory()
        except FloodWaitError as exc:
            await _sleep_flood(exc,context)

def _donor_username(row):
    return (row.get("username") or "").lstrip("@")

def _donor_identity(row):
    return {"username":_donor_username(row),"chat_id":str(row["chat_id"])}

def _load_entity_cache():
    try:
        data=json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        log.warning("Ignoring unreadable entity cache")
        return {}
    entities=data.get("entities") if isinstance(data,dict) and data.get("version")==1 else None
    return entities if isinstance(entities,dict) else {}

def _save_entity_cache(entities):
    tmp=CACHE_PATH.with_name(CACHE_PATH.name+".tmp")
    payload=json.dumps({"version":1,"entities":entities},ensure_ascii=False,separators=(",",":"))
    tmp.write_text(payload,encoding="utf-8")
    os.chmod(tmp,0o600)
    os.replace(tmp,CACHE_PATH)
    os.chmod(CACHE_PATH,0o600)

def _cache_entry_matches(entry,row):
    if not isinstance(entry,dict) or entry.get("peer_id") is None:
        return False
    ident=_donor_identity(row)
    return str(entry.get("username") or "")==ident["username"] and str(entry.get("chat_id") or "")==ident["chat_id"]

def _entity_to_cache(row,entity):
    ident=_donor_identity(row)
    return {
        "username":ident["username"],
        "chat_id":ident["chat_id"],
        "peer_id":utils.get_peer_id(entity),
        "access_hash":getattr(entity,"access_hash",None),
    }

async def run_listener():
    client=TelegramClient(
        SESSION,API_ID,API_HASH,
        request_retries=5,connection_retries=10,auto_reconnect=True,
        flood_sleep_threshold=0,
    )
    await client.connect()
    if not await client.is_user_authorized():
        raise SystemExit("Telegram session is not authorized. Run: listener.py auth-qr")
    os.chmod(SESSION+".session",0o600)
    me=await client.get_me()
    log.info("Telegram user client connected: user_id=%s",me.id)
    log.info("Donor RPC refresh interval=%ss (POLL_INTERVAL_SECONDS=%s)",DONOR_REFRESH_SECONDS,POLL)

    donor_by_peer={}
    cached_entities=_load_entity_cache()
    unresolvable={}
    new_message_event=events.NewMessage(chats=set(),incoming=True)
    album_event=events.Album(chats=set())

    def _sync_watched():
        # Reassign after Telethon resolve(), which replaces the chats set once.
        watched=set(donor_by_peer)
        new_message_event.chats=watched
        album_event.chats=watched

    async def _resolve_entity(donor_id,username,chat_id):
        if username:
            return await _retry_flood(
                f"resolve donor={donor_id}",
                lambda u=username: client.get_entity(u),
            )
        wanted=int(chat_id)
        try:
            return await _retry_flood(
                f"resolve donor={donor_id}",
                lambda w=wanted: client.get_entity(w),
            )
        except DONOR_SKIP_ERRORS:
            raise
        except (ValueError,TypeError):
            pass
        except Exception as exc:
            log.info("get_entity failed for donor=%s, scanning dialogs: %s",donor_id,type(exc).__name__)
        log.info("Scanning dialogs to resolve donor=%s",donor_id)
        try:
            async for dialog in client.iter_dialogs():
                if utils.get_peer_id(dialog.entity)==wanted:
                    return dialog.entity
        except FloodWaitError as exc:
            await _sleep_flood(exc,f"iter_dialogs donor={donor_id}")
            raise
        return None

    async def refresh_donors():
        nonlocal donor_by_peer,cached_entities
        rows=await asyncio.to_thread(list_donors)
        next_map={}
        next_cache={}
        for row in rows:
            donor_id=str(row["id"])
            ident=_donor_identity(row)
            ident_key=(ident["username"],ident["chat_id"])
            prev=unresolvable.get(donor_id)
            if prev==ident_key:
                continue
            if prev is not None:
                unresolvable.pop(donor_id,None)

            entry=cached_entities.get(donor_id)
            if _cache_entry_matches(entry,row):
                next_map[int(entry["peer_id"])]=row
                next_cache[donor_id]=entry
                continue
            try:
                entity=await _resolve_entity(donor_id,ident["username"],ident["chat_id"])
                if entity is None:
                    log.warning("Donor unavailable to authorized Telegram account: donor_id=%s chat_id=%s",donor_id,ident["chat_id"])
                    unresolvable[donor_id]=ident_key
                    continue
                entry=_entity_to_cache(row,entity)
                next_map[int(entry["peer_id"])]=row
                next_cache[donor_id]=entry
            except FloodWaitError as exc:
                await _sleep_flood(exc,f"resolve donor={donor_id}")
                if _cache_entry_matches(entry,row):
                    next_map[int(entry["peer_id"])]=row
                    next_cache[donor_id]=entry
            except DONOR_SKIP_ERRORS as exc:
                log.warning("Skipping donor %s (%s): %s",donor_id,ident["chat_id"],type(exc).__name__)
                unresolvable[donor_id]=ident_key
            except Exception as exc:
                log.warning("Cannot resolve donor %s (%s): %s",donor_id,ident["chat_id"],str(exc)[:300])
        donor_by_peer=next_map
        cached_entities=next_cache
        _sync_watched()
        try:
            _save_entity_cache(cached_entities)
        except Exception:
            log.exception("Failed to write entity cache")
        log.info("Donor registry refreshed: configured=%d accessible=%d",len(rows),len(next_map))

    await refresh_donors()

    async def _ingest_messages(donor, messages):
        first=messages[0]
        body="\n\n".join((m.message or "").strip() for m in messages if (m.message or "").strip())
        media=await collect_message_media(client,donor["id"],str(first.id),messages)
        result=await asyncio.to_thread(rpc,"ingest_telegram_listener_post",{
            "p_secret":SHARED_SECRET,
            "p_donor_id":donor["id"],
            "p_message_id":str(first.id),
            "p_message_text":body,
            "p_message_date":first.date.astimezone(timezone.utc).isoformat() if first.date else datetime.now(timezone.utc).isoformat(),
            "p_media":media,
        })
        if result and result.get("duplicate"):
            log.info("Duplicate skipped donor=%s message=%s",donor["id"],first.id)
        else:
            log.info("New donor post queued donor=%s message=%s media_items=%s",donor["id"],first.id,len(media.get("items") or []))

    @client.on(new_message_event)
    async def on_new_message(event):
        try:
            message=event.message
            if not getattr(message,"post",False):
                return
            if getattr(message,"grouped_id",None):
                return
            peer_id=utils.get_peer_id(message.peer_id)
            donor=donor_by_peer.get(peer_id)
            if not donor:
                return
            try:
                await _ingest_messages(donor,[message])
            except Exception:
                log.exception("Failed to ingest donor post donor=%s message=%s",donor["id"],message.id)
        except FloodWaitError as exc:
            await _sleep_flood(exc,"new message handler")
        except Exception:
            log.exception("Failed to handle incoming message")

    @client.on(album_event)
    async def on_album(event):
        try:
            messages=list(event.messages or [])
            if not messages:
                return
            if not any(getattr(m,"post",False) for m in messages):
                return
            peer_id=utils.get_peer_id(messages[0].peer_id)
            donor=donor_by_peer.get(peer_id)
            if not donor:
                return
            try:
                await _ingest_messages(donor,messages)
            except Exception:
                log.exception("Failed to ingest donor album donor=%s message=%s",donor["id"],messages[0].id)
        except FloodWaitError as exc:
            await _sleep_flood(exc,"album handler")
        except Exception:
            log.exception("Failed to handle incoming album")

    while True:
        await asyncio.sleep(DONOR_REFRESH_SECONDS+random.uniform(0,20))
        try:
            await refresh_donors()
        except FloodWaitError as exc:
            await _sleep_flood(exc,"donor refresh")
        except Exception:
            log.exception("Donor refresh failed; retaining last working donor registry")

def _print_login_qr(url, png_path=None):
    # Render only the QR. Do not print the login URL or token.
    import qrcode
    qr = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
    if png_path:
        img = qr.make_image(fill_color="black", back_color="white")
        tmp = png_path + ".tmp"
        img.save(tmp, "PNG")
        os.chmod(tmp, 0o600)
        os.replace(tmp, png_path)
        os.chmod(png_path, 0o600)

def _read_2fa_secret(path, timeout=300):
    import stat
    import time as _time
    print(f"2FA required. Waiting up to {int(timeout)}s for a password at {path} (one line; file or fifo). The file will be deleted after it is read.")
    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        if os.path.exists(path):
            try:
                st = os.stat(path)
                if stat.S_ISFIFO(st.st_mode):
                    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                    try:
                        data = os.read(fd, 4096).decode("utf-8", "replace").strip()
                    finally:
                        os.close(fd)
                    if data:
                        return data
                else:
                    raw = Path(path).read_text(encoding="utf-8", errors="replace").strip()
                    if raw:
                        try:
                            os.remove(path)
                        except OSError:
                            pass
                        return raw
            except OSError:
                pass
        _time.sleep(0.4)
    raise SystemExit("Timed out waiting for 2FA password")

async def authenticate_qr():
    png_path = os.environ.get("TG_QR_PNG", "/var/lib/ai-seller-telegram-listener/qr.png")
    twofa_path = os.environ.get("TG_QR_2FA", "/var/lib/ai-seller-telegram-listener/2fa.password")
    deadline = datetime.now(timezone.utc).timestamp() + float(os.environ.get("TG_QR_MAX_SECONDS", "300"))

    def _cleanup_qr():
        for path in (png_path, png_path + ".tmp"):
            try:
                os.remove(path)
            except OSError:
                pass

    client=TelegramClient(SESSION,API_ID,API_HASH)
    await client.connect()
    if await client.is_user_authorized():
        me=await client.get_me()
        print(f"AUTHORIZED: user_id={me.id}")
        await client.disconnect()
        return
    print("Scan this QR in Telegram on your phone (Settings -> Devices -> Link Desktop Device).")
    print("The picture will refresh if it expires. Do not share a screenshot of it.")
    qr=await client.qr_login()
    try:
        while True:
            _print_login_qr(qr.url, png_path=png_path)
            print("QR image ready")
            remaining = deadline - datetime.now(timezone.utc).timestamp()
            if remaining <= 0:
                raise SystemExit("QR login window ended. Run auth-qr again.")
            timeout=30.0
            expires=getattr(qr, "expires", None)
            if expires is not None:
                timeout=(expires - datetime.now(timezone.utc)).total_seconds() - 1
            timeout=max(5.0, min(timeout, remaining))
            try:
                await qr.wait(timeout=timeout)
                break
            except asyncio.TimeoutError:
                remaining = deadline - datetime.now(timezone.utc).timestamp()
                if remaining <= 8:
                    raise SystemExit("QR login window ended. Run auth-qr again.")
                print("QR timed out; generating a new one...")
                await qr.recreate()
            except SessionPasswordNeededError:
                password=_read_2fa_secret(twofa_path, timeout=max(30, deadline - datetime.now(timezone.utc).timestamp()))
                await client.sign_in(password=password)
                break
        me=await client.get_me()
        os.chmod(SESSION+".session",0o600)
        print(f"AUTHORIZED: user_id={me.id}")
        await client.disconnect()
    finally:
        _cleanup_qr()

async def main():
    if len(sys.argv)>1 and sys.argv[1]=="auth":
        await authenticate()
    elif len(sys.argv)>1 and sys.argv[1]=="auth-qr":
        await authenticate_qr()
    elif len(sys.argv)>1 and sys.argv[1]=="check":
        rows=await asyncio.to_thread(list_donors)
        print(f"RPC_OK donors={len(rows)}")
    else:
        await run_listener()

if __name__=="__main__":
    asyncio.run(main())
