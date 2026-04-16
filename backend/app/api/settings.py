from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
import os

router = APIRouter()

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "settings.json")

DEFAULT_SETTINGS = {
    "claude_model": "claude-sonnet-4-6",
    "claude_api_base": "https://navimaxx-cc.test.seewo.com",
    "confidence_auto_reply": 0.90,
    "confidence_draft_min": 0.60,
    "knowledge_stale_days": 0,  # 0 = permanent retention
    "max_upload_size_mb": 100,  # 100 GB storage limit
    "dark_mode": False,
    "smart_notifications": True,
    "ai_summaries": True,
    "data_retention": "permanent",
    "storage_limit_gb": 100,
    "max_clarification_rounds": 3,
}


class AppSettings(BaseModel):
    claude_model: str = "claude-sonnet-4-6"
    claude_api_base: str = "https://navimaxx-cc.test.seewo.com"
    confidence_auto_reply: float = 0.90
    confidence_draft_min: float = 0.60
    knowledge_stale_days: int = 0
    max_upload_size_mb: int = 100
    dark_mode: bool = False
    smart_notifications: bool = True
    ai_summaries: bool = True
    data_retention: str = "permanent"
    storage_limit_gb: int = 100
    storage_used_mb: float = 0
    max_clarification_rounds: int = 3


def _read_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, "r") as f:
            stored = json.load(f)
            return {**DEFAULT_SETTINGS, **stored}
    return dict(DEFAULT_SETTINGS)


def _write_settings(data: dict):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)


@router.get("/", response_model=AppSettings)
async def get_settings():
    """Get current application settings with real storage usage."""
    data = _read_settings()
    # Calculate actual storage used from the SQLite DB file
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "askonce.db")
    storage_used_mb = 0.0
    if os.path.exists(db_path):
        storage_used_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
    return AppSettings(**data, storage_used_mb=storage_used_mb)


@router.put("/", response_model=AppSettings)
async def update_settings(new_settings: AppSettings):
    """Update and persist application settings."""
    data = new_settings.model_dump()
    _write_settings(data)
    return AppSettings(**data)
