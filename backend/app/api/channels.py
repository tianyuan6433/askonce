"""Channel webhook endpoints for receiving and replying to messages."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.services.channels import (
    FeishuIMChannel,
    WeComIMChannel,
    OutlookChannel,
    FeishuDocChannel,
)
from app.services.channels.base import ChannelReply
from app.services.retrieval_service import RetrievalService
from app.services.claude_service import ClaudeService, ClaudeServiceError
from app.models.interaction import Interaction
from app.config import settings

router = APIRouter()
retrieval_service = RetrievalService()


def get_channel(name: str):
    channels = {
        "feishu_im": FeishuIMChannel,
        "wecom_im": WeComIMChannel,
        "outlook": OutlookChannel,
        "feishu_doc": FeishuDocChannel,
    }
    cls = channels.get(name)
    if not cls:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {name}")
    return cls()


@router.post("/webhook/{channel_name}")
async def channel_webhook(
    channel_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive webhook from external channel, process through RAG, optionally auto-reply."""
    channel = get_channel(channel_name)

    if not await channel.validate_config():
        raise HTTPException(
            status_code=503, detail=f"Channel {channel_name} is not configured"
        )

    payload = await request.json()

    # Handle Feishu URL verification
    if "challenge" in payload:
        return {"challenge": payload["challenge"]}

    message = await channel.parse_webhook(payload)
    if not message:
        return {"status": "ignored", "reason": "Could not parse message"}

    # Process through RAG pipeline
    results = await retrieval_service.retrieve(db, message.content)
    confidence = retrieval_service.compute_confidence(results)

    try:
        claude_service = ClaudeService()
        reply_data = await claude_service.generate_reply(message.content, results)
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        reply_data = {"reply": f"Error: {str(e)}", "model": "error"}

    # Determine status
    if confidence >= settings.confidence_auto_reply:
        status = "auto_reply"
    elif confidence >= settings.confidence_draft_min:
        status = "draft"
    else:
        status = "low_confidence"

    # Save interaction
    interaction = Interaction(
        id=str(uuid.uuid4()),
        query_text=message.content,
        channel=channel_name,
        draft_reply=reply_data["reply"],
        confidence=confidence,
        status="pending",
        matched_knowledge_id=results[0]["id"] if results else None,
    )
    db.add(interaction)
    await db.commit()

    response = {
        "status": status,
        "interaction_id": interaction.id,
        "draft_reply": reply_data["reply"],
        "confidence": confidence,
        "sources_count": len(results),
    }

    # Auto-reply if high confidence — EXCEPT Outlook (email requires manual confirmation always)
    if status == "auto_reply" and channel_name != "outlook":
        reply = ChannelReply(
            content=reply_data["reply"],
            message_id=message.message_id,
            channel=channel_name,
            metadata={
                "user_id": message.sender_id,
                "to_email": message.sender_id,
            },
        )
        send_result = await channel.send_reply(reply)
        interaction.status = "confirmed"
        interaction.final_reply = reply_data["reply"]
        await db.commit()
        response["auto_replied"] = True
        response["send_result"] = send_result

    return response


class ManualReplyRequest(BaseModel):
    interaction_id: str
    channel_name: str
    reply_text: str
    recipient_id: str
    message_id: str
    metadata: Optional[dict] = None


@router.post("/reply")
async def send_channel_reply(
    req: ManualReplyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Manually send a reply through a specific channel."""
    channel = get_channel(req.channel_name)

    if not await channel.validate_config():
        raise HTTPException(
            status_code=503, detail=f"Channel {req.channel_name} is not configured"
        )

    reply = ChannelReply(
        content=req.reply_text,
        message_id=req.message_id,
        channel=req.channel_name,
        metadata={
            "user_id": req.recipient_id,
            "to_email": req.recipient_id,
            **(req.metadata or {}),
        },
    )

    result = await channel.send_reply(reply)

    # Update interaction status
    stmt = select(Interaction).where(Interaction.id == req.interaction_id)
    interaction = (await db.execute(stmt)).scalar_one_or_none()
    if interaction:
        interaction.status = "confirmed"
        interaction.final_reply = req.reply_text
        await db.commit()

    return {"status": "sent", "result": result}


@router.get("/status")
async def get_channels_status():
    """Get configuration status of all channels."""
    channels = {
        "feishu_im": FeishuIMChannel(),
        "wecom_im": WeComIMChannel(),
        "outlook": OutlookChannel(),
        "feishu_doc": FeishuDocChannel(),
    }

    status = {}
    for name, ch in channels.items():
        status[name] = {
            "configured": await ch.validate_config(),
            "channel_name": ch.channel_name,
        }

    return status
