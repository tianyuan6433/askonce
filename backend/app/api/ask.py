from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
import json
import os
import uuid

from app.db.database import get_db
from app.services.claude_service import ClaudeService, ClaudeServiceError
from app.services.retrieval_service import RetrievalService
from app.services.image_service import ImageService
from app.config import settings
from app.models.interaction import Interaction
from sse_starlette.sse import EventSourceResponse
from app.services.conversation_manager import ConversationManager
from app.services.rule_engine import evaluate_rules

router = APIRouter()

retrieval_service = RetrievalService()
image_service = ImageService()
conversation_mgr = ConversationManager(ttl_seconds=1800)


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


class StreamAskRequest(BaseModel):
    query: str
    channel: str = "manual"
    reply_lang: str = "en"
    reply_format: str = "chat"
    session_id: str | None = None


class TranslateTextRequest(BaseModel):
    text: str
    target_lang: str = "en"  # "en" or "zh"


@router.post("/translate")
async def translate_text(request: TranslateTextRequest):
    """Translate freeform text to the target language."""
    claude_service = get_claude_service()
    try:
        translated = await claude_service.translate_text(request.text, request.target_lang)
        return {"translated": translated}
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


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
        elapsed_ms=elapsed_ms,
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


@router.post("/stream")
async def ask_stream(request: StreamAskRequest, db: AsyncSession = Depends(get_db)):
    """SSE streaming endpoint for ask with multi-turn support."""
    import time
    start_time = time.time()
    claude_service = get_claude_service()

    # Retrieve knowledge — cross-language: merge results from both original
    # query and extracted English keywords for better bilingual coverage
    results = await retrieval_service.retrieve(db, request.query, top_k=10)

    import re
    seen_ids = {r["id"] for r in results}

    def _merge_results(extra_results):
        for er in extra_results:
            if er["id"] not in seen_ids:
                results.append(er)
                seen_ids.add(er["id"])

    # If query contains CJK characters, also search with key English terms
    has_cjk = bool(re.search(r'[\u4e00-\u9fff]', request.query))
    if has_cjk:
        en_terms = re.findall(r'[A-Za-z]{2,}', request.query)
        if en_terms:
            en_query = " ".join(en_terms) + " price cost"
            _merge_results(await retrieval_service.retrieve(db, en_query, top_k=5))

    # If query mentions device types + pricing/license, also fetch device
    # classification knowledge (主设备 vs 外设) for accurate calculations
    device_keywords = re.findall(r'(?:CMB|CMA|IFP|FP|LED|MTR|麦克风|摄像头|喇叭|外设|主设备)', request.query, re.IGNORECASE)
    price_keywords = re.findall(r'(?:license|价格|多少钱|收费|price|cost|报价)', request.query, re.IGNORECASE)
    if device_keywords and price_keywords:
        _merge_results(await retrieval_service.retrieve(db, "主设备 外设 设备分类 device peripheral", top_k=3))

    confidence = retrieval_service.compute_confidence(results)

    # Read settings for max rounds
    from app.api.settings import _read_settings
    current_settings = _read_settings()
    max_rounds = current_settings.get("max_clarification_rounds", 3)
    confidence_threshold = current_settings.get("confidence_draft_min", 0.60)

    # Session management
    if request.session_id:
        session = conversation_mgr.get_session(request.session_id)
        if not session:
            session_id = conversation_mgr.create_session(knowledge_context=results)
            conversation_mgr.get_session(session_id).original_query = request.query
        else:
            session_id = request.session_id
            # Merge stored knowledge context from previous rounds so follow-up
            # queries retain device classification, pricing, etc.
            stored_ids = {r["id"] for r in session.knowledge_context}
            for r in results:
                if r["id"] not in stored_ids:
                    session.knowledge_context.append(r)
                    stored_ids.add(r["id"])
            # Use the richer merged context for this round
            results = session.knowledge_context
    else:
        session_id = conversation_mgr.create_session(knowledge_context=results)
        conversation_mgr.get_session(session_id).original_query = request.query

    session = conversation_mgr.get_session(session_id)
    # Use the original first query for history display
    display_query = session.original_query or request.query

    # Forced multi-turn: always clarify until max_rounds, then force answer
    force_clarification = session.round_count < max_rounds
    force_direct_answer = session.round_count >= max_rounds

    async def event_generator():
        yield {"event": "thinking", "data": json.dumps({"status": "analyzing"})}
        yield {"event": "session", "data": json.dumps({"session_id": session_id, "round": session.round_count, "max_rounds": max_rounds})}

        # Add user message to conversation
        conversation_mgr.add_user_message(session_id, request.query)

        # Check if summarization needed
        if conversation_mgr.should_summarize(session_id):
            yield {"event": "thinking", "data": json.dumps({"status": "summarizing"})}
            summary_text = claude_service._chat(
                [{"role": "user", "content": "Summarize this conversation in one sentence: " + str(session.messages[:-2])}],
                max_tokens=200,
            )
            conversation_mgr.compress_messages(session_id, summary_text)

        # Get messages for Claude
        messages = conversation_mgr.get_messages_for_claude(session_id)

        # Build knowledge context text
        context_text = "\n\n".join([
            f"Q: {', '.join(e.get('question_patterns', []))}\nA: {e.get('answer', '')}"
            for e in results
        ])

        # Stream reply
        full_text = ""
        is_clarification = False
        clarification_data = None

        async for event in claude_service.generate_reply_stream(
            messages=messages,
            knowledge_context=context_text if context_text.strip() else "(No matching knowledge entries found)",
            force_direct_answer=force_direct_answer,
            force_clarification=force_clarification,
            reply_lang=request.reply_lang,
            reply_format=request.reply_format,
        ):
            if event["type"] == "token":
                full_text += event["text"]
                yield {"event": "token", "data": json.dumps({"text": event["text"]})}
            elif event["type"] == "clarification":
                is_clarification = True
                clarification_data = event["questions"]
            elif event["type"] == "done":
                full_text = event["full_text"]

        if is_clarification:
            conversation_mgr.add_assistant_message(session_id, full_text)
            conversation_mgr.increment_round(session_id)

            interaction_id = str(uuid.uuid4())

            # Yield clarification event FIRST (before db commit to avoid blocking)
            yield {
                "event": "clarification",
                "data": json.dumps({
                    "questions": clarification_data,
                    "round": session.round_count,
                    "interaction_id": interaction_id,
                }),
            }

            # Persist to database after sending the event
            try:
                interaction = Interaction(
                    id=interaction_id,
                    query_text=display_query,
                    channel=request.channel,
                    confidence=confidence,
                    status="pending",
                    matched_knowledge_id=results[0]["id"] if results else None,
                )
                db.add(interaction)
                await db.commit()
            except Exception as e:
                logger.warning(f"[stream] Failed to persist clarification interaction: {e}")
        else:
            # Got a direct answer — send immediately, translate in background
            conversation_mgr.add_assistant_message(session_id, full_text)

            # Detect actual language of the streamed text
            import re as _re
            cjk_chars = len(_re.findall(r'[\u4e00-\u9fff]', full_text))
            total_chars = max(len(full_text.strip()), 1)
            actual_is_chinese = (cjk_chars / total_chars) > 0.3

            # Set primary reply immediately
            if actual_is_chinese:
                reply_zh = full_text
                reply_en = full_text  # Temporary — will be replaced by translation
            else:
                reply_en = full_text
                reply_zh = ""  # Temporary — will be replaced by translation

            elapsed_ms = int((time.time() - start_time) * 1000)

            if confidence >= current_settings.get("confidence_auto_reply", 0.90):
                status = "auto_reply"
            elif confidence >= confidence_threshold:
                status = "draft"
            else:
                status = "low_confidence"

            interaction_id = str(uuid.uuid4())

            # Send complete event FIRST (before db commit)
            yield {
                "event": "complete",
                "data": json.dumps({
                    "id": interaction_id,
                    "query": display_query,
                    "reply_en": reply_en,
                    "reply_zh": reply_zh,
                    "confidence": confidence,
                    "status": status,
                    "sources": results[:3],
                    "elapsed_ms": elapsed_ms,
                    "session_id": session_id,
                    "conversation_log": session.messages,
                }),
            }

            # Persist to database after sending the event
            try:
                conv_log = json.dumps(session.messages) if session.messages else None
                interaction = Interaction(
                    id=interaction_id,
                    query_text=display_query,
                    channel=request.channel,
                    draft_reply=reply_en,
                    confidence=confidence,
                    status=status,
                    elapsed_ms=elapsed_ms,
                    conversation_log=conv_log,
                    matched_knowledge_id=results[0]["id"] if results else None,
                )
                db.add(interaction)
                await db.commit()
            except Exception as e:
                logger.warning(f"[stream] Failed to persist interaction: {e}")

            # Now translate in background and send translation event
            try:
                if actual_is_chinese:
                    translated = claude_service._chat([{
                        "role": "user",
                        "content": f"Translate this customer service reply to English. Keep the same tone and format. Output ONLY the translation.\n\n{full_text}",
                    }], max_tokens=2048)
                    yield {"event": "translation", "data": json.dumps({"reply_en": translated, "reply_zh": reply_zh})}
                else:
                    translated = claude_service._chat([{
                        "role": "user",
                        "content": f"Translate this customer service reply to Simplified Chinese. Keep the same tone and format. Output ONLY the translation.\n\n{full_text}",
                    }], max_tokens=2048)
                    yield {"event": "translation", "data": json.dumps({"reply_en": reply_en, "reply_zh": translated})}
            except Exception:
                pass  # Translation failed — user can use sync button

        # Signal end of stream
        yield {"event": "done", "data": json.dumps({"status": "finished"})}

    return EventSourceResponse(event_generator())


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
        reply_data = await claude_service.generate_bilingual_reply(
            request.original_query, results,
            reply_format=request.reply_format,
            followup_context=followup_context,
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
        interaction.draft_reply = reply_data.get("reply_en") or reply_data.get("reply", "")
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
        draft_reply=reply_data.get("reply_en") or reply_data.get("reply", ""),
        draft_reply_en=reply_data.get("reply_en"),
        draft_reply_zh=reply_data.get("reply_zh"),
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
    search: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get recent query history with replies and adoption data.
    
    Optional filters:
      - search: keyword search in query_text and draft_reply
      - status: filter by interaction status (pending, confirmed, edited, etc.)
    """
    from sqlalchemy import select, desc, func as sqlfunc, or_
    base_filter = [
        Interaction.query_text.isnot(None),
        or_(
            Interaction.draft_reply.isnot(None),
            Interaction.final_reply.isnot(None),
        ),
    ]
    if search:
        search_term = f"%{search}%"
        base_filter.append(
            or_(
                Interaction.query_text.ilike(search_term),
                Interaction.draft_reply.ilike(search_term),
                Interaction.final_reply.ilike(search_term),
            )
        )
    if status:
        base_filter.append(Interaction.status == status)

    result = await db.execute(
        select(Interaction)
        .where(*base_filter)
        .order_by(desc(Interaction.created_at))
        .offset(offset)
        .limit(limit)
    )
    interactions = result.scalars().all()

    total_result = await db.execute(
        select(sqlfunc.count()).select_from(Interaction)
        .where(*base_filter)
    )
    total = total_result.scalar() or 0

    items = []
    for i in interactions:
        conv_log = None
        if i.conversation_log:
            try:
                conv_log = json.loads(i.conversation_log)
            except (json.JSONDecodeError, TypeError):
                pass
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
            "conversation_log": conv_log,
        })

    return {"items": items, "total": total}
