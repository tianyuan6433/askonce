from sqlalchemy import Column, String, Float, Text, DateTime, JSON, Integer, func
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime
import uuid


class Base(DeclarativeBase):
    pass


class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    question_patterns = Column(JSON, nullable=False, default=list)  # list[str] (English)
    answer = Column(Text, nullable=False)  # English
    question_patterns_zh = Column(JSON, nullable=True, default=list)  # list[str] (Chinese)
    answer_zh = Column(Text, nullable=True)  # Simplified Chinese translation
    conditions = Column(Text, nullable=True)
    tags = Column(JSON, default=list)  # list[str]
    category = Column(String(50), nullable=True)  # for grouping/filtering
    confidence = Column(Float, default=1.0)
    source_type = Column(String(20), default="manual")  # manual | extracted | refined
    source_ref = Column(String(512), nullable=True)
    status = Column(String(20), default="active")  # active | review | archived
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class KnowledgeLog(Base):
    __tablename__ = "knowledge_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    action = Column(String(20), nullable=False)  # created, updated, deleted, imported, extracted
    method = Column(String(20), default="manual")  # manual, screenshot, document, api, auto
    count = Column(Integer, default=1)
    details = Column(Text, nullable=True)  # JSON details
    source_filename = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TranslationCache(Base):
    __tablename__ = "translation_cache"

    entry_id = Column(String(36), primary_key=True)
    locale = Column(String(10), primary_key=True)  # zh-CN, zh-TW
    question_patterns = Column(JSON, default=list)
    answer = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
