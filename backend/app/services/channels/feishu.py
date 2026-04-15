"""Feishu (Lark) IM channel integration.

Requires:
- ASKONCE_FEISHU_APP_ID: Feishu app ID
- ASKONCE_FEISHU_APP_SECRET: Feishu app secret
- Feishu bot configured with im:message event subscription

Docs: https://open.feishu.cn/document/server-docs/im-v1/message/create
"""
import json
import time
import httpx
from typing import Optional
from datetime import datetime
from .base import BaseChannel, ChannelMessage, ChannelReply
from app.config import settings


class FeishuIMChannel(BaseChannel):
    channel_name = "feishu_im"

    def __init__(self):
        self.app_id = getattr(settings, 'feishu_app_id', '')
        self.app_secret = getattr(settings, 'feishu_app_secret', '')
        self._token: Optional[str] = None
        self._token_expires: float = 0

    async def validate_config(self) -> bool:
        return bool(self.app_id and self.app_secret)

    async def _get_tenant_token(self) -> str:
        """Get Feishu tenant access token."""
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

    async def send_reply(self, reply: ChannelReply) -> dict:
        """Send reply via Feishu IM."""
        token = await self._get_tenant_token()

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{reply.message_id}/reply",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "content": json.dumps({"text": reply.content}),
                    "msg_type": "text",
                },
            )
            return resp.json()

    async def parse_webhook(self, payload: dict) -> Optional[ChannelMessage]:
        """Parse Feishu event callback."""
        # Handle URL verification challenge
        if "challenge" in payload:
            return None

        event = payload.get("event", {})
        message = event.get("message", {})
        sender = event.get("sender", {})

        content_str = message.get("content", "{}")
        try:
            content = json.loads(content_str)
        except json.JSONDecodeError:
            content = {"text": content_str}

        text = content.get("text", "")
        if not text:
            return None

        return ChannelMessage(
            channel="feishu_im",
            sender_id=sender.get("sender_id", {}).get("open_id", "unknown"),
            sender_name=sender.get("sender_id", {}).get("open_id", "unknown"),
            content=text,
            message_id=message.get("message_id", ""),
            conversation_id=message.get("chat_id", ""),
            timestamp=datetime.utcnow(),
            raw_data=payload,
        )
