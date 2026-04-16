from sqlalchemy import Column, String, Float, Text, DateTime, Integer, ForeignKey, func
from app.models.knowledge import Base
import uuid


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query_text = Column(Text, nullable=True)
    query_image_path = Column(String(512), nullable=True)
    channel = Column(String(32), default="manual")
    draft_reply = Column(Text, nullable=True)
    final_reply = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    status = Column(String(20), default="pending")
    edit_ratio = Column(Float, nullable=True)  # 0.0 = fully rewritten, 1.0 = copied verbatim
    elapsed_ms = Column(Integer, nullable=True)  # response time in milliseconds
    conversation_log = Column(Text, nullable=True)  # JSON array of {role, text} for multi-turn
    matched_knowledge_id = Column(String(36), ForeignKey("knowledge_entries.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)
