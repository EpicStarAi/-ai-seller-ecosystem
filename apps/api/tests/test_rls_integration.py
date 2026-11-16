import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError


ADMIN_URL = os.getenv("TEST_DATABASE_ADMIN_URL")
RUNTIME_URL = os.getenv("TEST_DATABASE_URL")


@pytest.mark.skipif(
    not ADMIN_URL or not RUNTIME_URL,
    reason="Set TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL for PostgreSQL RLS tests",
)
def test_runtime_role_cannot_read_or_write_another_tenant():
    admin_engine = create_engine(ADMIN_URL)
    runtime_engine = create_engine(RUNTIME_URL)

    suffix = uuid.uuid4().hex
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    contact_a, contact_b = uuid.uuid4(), uuid.uuid4()

    try:
        with admin_engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO users (id, auth_subject) VALUES
                    (:user_a, :subject_a), (:user_b, :subject_b)
                """),
                {"user_a": user_a, "subject_a": f"rls-a-{suffix}",
                 "user_b": user_b, "subject_b": f"rls-b-{suffix}"},
            )
            conn.execute(
                text("""
                    INSERT INTO organizations (id, name, slug, created_by_user_id) VALUES
                    (:org_a, 'RLS Test A', :slug_a, :user_a),
                    (:org_b, 'RLS Test B', :slug_b, :user_b)
                """),
                {"org_a": org_a, "slug_a": f"rls-a-{suffix}",
                 "org_b": org_b, "slug_b": f"rls-b-{suffix}",
                 "user_a": user_a, "user_b": user_b},
            )
            conn.execute(
                text("""
                    INSERT INTO memberships (organization_id, user_id, role) VALUES
                    (:org_a, :user_a, 'owner'), (:org_b, :user_b, 'owner')
                """),
                {"org_a": org_a, "user_a": user_a, "org_b": org_b, "user_b": user_b},
            )
            conn.execute(
                text("""
                    INSERT INTO contacts (id, organization_id, external_ref, display_name) VALUES
                    (:contact_a, :org_a, :ref_a, 'Tenant A contact'),
                    (:contact_b, :org_b, :ref_b, 'Tenant B contact')
                """),
                {"contact_a": contact_a, "org_a": org_a, "ref_a": f"a-{suffix}",
                 "contact_b": contact_b, "org_b": org_b, "ref_b": f"b-{suffix}"},
            )

        with runtime_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.current_user_id', :v, true)"),
                         {"v": str(user_a)})
            conn.execute(text("SELECT set_config('app.current_org_id', :v, true)"),
                         {"v": str(org_a)})
            visible = conn.execute(
                text("SELECT id FROM contacts WHERE id IN (:a, :b)"),
                {"a": contact_a, "b": contact_b},
            ).scalars().all()
            assert visible == [contact_a]

        with pytest.raises(DBAPIError):
            with runtime_engine.begin() as conn:
                conn.execute(text("SELECT set_config('app.current_user_id', :v, true)"),
                             {"v": str(user_a)})
                conn.execute(text("SELECT set_config('app.current_org_id', :v, true)"),
                             {"v": str(org_a)})
                conn.execute(
                    text("""
                        INSERT INTO contacts (organization_id, external_ref, display_name)
                        VALUES (:other_org, :ref, 'Must be denied')
                    """),
                    {"other_org": org_b, "ref": f"forbidden-{suffix}"},
                )
    finally:
        # Clean fixtures with the privileged test connection, even after assertion failures.
        with admin_engine.begin() as conn:
            conn.execute(text("DELETE FROM contacts WHERE id IN (:a, :b)"),
                         {"a": contact_a, "b": contact_b})
            conn.execute(text("DELETE FROM memberships WHERE organization_id IN (:a, :b)"),
                         {"a": org_a, "b": org_b})
            conn.execute(text("DELETE FROM organizations WHERE id IN (:a, :b)"),
                         {"a": org_a, "b": org_b})
            conn.execute(text("DELETE FROM users WHERE id IN (:a, :b)"),
                         {"a": user_a, "b": user_b})
        admin_engine.dispose()
        runtime_engine.dispose()
