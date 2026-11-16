from app.auth import require_roles


def test_role_allowlist_accepts_owner():
    assert require_roles("owner", "admin")("owner") == "owner"


def test_role_allowlist_rejects_operator():
    from fastapi import HTTPException
    import pytest

    with pytest.raises(HTTPException) as error:
        require_roles("owner", "admin")("operator")
    assert error.value.status_code == 403
