from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AskOnce"
    debug: bool = False
    
    # Database - SQLite for MVP
    database_url: str = "sqlite+aiosqlite:///./askonce.db"
    
    # Claude API
    claude_api_key: str = ""
    claude_api_base: str = "https://api.anthropic.com"
    claude_model: str = "claude-sonnet-4-20250514"
    
    # Knowledge Engine
    confidence_auto_reply: float = 0.90
    confidence_draft_min: float = 0.60
    knowledge_stale_days: int = 90
    max_clarification_rounds: int = 3
    
    # Upload
    max_upload_size_mb: int = 10
    upload_dir: str = "./uploads"
    allowed_image_types: list[str] = ["image/png", "image/jpeg", "image/webp", "image/gif"]

    # Channel: Feishu
    feishu_app_id: str = ""
    feishu_app_secret: str = ""

    # Channel: WeCom
    wecom_corp_id: str = ""
    wecom_agent_id: str = ""
    wecom_secret: str = ""
    wecom_token: str = ""
    wecom_aes_key: str = ""

    # Channel: Outlook
    outlook_email: str = ""
    outlook_password: str = ""
    outlook_imap_host: str = "outlook.office365.com"
    outlook_smtp_host: str = "smtp.office365.com"
    
    class Config:
        env_file = ".env"
        env_prefix = "ASKONCE_"


settings = Settings()
