"""WeCom (企业微信) IM channel integration.

Requires:
- ASKONCE_WECOM_CORP_ID: Corp ID
- ASKONCE_WECOM_AGENT_ID: Agent ID
- ASKONCE_WECOM_SECRET: Agent secret
- ASKONCE_WECOM_TOKEN: Webhook verification token
- ASKONCE_WECOM_AES_KEY: Message encryption key

Docs: https://developer.work.weixin.qq.com/document/path/90236
"""
import time
import httpx
from typing import Optional
from datetime import datetime
from .base import BaseChannel, ChannelMessage, ChannelReply
from app.config import settings


class WeComIMChannel(BaseChannel):
    channel_name = "wecom_im"

    def __init__(self):
        self.corp_id = getattr(settings, 'wecom_corp_id', '')
        self.agent_id = getattr(settings, 'wecom_agent_id', '')
        self.secret = getattr(settings, 'wecom_secret', '')
        self._token: Optional[str] = None
        self._token_expires: float = 0

    async def validate_config(self) -> bool:
        return bool(self.corp_id and self.secret and self.agent_id)

    async def _get_access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
                params={"corpid": self.corp_id, "corpsecret": self.secret},
            )
            data = resp.json()
            self._token = data.get("access_token", "")
            self._token_expires = time.time() + data.get("expires_in", 7200) - 60
            return self._token

    async def send_reply(self, reply: ChannelReply) -> dict:
        """Send reply via WeCom."""
        token = await self._get_access_token()
        user_id = reply.metadata.get("user_id", "")

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}",
                json={
                    "touser": user_id,
                    "msgtype": "text",
                    "agentid": int(self.agent_id),
                    "text": {"content": reply.content},
                },
            )
            return resp.json()

    async def parse_webhook(self, payload: dict) -> Optional[ChannelMessage]:
        """Parse WeCom event callback."""
        msg_type = payload.get("MsgType", "")
        if msg_type != "text":
            return None

        return ChannelMessage(
            channel="wecom_im",
            sender_id=payload.get("FromUserName", ""),
            sender_name=payload.get("FromUserName", ""),
            content=payload.get("Content", ""),
            message_id=payload.get("MsgId", ""),
            conversation_id=payload.get("FromUserName", ""),
            timestamp=datetime.utcnow(),
            raw_data=payload,
        )
