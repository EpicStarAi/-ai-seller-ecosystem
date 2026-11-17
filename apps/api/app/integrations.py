from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Principal, get_current_principal
from app.database import get_db, set_request_context
from app.settings import settings

router = APIRouter(prefix="/integrations", tags=["integrations"])
DbSession = Annotated[Session, Depends(get_db)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
PROVIDERS = {"telegram", "openai", "anthropic", "gemini"}


class ConnectRequest(BaseModel):
    secret: str = Field(min_length=12, max_length=8192)
    label: str | None = Field(default=None, max_length=120)


class IntegrationView(BaseModel):
    id: UUID
    provider: str
    label: str | None
    status: str
    external_account_id: str | None
    metadata: dict[str, Any]
    last_tested_at: Any | None
    created_at: Any


def _organization_id(raw: str | None) -> UUID:
    if not raw:
        raise HTTPException(400, "X-Organization-Id header is required")
    try:
        return UUID(raw)
    except ValueError as exc:
        raise HTTPException(400, "Invalid organization id") from exc


def _authorize(db: Session, principal: Principal, org_id: UUID) -> tuple[UUID, str]:
    set_request_context(db, auth_subject=principal.subject)
    user = db.execute(
        text("SELECT id FROM users WHERE auth_subject=:subject AND status='active'"),
        {"subject": principal.subject},
    ).mappings().first()
    if user is None:
        raise HTTPException(403, "User profile is not provisioned")
    user_id = user["id"]
    set_request_context(db, user_id=str(user_id), auth_subject=principal.subject,
                        organization_id=str(org_id))
    membership = db.execute(
        text("SELECT role FROM memberships WHERE organization_id=:org AND user_id=:user"),
        {"org": org_id, "user": user_id},
    ).mappings().first()
    if membership is None:
        raise HTTPException(403, "No access to this organization")
    return user_id, membership["role"]


def _require_admin(role: str) -> None:
    if role not in {"owner", "admin"}:
        raise HTTPException(403, "Owner or admin role required")


def _key() -> bytes:
    value = settings.integration_encryption_key.strip()
    if not value and settings.integration_encryption_key_file:
        try:
            value = Path(settings.integration_encryption_key_file).read_text(encoding="utf-8").strip()
        except OSError:
            value = ""
    if not value:
        raise HTTPException(503, "Integration secret storage is not configured")
    try:
        key = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise HTTPException(503, "Integration secret storage is not configured") from exc
    if len(key) != 32:
        raise HTTPException(503, "Integration secret storage is not configured")
    return key


def _encrypt(secret: str, org_id: UUID, provider: str) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)
    aad = f"{org_id}:{provider}:v1".encode()
    return nonce, AESGCM(_key()).encrypt(nonce, secret.encode(), aad)


def _decrypt(nonce: bytes, ciphertext: bytes, org_id: UUID, provider: str) -> str:
    aad = f"{org_id}:{provider}:v1".encode()
    return AESGCM(_key()).decrypt(nonce, ciphertext, aad).decode()


async def _verify(provider: str, secret: str) -> dict[str, Any]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}
    if provider == "telegram":
        if not re.fullmatch(r"\d{5,}:[A-Za-z0-9_-]{20,}", secret):
            raise HTTPException(422, "Telegram bot token format is invalid")
        url = f"https://api.telegram.org/bot{secret}/getMe"
    elif provider == "openai":
        url = "https://api.openai.com/v1/models"
        headers["Authorization"] = f"Bearer {secret}"
    elif provider == "anthropic":
        url = "https://api.anthropic.com/v1/models"
        headers.update({"x-api-key": secret, "anthropic-version": "2026-10-21"})
        params["limit"] = "100"
    elif provider == "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta/models"
        headers["x-goog-api-key"] = secret
        params["pageSize"] = "100"
    else:
        raise HTTPException(404, "Unsupported provider")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5),
                                     follow_redirects=False) as client:
            response = await client.get(url, headers=headers, params=params)
        if response.status_code in (401, 403):
            raise HTTPException(422, "Provider rejected the credential")
        if response.status_code >= 400:
            raise HTTPException(502, "Provider verification failed")
        data = response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Provider is temporarily unreachable") from exc

    if provider == "telegram":
        bot = data.get("result") or {}
        if not data.get("ok") or not bot.get("id"):
            raise HTTPException(422, "Telegram rejected the bot token")
        return {"external_id": str(bot["id"]),
                "label": bot.get("username") or bot.get("first_name") or "Telegram bot",
                "metadata": {"username": bot.get("username"), "bot": True}}
    if provider == "openai":
        return {"external_id": None, "label": "OpenAI API",
                "metadata": {"models_available": len(data.get("data") or [])}}
    if provider == "anthropic":
        return {"external_id": None, "label": "Anthropic Claude",
                "metadata": {"models_available": len(data.get("data") or [])}}
    return {"external_id": None, "label": "Google Gemini",
            "metadata": {"models_available": len(data.get("models") or [])}}


@router.get("", response_model=list[IntegrationView])
def list_integrations(
    db: DbSession, principal: CurrentPrincipal,
    organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
):
    org_id = _organization_id(organization_id)
    with db.begin():
        _authorize(db, principal, org_id)
        rows = db.execute(text("""
            SELECT id, kind AS provider, label, status, external_account_id,
                   metadata, last_tested_at, created_at
            FROM integrations WHERE organization_id=:org ORDER BY created_at DESC
        """), {"org": org_id}).mappings().all()
        return [IntegrationView(**dict(row)) for row in rows]


@router.put("/{provider}", response_model=IntegrationView)
async def connect_integration(
    provider: str, payload: ConnectRequest, db: DbSession, principal: CurrentPrincipal,
    organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
):
    provider = provider.lower()
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unsupported provider")
    org_id = _organization_id(organization_id)
    with db.begin():
        _, role = _authorize(db, principal, org_id)
        _require_admin(role)

    verified = await _verify(provider, payload.secret)
    nonce, ciphertext = _encrypt(payload.secret, org_id, provider)
    secret_id = uuid4()
    with db.begin():
        user_id, role = _authorize(db, principal, org_id)
        _require_admin(role)
        existing = db.execute(text("""
            SELECT id FROM integrations WHERE organization_id=:org AND kind=:provider
            ORDER BY created_at LIMIT 1
        """), {"org": org_id, "provider": provider}).mappings().first()
        if existing:
            integration_id = existing["id"]
            secret_row = db.execute(text("""
                INSERT INTO public.integration_secrets
                  (id, organization_id, integration_id, nonce, ciphertext, key_version)
                VALUES (:id, :org, :integration, :nonce, :ciphertext, 1)
                ON CONFLICT (integration_id) DO UPDATE
                  SET nonce=EXCLUDED.nonce, ciphertext=EXCLUDED.ciphertext,
                      key_version=1, updated_at=now()
                RETURNING id
            """), {"id": secret_id, "org": org_id, "integration": integration_id,
                   "nonce": nonce, "ciphertext": ciphertext}).mappings().one()
            row = db.execute(text("""
                UPDATE integrations SET external_account_id=:external_id,
                  secret_ref=:secret_ref, status='connected', label=:label,
                  metadata=CAST(:metadata AS jsonb), last_tested_at=now(), updated_at=now()
                WHERE id=:id
                RETURNING id, kind AS provider, label, status, external_account_id,
                          metadata, last_tested_at, created_at
            """), {"external_id": verified["external_id"], "secret_ref": str(secret_row["id"]),
                   "label": (payload.label or verified["label"]).strip()[:120],
                   "metadata": json.dumps(verified["metadata"]), "id": integration_id}).mappings().one()
        else:
            integration_id = uuid4()
            db.execute(text("""
                INSERT INTO integrations
                  (id, organization_id, kind, external_account_id, secret_ref, status,
                   label, metadata, last_tested_at, updated_at)
                VALUES (:id, :org, :provider, :external_id, :secret_ref, 'connected',
                        :label, CAST(:metadata AS jsonb), now(), now())
            """), {"id": integration_id, "org": org_id, "provider": provider,
                   "external_id": verified["external_id"], "secret_ref": str(secret_id),
                   "label": (payload.label or verified["label"]).strip()[:120],
                   "metadata": json.dumps(verified["metadata"])})
            db.execute(text("""
                INSERT INTO public.integration_secrets
                  (id, organization_id, integration_id, nonce, ciphertext, key_version)
                VALUES (:id, :org, :integration, :nonce, :ciphertext, 1)
            """), {"id": secret_id, "org": org_id, "integration": integration_id,
                   "nonce": nonce, "ciphertext": ciphertext})
            row = db.execute(text("""
                SELECT id, kind AS provider, label, status, external_account_id,
                       metadata, last_tested_at, created_at
                FROM integrations WHERE id=:id
            """), {"id": integration_id}).mappings().one()
        db.execute(text("""
            INSERT INTO audit_logs
              (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
            VALUES (:org, :user, 'integration.connected', 'integration', :id,
                    CAST(:metadata AS jsonb))
        """), {"org": org_id, "user": user_id, "id": integration_id,
               "metadata": json.dumps({"provider": provider})})
        return IntegrationView(**dict(row))


@router.post("/{provider}/test", response_model=IntegrationView)
async def test_integration(
    provider: str, db: DbSession, principal: CurrentPrincipal,
    organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
):
    provider = provider.lower()
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unsupported provider")
    org_id = _organization_id(organization_id)
    with db.begin():
        _authorize(db, principal, org_id)
        row = db.execute(text("""
            SELECT i.id, s.nonce, s.ciphertext FROM integrations i
            JOIN public.integration_secrets s ON s.integration_id=i.id
            WHERE i.organization_id=:org AND i.kind=:provider ORDER BY i.created_at LIMIT 1
        """), {"org": org_id, "provider": provider}).mappings().first()
        if row is None:
            raise HTTPException(404, "Integration is not connected")
        secret = _decrypt(row["nonce"], row["ciphertext"], org_id, provider)

    verified = await _verify(provider, secret)
    with db.begin():
        _authorize(db, principal, org_id)
        updated = db.execute(text("""
            UPDATE integrations SET status='connected', metadata=CAST(:metadata AS jsonb),
              last_tested_at=now(), updated_at=now()
            WHERE id=:id
            RETURNING id, kind AS provider, label, status, external_account_id,
                      metadata, last_tested_at, created_at
        """), {"metadata": json.dumps(verified["metadata"]), "id": row["id"]}).mappings().one()
        return IntegrationView(**dict(updated))


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_integration(
    provider: str, db: DbSession, principal: CurrentPrincipal,
    organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
):
    provider = provider.lower()
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unsupported provider")
    org_id = _organization_id(organization_id)
    with db.begin():
        user_id, role = _authorize(db, principal, org_id)
        _require_admin(role)
        row = db.execute(text("""
            SELECT id FROM integrations WHERE organization_id=:org AND kind=:provider
        """), {"org": org_id, "provider": provider}).mappings().first()
        if row is None:
            raise HTTPException(404, "Integration is not connected")
        db.execute(text("DELETE FROM integrations WHERE id=:id"), {"id": row["id"]})
        db.execute(text("""
            INSERT INTO audit_logs
              (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
            VALUES (:org, :user, 'integration.disconnected', 'integration', :id,
                    CAST(:metadata AS jsonb))
        """), {"org": org_id, "user": user_id, "id": row["id"],
               "metadata": json.dumps({"provider": provider})})
