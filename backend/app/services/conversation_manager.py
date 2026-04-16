"""In-memory conversation session manager with TTL expiry."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import uuid


@dataclass
class ConversationSession:
    session_id: str
    messages: list[dict] = field(default_factory=list)
    knowledge_context: list[dict] = field(default_factory=list)
    original_query: str = ""
    round_count: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_active: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ConversationManager:
    def __init__(self, ttl_seconds: int = 1800):
        self._sessions: dict[str, ConversationSession] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def _cleanup_expired(self):
        now = datetime.now(timezone.utc)
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if now - session.last_active > self._ttl
        ]
        for session_id in expired:
            del self._sessions[session_id]

    def create_session(self, knowledge_context: list[dict]) -> str:
        self._cleanup_expired()
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = ConversationSession(
            session_id=session_id,
            knowledge_context=list(knowledge_context),
        )
        return session_id

    def get_session(self, session_id: str) -> ConversationSession | None:
        self._cleanup_expired()
        session = self._sessions.get(session_id)
        if session is not None:
            session.last_active = datetime.now(timezone.utc)
        return session

    def add_user_message(self, session_id: str, content: str) -> list[dict]:
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found or expired")
        session.messages.append({"role": "user", "content": content})
        return list(session.messages)

    def add_assistant_message(self, session_id: str, content: str):
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found or expired")
        session.messages.append({"role": "assistant", "content": content})

    def increment_round(self, session_id: str):
        session = self.get_session(session_id)
        if session is not None:
            session.round_count += 1

    def get_messages_for_claude(self, session_id: str) -> list[dict]:
        session = self.get_session(session_id)
        if session is None:
            return []
        return list(session.messages)

    def should_summarize(self, session_id: str, threshold: int = 6) -> bool:
        session = self.get_session(session_id)
        if session is None:
            return False
        return len(session.messages) > threshold

    def compress_messages(self, session_id: str, summary: str):
        session = self.get_session(session_id)
        if session is None or len(session.messages) <= 2:
            return
        last_two = session.messages[-2:]
        session.messages = [
            {"role": "user", "content": f"[Previous conversation summary]: {summary}"},
            *last_two,
        ]
