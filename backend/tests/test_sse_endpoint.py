"""Tests for the SSE streaming endpoint POST /api/ask/stream."""
import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock


MOCK_RESULTS = [
    {
        "id": "kb1",
        "question_patterns": ["How to factory reset?"],
        "answer": "Press and hold the reset button for 10 seconds.",
        "score": 0.85,
    }
]


async def _fake_stream_reply(**kwargs):
    """Fake generate_reply_stream that yields token events then done."""
    yield {"type": "token", "text": "Hello "}
    yield {"type": "token", "text": "World"}
    yield {"type": "done", "full_text": "Hello World"}


async def _fake_stream_clarification(**kwargs):
    """Fake generate_reply_stream that yields tokens then clarification."""
    yield {"type": "token", "text": '{"type":"clarification"}'}
    yield {
        "type": "clarification",
        "questions": [{"id": "q1", "text": "Which model?", "options": ["A", "B"]}],
    }


def _patch_services(
    retrieve_results=None,
    confidence=0.85,
    stream_fn=None,
    chat_return="中文翻译",
):
    """Return a context-manager that patches retrieval + Claude services."""
    if retrieve_results is None:
        retrieve_results = MOCK_RESULTS
    if stream_fn is None:
        stream_fn = _fake_stream_reply

    retrieve_mock = AsyncMock(return_value=retrieve_results)
    conf_mock = MagicMock(return_value=confidence)
    chat_mock = MagicMock(return_value=chat_return)

    claude_instance = MagicMock()
    claude_instance.generate_reply_stream = stream_fn
    claude_instance._chat = chat_mock

    patches = [
        patch("app.api.ask.retrieval_service.retrieve", retrieve_mock),
        patch("app.api.ask.retrieval_service.compute_confidence", conf_mock),
        patch("app.api.ask.get_claude_service", return_value=claude_instance),
    ]
    return patches, claude_instance


class TestSSEStreamEndpoint:
    @pytest.mark.asyncio
    async def test_stream_returns_sse_events(self, client, db_session):
        """Stream endpoint yields thinking, session, token, and complete events."""
        patches, _ = _patch_services(confidence=0.95)
        for p in patches:
            p.start()
        try:
            response = await client.post(
                "/api/ask/stream",
                json={"query": "How to factory reset?"},
            )
            assert response.status_code == 200
            text = response.text

            # Should contain SSE event types
            assert "event: thinking" in text
            assert "event: session" in text
            assert "event: token" in text
            assert "event: complete" in text

            # Extract complete event data
            for line in text.split("\n"):
                if line.startswith("data:") and "reply_en" in line:
                    data = json.loads(line[5:].strip())
                    assert data["reply_en"] == "Hello World"
                    assert "reply_zh" in data
                    assert "session_id" in data
                    break
        finally:
            for p in patches:
                p.stop()

    @pytest.mark.asyncio
    async def test_stream_creates_new_session(self, client, db_session):
        """When no session_id provided, a new session is created."""
        patches, _ = _patch_services(confidence=0.95)
        for p in patches:
            p.start()
        try:
            response = await client.post(
                "/api/ask/stream",
                json={"query": "test question"},
            )
            text = response.text
            # Extract session event
            session_id = None
            for line in text.split("\n"):
                if line.startswith("data:") and "session_id" in line:
                    try:
                        data = json.loads(line[5:].strip())
                        if "session_id" in data and "reply_en" not in data:
                            session_id = data["session_id"]
                            break
                    except json.JSONDecodeError:
                        continue
            assert session_id is not None
        finally:
            for p in patches:
                p.stop()

    @pytest.mark.asyncio
    async def test_stream_clarification_from_claude(self, client, db_session):
        """When Claude returns clarification JSON, stream yields clarification event."""
        # Confidence must be >= threshold so rule engine doesn't intercept
        patches, _ = _patch_services(
            confidence=0.85,
            stream_fn=_fake_stream_clarification,
        )
        for p in patches:
            p.start()
        try:
            response = await client.post(
                "/api/ask/stream",
                json={"query": "How do I set up?"},
            )
            text = response.text
            assert "event: clarification" in text

            # Parse clarification data (from Claude, not rule engine)
            for line in text.split("\n"):
                if line.startswith("data:") and "questions" in line:
                    data = json.loads(line[5:].strip())
                    if "questions" in data:
                        assert len(data["questions"]) > 0
                        assert data["questions"][0]["id"] == "q1"
                        break
        finally:
            for p in patches:
                p.stop()

    @pytest.mark.asyncio
    async def test_stream_rule_engine_max_rounds(self, client, db_session):
        """When max rounds reached, rule engine forces direct answer (no clarification)."""
        # Track whether force_direct_answer was True
        captured_kwargs = {}

        async def _tracking_stream(**kwargs):
            captured_kwargs.update(kwargs)
            async for event in _fake_stream_reply(**kwargs):
                yield event

        patches, claude = _patch_services(confidence=0.4)
        claude.generate_reply_stream = _tracking_stream
        for p in patches:
            p.start()
        try:
            # Pre-populate session with high round count
            from app.api.ask import conversation_mgr
            sid = conversation_mgr.create_session(knowledge_context=MOCK_RESULTS)
            session = conversation_mgr.get_session(sid)
            session.round_count = 10  # exceed max_rounds (default 3)

            response = await client.post(
                "/api/ask/stream",
                json={"query": "help me", "session_id": sid},
            )
            text = response.text
            # Rule engine should force answer — tokens and complete, no clarification
            assert "event: token" in text
            assert "event: complete" in text
            assert "event: clarification" not in text

            # Verify force_direct_answer was True
            assert captured_kwargs.get("force_direct_answer") is True
        finally:
            for p in patches:
                p.stop()

    @pytest.mark.asyncio
    async def test_stream_forced_multiturn_clarification(self, client, db_session):
        """First round always forces clarification via Claude."""
        patches, _ = _patch_services(
            confidence=0.85,
            stream_fn=_fake_stream_clarification,
        )
        for p in patches:
            p.start()
        try:
            response = await client.post(
                "/api/ask/stream",
                json={"query": "How much does it cost?"},
            )
            text = response.text
            # Forced multi-turn: round 0 always clarifies
            assert "event: clarification" in text
        finally:
            for p in patches:
                p.stop()

    @pytest.mark.asyncio
    async def test_stream_saves_interaction(self, client, db_session):
        """A complete stream response saves an Interaction to the database."""
        patches, _ = _patch_services(confidence=0.95)
        for p in patches:
            p.start()
        try:
            response = await client.post(
                "/api/ask/stream",
                json={"query": "How to factory reset?"},
            )
            assert response.status_code == 200

            # Check DB has a new interaction
            from sqlalchemy import text
            result = await db_session.execute(
                text("SELECT COUNT(*) FROM interactions WHERE query_text = 'How to factory reset?'")
            )
            count = result.scalar()
            assert count >= 1
        finally:
            for p in patches:
                p.stop()
