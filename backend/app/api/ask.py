from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
import json
import os
import uuid

from app.db.database import get_db
from app.services.claude_service import ClaudeService, ClaudeServiceError
from app.services.retrieval_service import RetrievalService
from app.services.image_service import ImageService
from app.config import settings
from app.models.interaction import Interaction

router = APIRouter()

retrieval_service = RetrievalService()
image_service = ImageService()


def get_claude_service() -> ClaudeService:
    """Get Claude service, raising clear HTTP error if not configured."""
    try:
        return ClaudeService()
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))

class AskRequest(BaseModel):
    query: str
    channel: str = "manual"
    reply_lang: str = "en"  # "en" or "zh"
    reply_format: str = "chat"  # "chat", "email", "other"


class ClarificationQuestion(BaseModel):
    id: str
    text: str
    options: list[str]


class SourceInfo(BaseModel):
    id: str
    question_patterns: list[str]
    answer: str
    score: float


class AskResponse(BaseModel):
    id: str
    query: str
    draft_reply: str | None = None
    draft_reply_en: str | None = None
    draft_reply_zh: str | None = None
    confidence: float
    sources: list[dict]
    status: str  # "auto_reply" | "draft" | "low_confidence" | "clarification"
    elapsed_ms: int = 0
    # Clarification fields
    clarification_questions: list[ClarificationQuestion] = []


@router.post("/", response_model=AskResponse)
async def ask_question(request: AskRequest, db: AsyncSession = Depends(get_db)):
    """Submit a text query and get AI-generated bilingual reply (or clarification questions)."""
    import time
    start_time = time.time()
    claude_service = get_claude_service()

    # Step 1: Retrieve relevant knowledge (use raw query, no hints)
    results = await retrieval_service.retrieve(db, request.query, top_k=10)
    confidence = retrieval_service.compute_confidence(results)

    # Step 2: Generate bilingual reply with Claude (may return clarification)
    try:
        reply_data = await claude_service.generate_bilingual_reply(
            request.query, results, reply_format=request.reply_format
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Step 3: Handle clarification vs direct reply
    if reply_data.get("type") == "clarification":
        interaction = Interaction(
            id=str(uuid.uuid4()),
            query_text=request.query,
            channel=request.channel,
            confidence=confidence,
            status="pending",
            matched_knowledge_id=results[0]["id"] if results else None,
        )
        db.add(interaction)
        await db.commit()

        questions = [
            ClarificationQuestion(
                id=q.get("id", f"q{i}"),
                text=q.get("text", ""),
                options=q.get("options", []),
            )
            for i, q in enumerate(reply_data.get("questions", []))
        ]

        return AskResponse(
            id=interaction.id,
            query=request.query,
            draft_reply=None,
            confidence=confidence,
            sources=results[:3],
            status="clarification",
            elapsed_ms=elapsed_ms,
            clarification_questions=questions,
        )

    # Step 4: Direct reply path
    reply_en = reply_data.get("reply_en", reply_data.get("reply", ""))
    reply_zh = reply_data.get("reply_zh", "")

    if confidence >= settings.confidence_auto_reply:
        status = "auto_reply"
    elif confidence >= settings.confidence_draft_min:
        status = "draft"
    else:
        status = "low_confidence"

    # Save interaction (store EN reply as draft)
    interaction = Interaction(
        id=str(uuid.uuid4()),
        query_text=request.query,
        channel=request.channel,
        draft_reply=reply_en,
        confidence=confidence,
        status="pending",
        matched_knowledge_id=results[0]["id"] if results else None,
    )
    db.add(interaction)
    await db.commit()

    return AskResponse(
        id=interaction.id,
        query=request.query,
        draft_reply=reply_en,
        draft_reply_en=reply_en,
        draft_reply_zh=reply_zh,
        confidence=confidence,
        sources=results[:3],
        status=status,
        elapsed_ms=elapsed_ms,
    )


class ImageAskResponse(BaseModel):
    id: str
    detected_question: str
    tags: list[str]
    image_url: str | None
    draft_reply: str
    draft_reply_en: str | None = None
    draft_reply_zh: str | None = None
    confidence: float
    sources: list[dict]
    status: str


@router.post("/image", response_model=ImageAskResponse)
async def ask_with_image(
    file: UploadFile = File(...),
    context: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a screenshot and get AI-generated reply."""
    claude_service = get_claude_service()

    # Read and validate image
    content = await file.read()
    if not image_service.validate_image(content, file.content_type or "image/png"):
        raise HTTPException(status_code=400, detail="Invalid image. Please upload PNG, JPEG, WebP, or GIF under 10MB.")

    # Preprocess
    processed = image_service.preprocess(content)

    # Save image
    filename = f"{uuid.uuid4()}.png"
    filepath = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(processed)

    # Extract info from image
    try:
        extraction = await claude_service.extract_from_image(processed, "image/png")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image extraction failed: {str(e)}")
    detected_question = extraction.get("detected_question", context or "")
    tags = extraction.get("tags", [])

    # Retrieve and generate reply
    query = detected_question or context or ""
    results = await retrieval_service.retrieve(db, query) if query else []
    confidence = retrieval_service.compute_confidence(results)
    try:
        reply_data = await claude_service.generate_bilingual_reply(query, results)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Reply generation failed: {str(e)}")

    reply_en = reply_data.get("reply_en", reply_data.get("reply", ""))
    reply_zh = reply_data.get("reply_zh", "")

    status = "auto_reply" if confidence >= settings.confidence_auto_reply else \
             "draft" if confidence >= settings.confidence_draft_min else "low_confidence"

    # Save interaction
    interaction = Interaction(
        id=str(uuid.uuid4()),
        query_text=detected_question,
        query_image_path=f"/uploads/{filename}",
        channel="screenshot",
        draft_reply=reply_en,
        confidence=confidence,
        status="pending",
        matched_knowledge_id=results[0]["id"] if results else None,
    )
    db.add(interaction)
    await db.commit()

    return ImageAskResponse(
        id=interaction.id,
        detected_question=detected_question,
        tags=tags,
        image_url=f"/uploads/{filename}",
        draft_reply=reply_en,
        draft_reply_en=reply_en,
        draft_reply_zh=reply_zh,
        confidence=confidence,
        sources=results[:3],
        status=status,
    )


class FollowupAnswer(BaseModel):
    question_id: str
    question_text: str
    answer: str


class FollowupRequest(BaseModel):
    interaction_id: str
    original_query: str
    answers: list[FollowupAnswer]
    reply_lang: str = "en"
    reply_format: str = "chat"


@router.post("/followup", response_model=AskResponse)
async def ask_followup(request: FollowupRequest, db: AsyncSession = Depends(get_db)):
    """Continue a clarification conversation and generate the final reply."""
    import time
    start_time = time.time()
    claude_service = get_claude_service()

    # Retrieve knowledge again
    results = await retrieval_service.retrieve(db, request.original_query)
    confidence = retrieval_service.compute_confidence(results)

    # Build language/format hints
    lang_hint = "[请用中文回复]" if request.reply_lang == "zh" else "[Reply in English]"
    format_hints = {
        "email": "[Format: formal email reply, sign off as Yuan]",
        "chat": "[Format: short casual chat message, no greeting/sign-off needed]",
        "other": "[Format: neutral professional reply]",
    }
    format_hint = format_hints.get(request.reply_format, format_hints["chat"])
    augmented_query = f"{request.original_query}\n{lang_hint}\n{format_hint}"

    # Build followup context
    followup_context = [
        {"question": a.question_text, "answer": a.answer}
        for a in request.answers
    ]

    try:
        reply_data = await claude_service.generate_reply(
            augmented_query, results, followup_context=followup_context
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Handle if Claude asks more clarification (another round)
    if reply_data.get("type") == "clarification":
        questions = [
            ClarificationQuestion(
                id=q.get("id", f"q{i}"),
                text=q.get("text", ""),
                options=q.get("options", []),
            )
            for i, q in enumerate(reply_data.get("questions", []))
        ]
        return AskResponse(
            id=request.interaction_id,
            query=request.original_query,
            draft_reply=None,
            confidence=confidence,
            sources=results[:3],
            status="clarification",
            elapsed_ms=elapsed_ms,
            clarification_questions=questions,
        )

    # Final reply — update the existing interaction
    from sqlalchemy import select
    result = await db.execute(
        select(Interaction).where(Interaction.id == request.interaction_id)
    )
    interaction = result.scalar_one_or_none()
    if interaction:
        interaction.draft_reply = reply_data.get("reply", "")
    else:
        # Create new if somehow missing
        interaction = Interaction(
            id=request.interaction_id,
            query_text=request.original_query,
            channel="manual",
            draft_reply=reply_data.get("reply", ""),
            confidence=confidence,
            status="pending",
            matched_knowledge_id=results[0]["id"] if results else None,
        )
        db.add(interaction)
    await db.commit()

    if confidence >= settings.confidence_auto_reply:
        status = "auto_reply"
    elif confidence >= settings.confidence_draft_min:
        status = "draft"
    else:
        status = "low_confidence"

    return AskResponse(
        id=interaction.id,
        query=request.original_query,
        draft_reply=reply_data.get("reply", ""),
        confidence=confidence,
        sources=results[:3],
        status=status,
        elapsed_ms=elapsed_ms,
    )


class ConfirmReplyRequest(BaseModel):
    interaction_id: str
    edited_reply: Optional[str] = None


def _compute_edit_ratio(original: str, edited: str) -> float:
    """Compute adoption ratio: 1.0 = no changes, 0.0 = fully rewritten.
    Uses simple character-level similarity."""
    if not original or not edited:
        return 1.0
    if original == edited:
        return 1.0
    # Simple similarity: 1 - (edit_distance / max_length)
    # Use SequenceMatcher for reasonable approximation
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, original, edited).ratio()
    return round(ratio, 3)


@router.post("/reply/confirm")
async def confirm_reply(request: ConfirmReplyRequest, db: AsyncSession = Depends(get_db)):
    """Track adoption when user copies the reply. If user edited significantly, trigger knowledge learning."""
    from sqlalchemy import select
    result = await db.execute(
        select(Interaction).where(Interaction.id == request.interaction_id)
    )
    interaction = result.scalar_one_or_none()
    if not interaction:
        return {"status": "error", "message": "Interaction not found"}

    final = request.edited_reply or interaction.draft_reply
    interaction.final_reply = final
    interaction.status = "edited" if request.edited_reply else "confirmed"
    interaction.edit_ratio = _compute_edit_ratio(interaction.draft_reply or "", final)
    interaction.resolved_at = datetime.utcnow()
    await db.commit()

    # If user made significant edits, trigger background knowledge learning
    learning_suggestions = []
    if request.edited_reply and interaction.edit_ratio is not None and interaction.edit_ratio < 0.85:
        try:
            claude_service = get_claude_service()
            # Get matched knowledge entries
            matched = []
            if interaction.matched_knowledge_id:
                from app.models.knowledge import KnowledgeEntry
                entry_result = await db.execute(
                    select(KnowledgeEntry).where(KnowledgeEntry.id == interaction.matched_knowledge_id)
                )
                entry = entry_result.scalar_one_or_none()
                if entry:
                    matched = [{
                        "id": entry.id,
                        "question_patterns": entry.question_patterns or [],
                        "answer": entry.answer,
                    }]
            # Also get other relevant entries
            other_results = await retrieval_service.retrieve(db, interaction.query_text or "", top_k=5)
            for r in other_results:
                if r["id"] != (interaction.matched_knowledge_id or ""):
                    matched.append(r)

            suggestions = await claude_service.learn_from_edit(
                query=interaction.query_text or "",
                original_reply=interaction.draft_reply or "",
                edited_reply=final,
                matched_knowledge=matched[:5],
            )
            learning_suggestions = suggestions

            # Log the learning event
            from app.models.knowledge import KnowledgeLog
            log = KnowledgeLog(
                action="learned",
                method="auto",
                count=len(suggestions),
                details=json.dumps({
                    "interaction_id": interaction.id,
                    "edit_ratio": interaction.edit_ratio,
                    "suggestions": suggestions,
                }),
            )
            db.add(log)
            await db.commit()
        except Exception as e:
            print(f"[confirm_reply] Knowledge learning failed: {e}", flush=True)

    return {
        "status": "sent",
        "interaction_id": interaction.id,
        "edit_ratio": interaction.edit_ratio,
        "learning_suggestions": learning_suggestions,
    }


@router.get("/history")
async def get_history(
    limit: int = 5,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Get recent query history with replies and adoption data."""
    from sqlalchemy import select, desc, func as sqlfunc
    result = await db.execute(
        select(Interaction)
        .where(Interaction.query_text.isnot(None))
        .order_by(desc(Interaction.created_at))
        .offset(offset)
        .limit(limit)
    )
    interactions = result.scalars().all()

    total_result = await db.execute(
        select(sqlfunc.count()).select_from(Interaction).where(Interaction.query_text.isnot(None))
    )
    total = total_result.scalar() or 0

    items = []
    for i in interactions:
        items.append({
            "id": i.id,
            "query": i.query_text,
            "draft_reply": i.draft_reply,
            "final_reply": i.final_reply,
            "confidence": i.confidence,
            "edit_ratio": i.edit_ratio,
            "status": i.status,
            "channel": i.channel,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        })

    return {"items": items, "total": total}
