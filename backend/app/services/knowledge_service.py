"""Knowledge management service with full CRUD."""
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.knowledge import KnowledgeEntry, KnowledgeLog
from app.services.claude_service import ClaudeService
import uuid
import json

logger = logging.getLogger(__name__)


async def _log_action(
    db: AsyncSession,
    action: str,
    method: str = "manual",
    count: int = 1,
    details: dict | None = None,
    source_filename: str | None = None,
):
    """Write a knowledge growth log entry."""
    log = KnowledgeLog(
        id=str(uuid.uuid4()),
        action=action,
        method=method,
        count=count,
        details=json.dumps(details) if details else None,
        source_filename=source_filename,
    )
    db.add(log)
    # Don't commit here — caller will commit


class KnowledgeService:
    def __init__(self):
        self.claude = ClaudeService()

    async def auto_translate_entry(self, db: AsyncSession, entry: KnowledgeEntry) -> KnowledgeEntry:
        """Auto-translate a knowledge entry to both EN and ZH, updating it in-place."""
        qp = entry.question_patterns or []
        answer = entry.answer or ""
        if not qp and not answer:
            return entry

        try:
            result = await self.claude.translate_entry_bilingual(qp, answer)
            entry.question_patterns = result.get("question_patterns_en", qp)
            entry.answer = result.get("answer_en", answer)
            entry.question_patterns_zh = result.get("question_patterns_zh", [])
            entry.answer_zh = result.get("answer_zh", "")
            await db.commit()
            await db.refresh(entry)
        except Exception as e:
            logger.warning("Auto-translation failed for entry %s: %s", entry.id, e)
            # Non-fatal: entry is still usable in source language
        return entry

    async def create_entry(self, db: AsyncSession, data: dict) -> KnowledgeEntry:
        # Ensure list fields are actual lists (prevent double-encoding)
        qp = data.get("question_patterns", [])
        if isinstance(qp, str):
            try:
                qp = json.loads(qp)
            except (json.JSONDecodeError, TypeError):
                qp = [qp]
        tags = data.get("tags", [])
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except (json.JSONDecodeError, TypeError):
                tags = [tags]

        entry = KnowledgeEntry(
            id=str(uuid.uuid4()),
            question_patterns=qp,
            answer=data["answer"],
            conditions=data.get("conditions"),
            tags=tags,
            confidence=data.get("confidence", 1.0),
            source_type=data.get("source_type", "manual"),
            source_ref=data.get("source_ref"),
            status=data.get("status", "active"),
        )
        db.add(entry)
        method = "manual"
        if data.get("source_type") == "extracted":
            method = "auto"
        await _log_action(db, action="created", method=method, details={
            "question": (data.get("question_patterns") or [""])[0][:100],
        })
        await db.commit()
        await db.refresh(entry)

        # Translation is handled as fire-and-forget in the API layer
        return entry

    async def get_entry(self, db: AsyncSession, entry_id: str) -> KnowledgeEntry | None:
        result = await db.execute(
            select(KnowledgeEntry).where(KnowledgeEntry.id == entry_id)
        )
        return result.scalar_one_or_none()

    async def list_entries(
        self, db: AsyncSession, page: int = 1, page_size: int = 20,
        tag: str | None = None, status: str | None = None, search: str | None = None,
        sort: str | None = "newest", category: str | None = None,
    ) -> tuple[list[KnowledgeEntry], int]:
        query = select(KnowledgeEntry)
        
        if status:
            query = query.where(KnowledgeEntry.status == status)
        if category:
            query = query.where(KnowledgeEntry.category == category)
        
        # Sort
        if sort == "oldest":
            query = query.order_by(KnowledgeEntry.updated_at.asc())
        elif sort == "confidence":
            query = query.order_by(KnowledgeEntry.confidence.desc())
        else:  # newest (default)
            query = query.order_by(KnowledgeEntry.updated_at.desc())
        
        count_result = await db.execute(query)
        all_entries = count_result.scalars().all()
        
        # Filter by tag and search in Python (SQLite JSON support is limited)
        filtered = all_entries
        if tag:
            filtered = [e for e in filtered if tag in (e.tags or [])]
        if search:
            search_lower = search.lower()
            filtered = [
                e for e in filtered
                if search_lower in (e.answer or "").lower()
                or search_lower in (getattr(e, "answer_zh", "") or "").lower()
                or any(search_lower in p.lower() for p in (e.question_patterns or []))
            ]
        
        total = len(filtered)
        start = (page - 1) * page_size
        paginated = filtered[start:start + page_size]
        
        return paginated, total

    async def update_entry(self, db: AsyncSession, entry_id: str, data: dict) -> KnowledgeEntry | None:
        entry = await self.get_entry(db, entry_id)
        if not entry:
            return None
        
        content_changed = False
        for key, value in data.items():
            if hasattr(entry, key) and value is not None:
                if key in ("question_patterns", "answer") and getattr(entry, key) != value:
                    content_changed = True
                setattr(entry, key, value)
        
        await _log_action(db, action="updated", details={"entry_id": entry_id})
        await db.commit()
        await db.refresh(entry)

        # Translation is handled as fire-and-forget in the API layer
        return entry

    async def delete_entry(self, db: AsyncSession, entry_id: str) -> bool:
        entry = await self.get_entry(db, entry_id)
        if not entry:
            return False
        await _log_action(db, action="deleted", details={"entry_id": entry_id})
        await db.delete(entry)
        await db.commit()
        return True

    async def extract_from_text(self, text: str) -> list[dict]:
        """Use Claude to extract knowledge entries from text."""
        return await self.claude.extract_knowledge(text)

    async def extract_from_image(self, image_bytes: bytes, mime_type: str) -> dict:
        """Use Claude Vision to extract info from screenshot."""
        return await self.claude.extract_from_image(image_bytes, mime_type)
