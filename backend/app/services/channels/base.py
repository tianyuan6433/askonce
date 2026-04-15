"""Base channel abstraction for AskOnce multi-channel support."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class ChannelMessage:
    """Unified message format from any channel."""
    channel: str  # "feishu_im", "wecom_im", "outlook", "feishu_doc"
    sender_id: str
    sender_name: str
    content: str
    message_id: str
    conversation_id: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.utcnow)
    attachments: list[dict] = field(default_factory=list)
    raw_data: Optional[dict] = None


@dataclass
class ChannelReply:
    """Reply to send back through a channel."""
    content: str
    message_id: str  # original message ID to reply to
    channel: str
    metadata: dict = field(default_factory=dict)


class BaseChannel(ABC):
    """Base class for all channel integrations."""

    channel_name: str = "unknown"

    @abstractmethod
    async def validate_config(self) -> bool:
        """Check if channel is properly configured."""
        ...

    @abstractmethod
    async def send_reply(self, reply: ChannelReply) -> dict:
        """Send a reply through this channel."""
        ...

    @abstractmethod
    async def parse_webhook(self, payload: dict) -> Optional[ChannelMessage]:
        """Parse incoming webhook payload into a ChannelMessage."""
        ...
