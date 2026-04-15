"""Outlook email channel integration via IMAP/SMTP.

Requires:
- ASKONCE_OUTLOOK_EMAIL: Email address
- ASKONCE_OUTLOOK_PASSWORD: App password (for IMAP auth)
- ASKONCE_OUTLOOK_IMAP_HOST: IMAP server (default: outlook.office365.com)
- ASKONCE_OUTLOOK_SMTP_HOST: SMTP server (default: smtp.office365.com)
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from datetime import datetime
from .base import BaseChannel, ChannelMessage, ChannelReply
from app.config import settings


class OutlookChannel(BaseChannel):
    channel_name = "outlook"

    def __init__(self):
        self.email_addr = getattr(settings, 'outlook_email', '')
        self.password = getattr(settings, 'outlook_password', '')
        self.imap_host = getattr(settings, 'outlook_imap_host', 'outlook.office365.com')
        self.smtp_host = getattr(settings, 'outlook_smtp_host', 'smtp.office365.com')

    async def validate_config(self) -> bool:
        return bool(self.email_addr and self.password)

    async def send_reply(self, reply: ChannelReply) -> dict:
        """Send email reply via SMTP."""
        to_email = reply.metadata.get("to_email", "")
        subject = reply.metadata.get("subject", "Re: AskOnce Reply")

        msg = MIMEMultipart()
        msg["From"] = self.email_addr
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["In-Reply-To"] = reply.message_id
        msg.attach(MIMEText(reply.content, "plain", "utf-8"))

        try:
            with smtplib.SMTP(self.smtp_host, 587) as server:
                server.starttls()
                server.login(self.email_addr, self.password)
                server.send_message(msg)
            return {"status": "sent", "to": to_email}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def parse_webhook(self, payload: dict) -> Optional[ChannelMessage]:
        """Parse email notification (typically from a polling mechanism)."""
        return ChannelMessage(
            channel="outlook",
            sender_id=payload.get("from", ""),
            sender_name=payload.get("from_name", ""),
            content=payload.get("body", ""),
            message_id=payload.get("message_id", ""),
            conversation_id=payload.get("thread_id", ""),
            timestamp=datetime.utcnow(),
            raw_data=payload,
        )
