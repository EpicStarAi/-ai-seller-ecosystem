from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Principal, get_current_principal
from app.database import get_db, set_request_context
from app.schemas import OrganizationCreate, OrganizationRead

router = APIRouter(prefix="/organizations", tags=["organizations"])
DbSession = Annotated[Session, Depends(get_db)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]


def _upsert_user(session: Session, principal: Principal) -> str:
    row = session.execute(
        text("""
            INSERT INTO users (auth_subject, email, display_name)
            VALUES (:subject, :email, :display_name)
            ON CONFLICT (auth_subject) DO UPDATE
              SET email = COALESCE(EXCLUDED.email, users.email),
                  display_name = COALESCE(EXCLUDED.display_name, users.display_name)
            RETURNING id
        """),
        {
            "subject": principal.subject,
            "email": principal.email,
            "display_name": principal.display_name,
        },
    ).mappings().one()
    return str(row["id"])


@router.get("", response_model=list[OrganizationRead])
def list_organizations(db: DbSession, principal: CurrentPrincipal):
    with db.begin():
        set_request_context(db, auth_subject=principal.subject)
        user = db.execute(
            text("SELECT id FROM users WHERE auth_subject = :subject AND status = 'active'"),
            {"subject": principal.subject},
        ).mappings().first()
        if user is None:
            return []
        set_request_context(db, user_id=str(user["id"]), auth_subject=principal.subject)
        rows = db.execute(
            text("""
                SELECT o.id, o.name, o.slug, m.role
                FROM organizations o
                JOIN memberships m ON m.organization_id = o.id
                WHERE m.user_id = :user_id AND o.status = 'active'
                ORDER BY o.created_at
            """),
            {"user_id": user["id"]},
        ).mappings().all()
        return [OrganizationRead(**dict(row)) for row in rows]


@router.post("", response_model=OrganizationRead, status_code=status.HTTP_201_CREATED)
def create_organization(payload: OrganizationCreate, db: DbSession, principal: CurrentPrincipal):
    try:
        with db.begin():
            set_request_context(db, auth_subject=principal.subject)
            user_id = _upsert_user(db, principal)
            set_request_context(db, user_id=user_id, auth_subject=principal.subject)
            organization = db.execute(
                text("""
                    INSERT INTO organizations (name, slug, created_by_user_id)
                    VALUES (:name, :slug, :user_id)
                    RETURNING id, name, slug
                """),
                {"name": payload.name, "slug": payload.slug, "user_id": user_id},
            ).mappings().one()
            organization_id = str(organization["id"])
            set_request_context(
                db,
                user_id=user_id,
                auth_subject=principal.subject,
                organization_id=organization_id,
            )
            db.execute(
                text("""
                    INSERT INTO memberships (organization_id, user_id, role)
                    VALUES (:organization_id, :user_id, 'owner')
                """),
                {"organization_id": organization_id, "user_id": user_id},
            )
            db.execute(
                text("""
                    INSERT INTO audit_logs
                      (organization_id, actor_user_id, action, resource_type, resource_id)
                    VALUES (:organization_id, :user_id, 'organization.created',
                            'organization', :organization_id)
                """),
                {"organization_id": organization_id, "user_id": user_id},
            )
        return OrganizationRead(**dict(organization), role="owner")
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Organization slug is already in use") from exc
