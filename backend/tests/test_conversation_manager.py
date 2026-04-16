import time

import pytest

from app.services.conversation_manager import ConversationManager


class TestConversationManager:
    def setup_method(self):
        self.mgr = ConversationManager(ttl_seconds=5)

    def test_create_session_returns_id(self):
        sid = self.mgr.create_session(knowledge_context=[{"id": "k1", "answer": "test"}])
        assert isinstance(sid, str)
        assert len(sid) == 36

    def test_get_session_returns_session(self):
        sid = self.mgr.create_session(knowledge_context=[])
        session = self.mgr.get_session(sid)
        assert session is not None
        assert session.messages == []
        assert session.round_count == 0

    def test_get_session_nonexistent_returns_none(self):
        assert self.mgr.get_session("nonexistent") is None

    def test_add_user_message(self):
        sid = self.mgr.create_session(knowledge_context=[])
        messages = self.mgr.add_user_message(sid, "Hello")
        assert len(messages) == 1
        assert messages[0] == {"role": "user", "content": "Hello"}

    def test_add_assistant_message(self):
        sid = self.mgr.create_session(knowledge_context=[])
        self.mgr.add_user_message(sid, "Hello")
        self.mgr.add_assistant_message(sid, "Hi there")
        session = self.mgr.get_session(sid)
        assert len(session.messages) == 2
        assert session.messages[1] == {"role": "assistant", "content": "Hi there"}

    def test_increment_round(self):
        sid = self.mgr.create_session(knowledge_context=[])
        self.mgr.increment_round(sid)
        self.mgr.increment_round(sid)
        assert self.mgr.get_session(sid).round_count == 2

    def test_ttl_expiry(self):
        mgr = ConversationManager(ttl_seconds=1)
        sid = mgr.create_session(knowledge_context=[])
        assert mgr.get_session(sid) is not None
        time.sleep(1.5)
        assert mgr.get_session(sid) is None

    def test_get_messages_for_claude_under_threshold(self):
        sid = self.mgr.create_session(knowledge_context=[])
        self.mgr.add_user_message(sid, "Q1")
        self.mgr.add_assistant_message(sid, "A1")
        messages = self.mgr.get_messages_for_claude(sid)
        assert len(messages) == 2
        assert messages[0]["role"] == "user"

    def test_should_summarize_false_under_threshold(self):
        sid = self.mgr.create_session(knowledge_context=[])
        self.mgr.add_user_message(sid, "Q1")
        self.mgr.add_assistant_message(sid, "A1")
        assert self.mgr.should_summarize(sid, threshold=6) is False

    def test_should_summarize_true_over_threshold(self):
        sid = self.mgr.create_session(knowledge_context=[])
        for i in range(4):
            self.mgr.add_user_message(sid, f"Q{i}")
            self.mgr.add_assistant_message(sid, f"A{i}")
        assert self.mgr.should_summarize(sid, threshold=6) is True

    def test_compress_messages(self):
        sid = self.mgr.create_session(knowledge_context=[])
        for i in range(4):
            self.mgr.add_user_message(sid, f"Q{i}")
            self.mgr.add_assistant_message(sid, f"A{i}")
        self.mgr.compress_messages(sid, summary="User asked about device setup.")
        session = self.mgr.get_session(sid)
        assert len(session.messages) == 3
        assert "device setup" in session.messages[0]["content"]
