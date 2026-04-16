from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import shutil
from pathlib import Path

from app.config import settings
from app.api.router import api_router
from app.db.database import init_db

logger = logging.getLogger("uvicorn.error")


def seed_database_if_needed():
    """Always overwrite database with seed.db to ensure latest data."""
    db_path = settings.database_url.split("///")[-1]
    seed_path = Path(__file__).parent.parent / "seed" / "seed.db"

    logger.warning(f"[seed] db_path={os.path.abspath(db_path)}, seed exists={seed_path.exists()}")

    if not seed_path.exists():
        logger.warning("[seed] No seed.db found, skipping")
        return

    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    shutil.copy2(str(seed_path), db_path)
    logger.warning(f"[seed] Force copied seed.db -> {db_path} (size={os.path.getsize(db_path)})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    seed_database_if_needed()
    await init_db()
    os.makedirs(settings.upload_dir, exist_ok=True)
    yield
    # Shutdown


app = FastAPI(
    title=settings.app_name,
    description="AI-powered smart reply system with living knowledge base",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

# Serve uploaded files
app.mount("/uploads", StaticFiles(directory=settings.upload_dir, check_dir=False), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": settings.app_name}
