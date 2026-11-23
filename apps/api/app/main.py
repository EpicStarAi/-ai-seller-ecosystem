from fastapi import FastAPI

from app.settings import settings

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Foundation API for AI Seller Ecosystem.",
)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version", tags=["system"])
async def version() -> dict[str, str]:
    return {"name": settings.app_name, "version": settings.app_version}
