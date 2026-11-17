from collections.abc import Sequence
from typing import Annotated, Literal

from anthropic import APIConnectionError, APIStatusError, AsyncAnthropic, AuthenticationError, RateLimitError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import Principal, get_current_principal
from app.settings import settings

router = APIRouter(prefix="/ai/claude", tags=["ai", "claude"])

SUPPORTED_MODELS = {
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class ClaudeChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)
    model: str = Field(default=settings.claude_default_model, min_length=1, max_length=100)
    system: str | None = Field(default=None, max_length=8_000)
    max_tokens: int = Field(default=2_048, ge=1, le=8_192)


class ClaudeChatResponse(BaseModel):
    id: str
    model: str
    text: str
    input_tokens: int
    output_tokens: int


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]


def get_anthropic_client() -> AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Claude provider is not configured",
        )
    return AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=1, timeout=60.0)


@router.get("/status")
async def claude_status(_: CurrentPrincipal) -> dict[str, object]:
    return {
        "provider": "anthropic",
        "configured": bool(settings.anthropic_api_key),
        "default_model": settings.claude_default_model,
        "available_models": sorted(SUPPORTED_MODELS),
    }


@router.post("/chat", response_model=ClaudeChatResponse)
async def claude_chat(payload: ClaudeChatRequest, _: CurrentPrincipal):
    if payload.model not in SUPPORTED_MODELS:
        raise HTTPException(status_code=422, detail="Unsupported Claude model")
    client = get_anthropic_client()
    kwargs: dict[str, object] = {
        "model": payload.model,
        "max_tokens": payload.max_tokens,
        "messages": [message.model_dump() for message in payload.messages],
    }
    if payload.system:
        kwargs["system"] = payload.system

    try:
        response = await client.messages.create(**kwargs)
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail="Claude rate limit reached") from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=503, detail="Claude provider credentials were rejected") from exc
    except APIConnectionError as exc:
        raise HTTPException(status_code=503, detail="Claude provider is temporarily unreachable") from exc
    except APIStatusError as exc:
        raise HTTPException(status_code=502, detail="Claude provider request failed") from exc

    text_parts: Sequence[str] = [
        block.text for block in response.content if getattr(block, "type", None) == "text"
    ]
    return ClaudeChatResponse(
        id=response.id,
        model=response.model,
        text="".join(text_parts),
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
