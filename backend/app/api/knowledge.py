import asyncio

from fastapi import APIRouter, UploadFile, File, Form, Query, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.services.knowledge_service import KnowledgeService, _log_action
from app.services.image_service import ImageService
from app.services.claude_service import ClaudeServiceError
from app.models.knowledge import TranslationCache, KnowledgeEntry

router = APIRouter()

knowledge_service = KnowledgeService()
image_service = ImageService()


def _parse_json_list(v):
    """Parse a JSON string to list, or return as-is if already a list.
    Handles double-encoded JSON strings (e.g. '"[\\"a\\", \\"b\\"]"')."""
    if isinstance(v, list):
        return v
    if not v:
        return []
    if isinstance(v, str):
        import json
        try:
            parsed = json.loads(v)
            # Handle double-encoded: json.loads returned a string, try again
            if isinstance(parsed, str):
                try:
                    parsed2 = json.loads(parsed)
                    if isinstance(parsed2, list):
                        return parsed2
                except (json.JSONDecodeError, TypeError):
                    pass
                return [parsed]
            if isinstance(parsed, list):
                return parsed
            return [str(parsed)]
        except json.JSONDecodeError:
            return [v]
    return []


VALID_CATEGORIES = {"Product", "Pricing", "Technical", "Support", "Security", "Content", "Organization", "General"}


def auto_categorize(answer: str, tags: list[str], ai_category: str | None = None) -> str:
    """Auto-assign category. Uses AI-suggested category if valid, otherwise keyword matching."""
    if ai_category and ai_category in VALID_CATEGORIES:
        return ai_category

    text = (answer + " " + " ".join(tags)).lower()
    categories = {
        "Security": [
            "security", "soc", "gdpr", "encrypt", "tls", "compliance", "audit",
            "authentication", "oauth", "saml", "sso", "2fa", "mfa", "certificate",
            "firewall", "vpn", "privacy", "data protection", "access control",
            "安全", "加密", "认证", "合规",
        ],
        "Pricing": [
            "price", "pricing", "cost", "plan", "subscription", "license", "tier",
            "discount", "fee", "invoice", "billing", "payment", "quote", "purchase",
            "trial", "free", "enterprise", "professional", "standard plan",
            "价格", "费用", "订阅", "授权", "计费",
        ],
        "Technical": [
            "api", "install", "setup", "configure", "deploy", "firmware", "update",
            "network", "server", "integration", "sdk", "webhook", "endpoint", "mdm",
            "adb", "ssh", "port", "ip address", "dns", "wifi", "bluetooth",
            "troubleshoot", "debug", "log", "error code", "reboot", "reset factory",
            "软件", "安装", "配置", "网络", "固件", "更新", "接口",
        ],
        "Support": [
            "support", "warranty", "return", "refund", "replace", "repair",
            "contact", "helpdesk", "ticket", "response time", "sla", "rma",
            "customer service", "after-sales", "help center", "faq",
            "售后", "保修", "退换", "客服", "支持",
        ],
        "Content": [
            "content", "playlist", "canvas", "media", "schedule", "publish", "broadcast",
            "template", "slide", "video", "image", "stream", "display content",
            "signage", "announcement", "emergency alert", "layout",
            "内容", "播放列表", "模板", "发布", "媒体", "排版",
        ],
        "Organization": [
            "organization", "role", "admin", "user", "member", "group", "department",
            "team", "account", "workspace", "tenant", "site", "hierarchy",
            "invite", "onboarding", "permission", "access level",
            "组织", "角色", "管理员", "部门", "团队", "账号",
        ],
        "Product": [
            "pivot", "maxhub", "dms", "cms", "device", "display", "screen", "panel",
            "ifp", "kiosk", "touch", "resolution", "hdmi", "usb", "feature",
            "specification", "model", "hardware", "release", "version",
            "产品", "设备", "显示", "屏幕", "功能", "规格",
        ],
    }
    for cat, keywords in categories.items():
        if any(kw in text for kw in keywords):
            return cat
    return "General"


class KnowledgeEntryResponse(BaseModel):
    id: str
    question_patterns: list[str]
    answer: str
    conditions: str | None = None
    tags: list[str] = []
    category: str | None = None
    confidence: float = 1.0
    source_type: str = "manual"
    source_ref: str | None = None
    status: str = "active"
    updated_at: str | None = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_entry(cls, entry, locale: str | None = None):
        """Create from SQLAlchemy model. If locale=zh-CN, use zh columns if available."""
        qp = _parse_json_list(entry.question_patterns)
        answer = entry.answer or ""

        if locale == "zh-CN":
            zh_qp = _parse_json_list(getattr(entry, "question_patterns_zh", None))
            zh_answer = getattr(entry, "answer_zh", None)
            if zh_qp:
                qp = zh_qp
            if zh_answer:
                answer = zh_answer

        updated = None
        if hasattr(entry, "updated_at") and entry.updated_at:
            updated = entry.updated_at.isoformat() if hasattr(entry.updated_at, "isoformat") else str(entry.updated_at)

        return cls(
            id=entry.id,
            question_patterns=qp,
            answer=answer,
            conditions=entry.conditions,
            tags=_parse_json_list(entry.tags),
            category=getattr(entry, "category", None),
            confidence=entry.confidence or 1.0,
            source_type=entry.source_type or "manual",
            source_ref=entry.source_ref,
            status=entry.status or "active",
            updated_at=updated,
        )


class KnowledgeListResponse(BaseModel):
    items: list[KnowledgeEntryResponse]
    total: int
    page: int
    page_size: int


@router.get("/", response_model=KnowledgeListResponse)
async def list_knowledge(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    tag: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    locale: Optional[str] = Query(None, description="Return zh-CN content if available"),
    sort: Optional[str] = Query("newest", description="Sort: newest, oldest, confidence"),
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    entries, total = await knowledge_service.list_entries(db, page, page_size, tag, status, search, sort, category)
    return KnowledgeListResponse(
        items=[KnowledgeEntryResponse.from_orm_entry(e, locale=locale) for e in entries],
        total=total,
        page=page,
        page_size=page_size,
    )



class CreateKnowledgeRequest(BaseModel):
    question_patterns: list[str]
    answer: str
    conditions: str | None = None
    tags: list[str] = []


@router.post("/", response_model=KnowledgeEntryResponse)
async def create_knowledge(request: CreateKnowledgeRequest, db: AsyncSession = Depends(get_db)):
    entry = await knowledge_service.create_entry(db, request.model_dump())
    # Auto-categorize if no category set
    if not entry.category:
        entry.category = auto_categorize(entry.answer or "", _parse_json_list(entry.tags))
    await db.commit()
    await db.refresh(entry)

    # Fire-and-forget background translation in thread pool (non-blocking)
    if not getattr(entry, "answer_zh", None):
        import concurrent.futures
        _executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        def _sync_translate(entry_id: str, qp: list[str], answer: str):
            import asyncio as _aio
            async def _run():
                try:
                    from app.services.claude_service import ClaudeService
                    from app.db.database import async_session
                    ai = ClaudeService()
                    result = await ai.translate_entry_bilingual(qp, answer)
                    async with async_session() as bg_db:
                        from app.models.knowledge import KnowledgeEntry as KE
                        stmt = select(KE).where(KE.id == entry_id)
                        row = (await bg_db.execute(stmt)).scalar_one_or_none()
                        if row:
                            row.question_patterns_zh = result.get("question_patterns_zh", [])
                            row.answer_zh = result.get("answer_zh", "")
                            await bg_db.commit()
                except Exception:
                    pass
            _aio.run(_run())
        _executor.submit(_sync_translate, entry.id, _parse_json_list(entry.question_patterns), entry.answer or "")

    return KnowledgeEntryResponse.from_orm_entry(entry)


@router.post("/batch", response_model=list[KnowledgeEntryResponse])
async def create_knowledge_batch(requests: list[CreateKnowledgeRequest], db: AsyncSession = Depends(get_db)):
    """Create multiple knowledge entries in one batch with a single log entry."""
    entries = await knowledge_service.create_entries_batch(
        db, [r.model_dump() for r in requests], method="auto"
    )
    # Auto-categorize
    for entry in entries:
        if not entry.category:
            entry.category = auto_categorize(entry.answer or "", _parse_json_list(entry.tags))
    await db.commit()

    # Fire-and-forget background translations for entries missing Chinese
    import concurrent.futures
    _executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    for entry in entries:
        if not getattr(entry, "answer_zh", None):
            def _sync_translate(entry_id: str, qp: list[str], answer: str):
                import asyncio as _aio
                async def _run():
                    try:
                        from app.services.claude_service import ClaudeService
                        from app.db.database import async_session
                        ai = ClaudeService()
                        result = await ai.translate_entry_bilingual(qp, answer)
                        async with async_session() as bg_db:
                            from app.models.knowledge import KnowledgeEntry as KE
                            stmt = select(KE).where(KE.id == entry_id)
                            row = (await bg_db.execute(stmt)).scalar_one_or_none()
                            if row:
                                row.question_patterns_zh = result.get("question_patterns_zh", [])
                                row.answer_zh = result.get("answer_zh", "")
                                await bg_db.commit()
                    except Exception:
                        pass
                _aio.run(_run())
            _executor.submit(_sync_translate, entry.id, _parse_json_list(entry.question_patterns), entry.answer or "")

    return [KnowledgeEntryResponse.from_orm_entry(e) for e in entries]


class ExtractResponse(BaseModel):
    status: str
    entries: list[dict]
    detected_question: str | None = None
    tags: list[str] = []


@router.post("/extract", response_model=ExtractResponse)
async def extract_knowledge(
    file: Optional[UploadFile] = File(None),
    text: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    try:
        if file and file.filename:  # Guard: require a real file upload
            content = await file.read()
            if not image_service.validate_image(content, file.content_type or "image/png"):
                raise HTTPException(status_code=400, detail="Invalid image. Please upload PNG, JPEG, WebP, or GIF under 10MB.")
            
            processed = image_service.preprocess(content)
            extraction = await knowledge_service.extract_from_image(processed, "image/png")
            
            extracted_text = extraction.get("extracted_text", "")
            entries = await knowledge_service.extract_from_text(extracted_text) if extracted_text else []
            
            await _log_action(
                db, action="extracted", method="screenshot",
                count=len(entries),
                source_filename=file.filename,
                details={"detected_question": extraction.get("detected_question")},
            )
            await db.commit()

            for e in entries:
                e["category"] = auto_categorize(e.get("answer", ""), e.get("tags", []), e.get("category"))

            return ExtractResponse(
                status="success",
                entries=entries,
                detected_question=extraction.get("detected_question"),
                tags=extraction.get("tags", []),
            )
        elif text:
            entries = await knowledge_service.extract_from_text(text)
            await _log_action(
                db, action="extracted", method="document",
                count=len(entries),
                details={"text_length": len(text)},
            )
            await db.commit()
            for e in entries:
                e["category"] = auto_categorize(e.get("answer", ""), e.get("tags", []), e.get("category"))
            return ExtractResponse(status="success", entries=entries)
        else:
            raise HTTPException(status_code=400, detail="Provide either a file or text content.")
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


class BatchExtractResponse(BaseModel):
    total_files: int
    successful: int
    failed: int
    entries: list[dict]


async def _extract_single_file(
    file: UploadFile,
    db: AsyncSession,
) -> dict:
    """Extract knowledge from a single file. Returns a per-file result dict."""
    filename = file.filename or "unknown"
    try:
        content = await file.read()
        is_image = (file.content_type or "").startswith("image/")

        if is_image:
            if not image_service.validate_image(content, file.content_type or "image/png"):
                return {"filename": filename, "status": "error", "error": "Invalid image", "entries": []}

            processed = image_service.preprocess(content)
            extraction = await knowledge_service.extract_from_image(processed, "image/png")
            extracted_text = extraction.get("extracted_text", "")
            entries = await knowledge_service.extract_from_text(extracted_text) if extracted_text else []
        else:
            from app.services.document_service import DocumentService
            from app.services.claude_service import ClaudeService

            doc_service = DocumentService()
            try:
                text = await doc_service.parse(content, filename)
            except ValueError as e:
                return {"filename": filename, "status": "error", "error": str(e), "entries": []}

            if not text.strip():
                return {"filename": filename, "status": "error", "error": "No text content", "entries": []}

            if len(text) > 50000:
                text = text[:50000] + "\n\n[... truncated ...]"

            claude_service = ClaudeService()
            entries = await claude_service.extract_knowledge(text)

        for e in entries:
            e["category"] = auto_categorize(e.get("answer", ""), e.get("tags", []), e.get("category"))

        return {"filename": filename, "status": "success", "entries": entries}

    except Exception as e:
        return {"filename": filename, "status": "error", "error": str(e), "entries": []}


@router.post("/extract-batch", response_model=BatchExtractResponse)
async def extract_knowledge_batch(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Extract knowledge from multiple files in parallel."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    tasks = [_extract_single_file(f, db) for f in files]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_entries: list[dict] = []
    successful = 0
    failed = 0

    for i, result in enumerate(results):
        fname = files[i].filename or "unknown"
        if isinstance(result, Exception):
            failed += 1
            continue
        if result.get("status") == "success":
            successful += 1
            all_entries.extend(result.get("entries", []))
        else:
            failed += 1

    await _log_action(
        db,
        action="extracted",
        method="batch",
        count=len(all_entries),
        details={"total_files": len(files), "successful": successful, "failed": failed},
    )
    await db.commit()

    return BatchExtractResponse(
        total_files=len(files),
        successful=successful,
        failed=failed,
        entries=all_entries,
    )


@router.post("/import-document")
async def import_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Import a document file and extract knowledge entries."""
    from app.services.document_service import DocumentService
    from app.services.claude_service import ClaudeService, ClaudeServiceError

    doc_service = DocumentService()

    content = await file.read()
    filename = file.filename or "unknown.txt"

    try:
        text = await doc_service.parse(content, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not text.strip():
        raise HTTPException(status_code=400, detail="No text content extracted from document")

    # Log extracted text length for debugging
    import logging
    _log = logging.getLogger(__name__)
    _log.warning("=== import_document: Extracted %d chars from %s ===", len(text), filename)
    print(f"[import_document] Extracted {len(text)} chars from {filename}", flush=True)

    try:
        claude_service = ClaudeService()
        entries = await claude_service.extract_knowledge(text)
    except ClaudeServiceError as e:
        print(f"[import_document] ClaudeServiceError: {e}", flush=True)
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[import_document] Unexpected error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Knowledge extraction failed: {str(e)}")

    await _log_action(
        db, action="extracted", method="document",
        count=len(entries),
        source_filename=filename,
        details={"text_length": len(text)},
    )
    await db.commit()

    for e in entries:
        e["category"] = auto_categorize(e.get("answer", ""), e.get("tags", []), e.get("category"))

    return {
        "status": "success",
        "filename": filename,
        "text_length": len(text),
        "entries": entries,
    }


@router.get("/logs")
async def get_knowledge_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action: str | None = Query(None, description="Filter by action type"),
    search: str | None = Query(None, description="Search in details/source_filename"),
    db: AsyncSession = Depends(get_db),
):
    """Get knowledge growth log entries with optional filters."""
    from app.models.knowledge import KnowledgeLog
    from sqlalchemy import select, func, or_

    filters = []
    if action:
        filters.append(KnowledgeLog.action == action)
    if search:
        term = f"%{search}%"
        filters.append(
            or_(
                KnowledgeLog.details.ilike(term),
                KnowledgeLog.source_filename.ilike(term),
            )
        )

    count_q = select(func.count()).select_from(KnowledgeLog)
    if filters:
        count_q = count_q.where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    q = select(KnowledgeLog).order_by(KnowledgeLog.created_at.desc())
    if filters:
        q = q.where(*filters)
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": log.id,
                "action": log.action,
                "method": log.method,
                "count": log.count,
                "details": log.details,
                "source_filename": log.source_filename,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.put("/{entry_id}", response_model=KnowledgeEntryResponse)
async def update_knowledge(entry_id: str, request: CreateKnowledgeRequest, db: AsyncSession = Depends(get_db)):
    entry = await knowledge_service.update_entry(db, entry_id, request.model_dump())
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    return KnowledgeEntryResponse.from_orm_entry(entry)


@router.delete("/{entry_id}")
async def delete_knowledge(entry_id: str, db: AsyncSession = Depends(get_db)):
    success = await knowledge_service.delete_entry(db, entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    return {"status": "deleted", "id": entry_id}


class TranslateRequest(BaseModel):
    entry_ids: list[str]
    locale: str  # "zh-CN" or "zh-TW"


@router.post("/translate")
async def translate_entries(request: TranslateRequest, db: AsyncSession = Depends(get_db)):
    """Translate knowledge entries to the requested locale using AI.
    Writes translations to both TranslationCache and KnowledgeEntry zh columns."""
    if request.locale == "en":
        return {"translated": 0, "message": "Content is already in English"}

    from app.services.claude_service import ClaudeService

    try:
        ai = ClaudeService()
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))

    translated = 0
    ids_to_translate = request.entry_ids[:50]  # Max 50 per batch

    # Check which already have cached translations
    result = await db.execute(
        select(TranslationCache.entry_id).where(
            TranslationCache.locale == request.locale,
            TranslationCache.entry_id.in_(ids_to_translate),
        )
    )
    cached_ids = {row[0] for row in result.all()}
    translated += len(cached_ids)

    for eid in ids_to_translate:
        if eid in cached_ids:
            continue

        entry = await knowledge_service.get_entry(db, eid)
        if not entry:
            continue

        qp = _parse_json_list(entry.question_patterns)
        answer = entry.answer or ""
        text_to_translate = f"QUESTIONS:\n" + "\n".join(qp) + f"\n\nANSWER:\n{answer}"

        try:
            result_text = await ai.translate_text(text_to_translate, request.locale)
            parts = result_text.split("\nANSWER:\n", 1) if "\nANSWER:\n" in result_text else result_text.split("\n\n", 1)
            if len(parts) == 2:
                q_part = parts[0].replace("QUESTIONS:\n", "").replace("QUESTIONS：\n", "").strip()
                translated_qp = [q.strip() for q in q_part.split("\n") if q.strip()]
                translated_answer = parts[1].strip()
            else:
                translated_qp = qp
                translated_answer = result_text.strip()

            # Save to TranslationCache
            import json
            tc = TranslationCache(
                entry_id=eid,
                locale=request.locale,
                question_patterns=json.dumps(translated_qp) if isinstance(translated_qp, list) else translated_qp,
                answer=translated_answer,
            )
            await db.merge(tc)

            # Also write back to KnowledgeEntry zh columns
            if request.locale in ("zh-CN", "zh-TW"):
                entry.question_patterns_zh = translated_qp
                entry.answer_zh = translated_answer

            await db.commit()
            translated += 1
        except Exception:
            continue

    return {"translated": translated, "total": len(request.entry_ids), "locale": request.locale}


class FeishuImportRequest(BaseModel):
    url: str


@router.post("/extract-feishu", response_model=ExtractResponse)
async def extract_from_feishu(request: FeishuImportRequest, db: AsyncSession = Depends(get_db)):
    """Extract knowledge entries from a Feishu wiki/doc link."""
    from app.services.feishu_service import fetch_feishu_content

    result = await fetch_feishu_content(request.url)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    content = result.get("content", "")
    if not content or len(content.strip()) < 20:
        raise HTTPException(status_code=400, detail="Document content is empty or too short.")

    try:
        entries = await knowledge_service.extract_from_text(content)
    except ClaudeServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))

    await _log_action(
        db, action="extracted", method="feishu",
        count=len(entries),
        source_filename=result.get("title", request.url),
        details={"url": request.url, "text_length": len(content)},
    )
    await db.commit()

    for e in entries:
        e["category"] = auto_categorize(e.get("answer", ""), e.get("tags", []), e.get("category"))

    return ExtractResponse(status="success", entries=entries)


@router.post("/suggest-merges")
async def suggest_merges(db: AsyncSession = Depends(get_db)):
    """Analyze knowledge base and suggest entries that can be merged."""
    from app.services.claude_service import ClaudeService, ClaudeServiceError

    result = await db.execute(
        select(KnowledgeEntry).where(KnowledgeEntry.status == "active")
    )
    entries = result.scalars().all()

    if len(entries) < 2:
        return {"suggestions": [], "message": "Not enough entries to analyze"}

    # Convert to dicts for Claude
    entry_dicts = []
    for e in entries:
        patterns = e.question_patterns if isinstance(e.question_patterns, list) else []
        tags = e.tags if isinstance(e.tags, list) else []
        entry_dicts.append({
            "id": e.id,
            "question_patterns": patterns,
            "answer": e.answer or "",
            "tags": tags,
            "category": e.category or "General",
        })

    # Process in batches by category to keep prompt size manageable
    all_suggestions = []
    categories = set(e["category"] for e in entry_dicts)
    for cat in categories:
        cat_entries = [e for e in entry_dicts if e["category"] == cat]
        if len(cat_entries) < 2:
            continue
        try:
            claude_service = ClaudeService()
            suggestions = await claude_service.suggest_merges(cat_entries)
            all_suggestions.extend(suggestions)
        except ClaudeServiceError as e:
            print(f"[suggest-merges] Error for category {cat}: {e}", flush=True)

    return {"suggestions": all_suggestions, "total_entries": len(entries)}


@router.post("/merge")
async def merge_entries(
    request: dict,
    db: AsyncSession = Depends(get_db),
):
    """Merge multiple knowledge entries into one.
    Request body: {
        "source_ids": ["id1", "id2", ...],
        "merged_question_patterns": ["Q1?", "Q2?"],
        "merged_answer": "Combined answer",
        "merged_tags": ["tag1", "tag2"],
        "merged_category": "Security"
    }
    """
    source_ids = request.get("source_ids", [])
    if len(source_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 entries to merge")

    # Verify all source entries exist
    result = await db.execute(
        select(KnowledgeEntry).where(KnowledgeEntry.id.in_(source_ids))
    )
    source_entries = result.scalars().all()
    if len(source_entries) != len(source_ids):
        raise HTTPException(status_code=404, detail="Some source entries not found")

    import uuid
    # Create merged entry
    merged = KnowledgeEntry(
        id=str(uuid.uuid4()),
        question_patterns=request.get("merged_question_patterns", []),
        answer=request.get("merged_answer", ""),
        tags=request.get("merged_tags", []),
        category=request.get("merged_category", "General"),
        source_type="merged",
        status="active",
    )
    db.add(merged)

    # Archive source entries
    for entry in source_entries:
        entry.status = "archived"
        entry.source_ref = f"merged_into:{merged.id}"

    # Log the merge
    await _log_action(
        db, action="merged", method="manual",
        count=len(source_ids),
        details={"source_ids": source_ids, "merged_id": merged.id},
    )
    await db.commit()

    return {
        "status": "success",
        "merged_id": merged.id,
        "archived_count": len(source_ids),
    }


@router.post("/apply-learning")
async def apply_learning_suggestion(
    request: dict,
    db: AsyncSession = Depends(get_db),
):
    """Apply a knowledge learning suggestion from user edit analysis.
    Request body: {
        "action": "update" | "add",
        "entry_id": "xxx" (for update),
        "suggested_answer": "..." (for update),
        "question_patterns": [...] (for add),
        "answer": "..." (for add),
        "tags": [...] (for add),
        "category": "..." (for add)
    }
    """
    action = request.get("action")

    if action == "update":
        entry_id = request.get("entry_id")
        if not entry_id:
            raise HTTPException(status_code=400, detail="entry_id required for update")
        result = await db.execute(
            select(KnowledgeEntry).where(KnowledgeEntry.id == entry_id)
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")

        entry.answer = request.get("suggested_answer", entry.answer)
        entry.source_type = "refined"
        await _log_action(db, action="refined", method="auto", details={"entry_id": entry_id, "source": "user_edit"})
        await db.commit()
        return {"status": "updated", "entry_id": entry_id}

    elif action == "add":
        import uuid
        new_entry = KnowledgeEntry(
            id=str(uuid.uuid4()),
            question_patterns=request.get("question_patterns", []),
            answer=request.get("answer", ""),
            tags=request.get("tags", []),
            category=request.get("category", "General"),
            source_type="learned",
            status="active",
        )
        db.add(new_entry)
        await _log_action(db, action="learned", method="auto", details={"source": "user_edit"})
        await db.commit()
        return {"status": "added", "entry_id": new_entry.id}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
