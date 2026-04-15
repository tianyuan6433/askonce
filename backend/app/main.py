from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil
from pathlib import Path

from app.config import settings
from app.api.router import api_router
from app.db.database import init_db


def seed_database_if_needed():
    """Copy seed.db to the database path if no database exists or database is empty."""
    import sqlite3
    db_path = settings.database_url.split("///")[-1]
    seed_path = Path(__file__).parent.parent / "seed" / "seed.db"

    print(f"[seed] db_path={db_path}, abs={os.path.abspath(db_path)}")
    print(f"[seed] seed_path={seed_path}, exists={seed_path.exists()}")
    print(f"[seed] db exists={os.path.exists(db_path)}, size={os.path.getsize(db_path) if os.path.exists(db_path) else 'N/A'}")
    print(f"[seed] cwd={os.getcwd()}")

    if not seed_path.exists():
        print("[seed] No seed.db found, skipping")
        return

    should_seed = False
    if not os.path.exists(db_path):
        should_seed = True
        print(f"[seed] No database at {db_path}, will seed")
    else:
        # Check if existing db is empty (no knowledge entries)
        try:
            conn = sqlite3.connect(db_path)
            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            print(f"[seed] Existing db tables: {[t[0] for t in tables]}")
            cursor = conn.execute("SELECT COUNT(*) FROM knowledge_entries")
            count = cursor.fetchone()[0]
            conn.close()
            print(f"[seed] Existing db has {count} knowledge entries")
            if count == 0:
                should_seed = True
                print(f"[seed] Database is empty, will re-seed")
        except Exception as e:
            should_seed = True
            print(f"[seed] Cannot read database ({e}), will re-seed")

    if should_seed:
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        shutil.copy2(str(seed_path), db_path)
        verify_size = os.path.getsize(db_path)
        print(f"[seed] Copied seed database to {db_path} (size={verify_size})")
    else:
        print("[seed] Database already has data, skipping seed")


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
