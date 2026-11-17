from fastapi import FastAPI

from app.ai import router as ai_router
from app.organizations import router as organizations_router
from app.settings import settings

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Foundation API for AI Seller Ecosystem.",
)

app.include_router(organizations_router)
app.include_router(ai_router)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version", tags=["system"])
async def version() -> dict[str, str]:
    return {"name": settings.app_name, "version": settings.app_version}
