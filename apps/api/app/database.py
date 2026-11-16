from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.settings import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def set_request_context(
    session: Session,
    *,
    user_id: str | None = None,
    auth_subject: str | None = None,
    organization_id: str | None = None,
) -> None:
    """Set transaction-local values consumed by PostgreSQL RLS policies."""
    values = {
        "app.current_user_id": user_id or "",
        "app.current_auth_subject": auth_subject or "",
        "app.current_org_id": organization_id or "",
    }
    for key, value in values.items():
        session.execute(
            text("SELECT set_config(:setting_name, :setting_value, true)"),
            {"setting_name": key, "setting_value": value},
        )
