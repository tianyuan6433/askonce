"""Feishu Docs channel for importing knowledge from Feishu documents.

Uses the same Feishu app credentials as FeishuIMChannel.
Reads document content via docx API.

Docs: https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content
"""
import time
import httpx
from typing import Optional
from datetime import datetime
from .base import BaseChannel, ChannelMessage, ChannelReply
from app.config import settings


class FeishuDocChannel(BaseChannel):
    channel_name = "feishu_doc"

    def __init__(self):
        self.app_id = getattr(settings, 'feishu_app_id', '')
        self.app_secret = getattr(settings, 'feishu_app_secret', '')
        self._token: Optional[str] = None
        self._token_expires: float = 0

    async def validate_config(self) -> bool:
        return bool(self.app_id and self.app_secret)

    async def _get_tenant_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self.app_id, "app_secret": self.app_secret},
            )
            data = resp.json()
            self._token = data.get("tenant_access_token", "")
            self._token_expires = time.time() + data.get("expire", 7200) - 60
            return self._token

    async def fetch_document(self, document_id: str) -> str:
        """Fetch plain text content of a Feishu document."""
        token = await self._get_tenant_token()

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/docx/v1/documents/{document_id}/raw_content",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            return data.get("data", {}).get("content", "")

    async def send_reply(self, reply: ChannelReply) -> dict:
        """Feishu Docs is read-only input, no reply capability."""
        return {"status": "not_supported", "message": "Feishu Docs is an input-only channel"}

    async def parse_webhook(self, payload: dict) -> Optional[ChannelMessage]:
        """Parse Feishu doc event (document update notification)."""
        doc_id = payload.get("document_id", "")
        if not doc_id:
            return None

        content = await self.fetch_document(doc_id)

        return ChannelMessage(
            channel="feishu_doc",
            sender_id="system",
            sender_name="Feishu Doc",
            content=content,
            message_id=doc_id,
            timestamp=datetime.utcnow(),
            raw_data=payload,
        )
