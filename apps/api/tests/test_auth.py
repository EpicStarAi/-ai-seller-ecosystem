import pytest
from fastapi import HTTPException

from app.auth import Principal, verify_access_token


def test_principal_is_immutable():
    principal = Principal(subject="oidc|user-1", email="user@example.com")
    assert principal.subject == "oidc|user-1"
    with pytest.raises((AttributeError, TypeError)):
        principal.subject = "other"  # type: ignore[misc]


def test_auth_fails_closed_when_oidc_is_not_configured(monkeypatch):
    from app import auth

    monkeypatch.setattr(auth.settings, "auth_jwks_url", "")
    monkeypatch.setattr(auth.settings, "auth_issuer", "")
    monkeypatch.setattr(auth.settings, "auth_audience", "")
    with pytest.raises(HTTPException) as error:
        verify_access_token("not-a-real-token")
    assert error.value.status_code == 503
