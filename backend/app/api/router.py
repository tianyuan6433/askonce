from fastapi import APIRouter
from app.api import ask, knowledge, stats, settings, channels

api_router = APIRouter()

api_router.include_router(ask.router, prefix="/ask", tags=["ask"])
api_router.include_router(knowledge.router, prefix="/knowledge", tags=["knowledge"])
api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(channels.router, prefix="/channels", tags=["channels"])
