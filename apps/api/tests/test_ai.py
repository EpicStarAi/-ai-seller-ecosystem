from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai import get_anthropic_client
from app.auth import Principal, get_current_principal
from app.main import app

client = TestClient(app)


class FakeMessages:
    async def create(self, **kwargs):
        assert kwargs["model"] == "claude-sonnet-5-5"
        assert kwargs["max_tokens"] == 256
        return SimpleNamespace(
            id="msg_test",
            model="claude-sonnet-5-5",
            content=[SimpleNamespace(type="text", text="Hello from Claude")],
            usage=SimpleNamespace(input_tokens=12, output_tokens=7),
        )


class FakeAnthropic:
    messages = FakeMessages()


@pytest.fixture(autouse=True)
def auth_override():
    app.dependency_overrides[get_current_principal] = lambda: Principal(subject="test-user")
    yield
    app.dependency_overrides.clear()


def test_claude_status_does_not_expose_api_key(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai.settings, "anthropic_api_key", "secret-test-value")
    response = client.get("/ai/claude/status")
    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert "secret-test-value" not in response.text


def test_claude_chat_uses_provider_and_returns_usage(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai.settings, "anthropic_api_key", "secret-test-value")
    monkeypatch.setattr(ai, "get_anthropic_client", lambda: FakeAnthropic())
    response = client.post(
        "/ai/claude/chat",
        json={
            "model": "claude-sonnet-5-5",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": "Hello"}],
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": "msg_test",
        "model": "claude-sonnet-5-5",
        "text": "Hello from Claude",
        "input_tokens": 12,
        "output_tokens": 7,
    }


def test_claude_chat_rejects_unapproved_model(monkeypatch):
    from app import ai

    monkeypatch.setattr(ai.settings, "anthropic_api_key", "secret-test-value")
    response = client.post(
        "/ai/claude/chat",
        json={
            "model": "unknown-model",
            "messages": [{"role": "user", "content": "Hello"}],
        },
    )
    assert response.status_code == 422
