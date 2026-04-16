# Multi-Turn Conversation Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance AskOnce with true multi-turn clarification conversations, SSE streaming, rule engine, and fix the history blank-content bug.

**Architecture:** Progressive enhancement on existing codebase. New `ConversationManager` (in-memory sessions) and `RuleEngine` services feed into enhanced `ClaudeService` (true multi-turn messages + streaming). New SSE endpoints sit alongside existing REST endpoints. Frontend consumes SSE with typing animation.

**Tech Stack:** Python 3.10+ / FastAPI / Anthropic SDK / SSE (sse-starlette) / Next.js / React / TypeScript

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/app/services/conversation_manager.py` | In-memory session store with TTL |
| Create | `backend/app/services/rule_engine.py` | Pre-Claude clarification rules |
| Create | `backend/tests/test_conversation_manager.py` | ConversationManager unit tests |
| Create | `backend/tests/test_rule_engine.py` | RuleEngine unit tests |
| Create | `backend/tests/test_ask_stream.py` | SSE endpoint integration tests |
| Create | `backend/tests/test_history_bug.py` | History filter regression test |
| Modify | `backend/app/services/claude_service.py` | Add streaming + multi-turn methods |
| Modify | `backend/app/api/ask.py` | SSE endpoints + history filter + bilingual followup |
| Modify | `backend/app/api/settings.py` | Add `max_clarification_rounds` |
| Modify | `backend/app/config.py` | Add `max_clarification_rounds` default |
| Modify | `backend/requirements.txt` | Add `sse-starlette`, `pytest`, `pytest-asyncio`, `httpx` |
| Modify | `frontend/src/lib/api.ts` | Add `streamAsk`, `streamFollowup`, `AppSettings.max_clarification_rounds` |
| Modify | `frontend/src/app/ask/page.tsx` | SSE integration, thinking animation, round counter |
| Modify | `frontend/src/app/settings/page.tsx` | Max rounds slider |

---

### Task 1: Add Test Infrastructure + New Dependencies

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/pytest.ini`

- [ ] **Step 1: Add test dependencies to requirements.txt**

Append these lines to `backend/requirements.txt`:

```
pytest>=8.0.0
pytest-asyncio>=0.23.0
httpx>=0.28.0
sse-starlette>=2.0.0
```

- [ ] **Step 2: Create pytest config**

Create `backend/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

- [ ] **Step 3: Create test package and conftest**

Create `backend/tests/__init__.py` (empty file).

Create `backend/tests/conftest.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.models.knowledge import Base
from app.models.interaction import Interaction  # noqa: F401
from app.db.database import get_db
from app.main import app


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Install dependencies**

Run: `cd backend && pip install -r requirements.txt`

- [ ] **Step 5: Verify pytest runs**

Run: `cd backend && python -m pytest --co -q`
Expected: "no tests ran" (no test files yet, but no import errors)

---

### Task 2: ConversationManager

**Files:**
- Create: `backend/app/services/conversation_manager.py`
- Create: `backend/tests/test_conversation_manager.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_conversation_manager.py`:

```python
import time
import pytest
from app.services.conversation_manager import ConversationManager


class TestConversationManager:
    def setup_method(self):
        self.mgr = ConversationManager(ttl_seconds=5)

    def test_create_session_returns_id(self):
        sid = self.mgr.create_session(knowledge_context=[{"id": "k1", "answer": "test"}])
        assert isinstance(sid, str)
        assert len(sid) == 36  # UUID format

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
        # Should keep last 2 messages + prepend summary as system context
        assert len(session.messages) == 3  # summary + last user + last assistant
        assert "device setup" in session.messages[0]["content"]
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd backend && python -m pytest tests/test_conversation_manager.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ConversationManager**

Create `backend/app/services/conversation_manager.py`:

```python
"""In-memory conversation session manager with TTL expiry."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import uuid


@dataclass
class ConversationSession:
    session_id: str
    messages: list[dict] = field(default_factory=list)
    knowledge_context: list[dict] = field(default_factory=list)
    round_count: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_active: datetime = field(default_factory=datetime.utcnow)


class ConversationManager:
    def __init__(self, ttl_seconds: int = 1800):
        self._sessions: dict[str, ConversationSession] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def _cleanup_expired(self):
        now = datetime.utcnow()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.last_active > self._ttl
        ]
        for sid in expired:
            del self._sessions[sid]

    def create_session(self, knowledge_context: list[dict]) -> str:
        self._cleanup_expired()
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = ConversationSession(
            session_id=session_id,
            knowledge_context=knowledge_context,
        )
        return session_id

    def get_session(self, session_id: str) -> ConversationSession | None:
        self._cleanup_expired()
        session = self._sessions.get(session_id)
        if session:
            session.last_active = datetime.utcnow()
        return session

    def add_user_message(self, session_id: str, content: str) -> list[dict]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found or expired")
        session.messages.append({"role": "user", "content": content})
        return list(session.messages)

    def add_assistant_message(self, session_id: str, content: str):
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found or expired")
        session.messages.append({"role": "assistant", "content": content})

    def increment_round(self, session_id: str):
        session = self.get_session(session_id)
        if session:
            session.round_count += 1

    def get_messages_for_claude(self, session_id: str) -> list[dict]:
        session = self.get_session(session_id)
        if not session:
            return []
        return list(session.messages)

    def should_summarize(self, session_id: str, threshold: int = 6) -> bool:
        session = self.get_session(session_id)
        if not session:
            return False
        return len(session.messages) > threshold

    def compress_messages(self, session_id: str, summary: str):
        session = self.get_session(session_id)
        if not session or len(session.messages) <= 2:
            return
        last_two = session.messages[-2:]
        session.messages = [
            {"role": "user", "content": f"[Previous conversation summary]: {summary}"},
        ] + last_two
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd backend && python -m pytest tests/test_conversation_manager.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/conversation_manager.py backend/tests/
git commit -m "feat: add ConversationManager with TTL sessions and compression"
```

---

### Task 3: Rule Engine

**Files:**
- Create: `backend/app/services/rule_engine.py`
- Create: `backend/tests/test_rule_engine.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_rule_engine.py`:

```python
import pytest
from app.services.rule_engine import evaluate_rules, RuleEngineResult


class TestRuleEngine:
    def test_high_confidence_no_force(self):
        result = evaluate_rules(
            confidence=0.95,
            retrieval_results=[{"id": "k1"}],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is False
        assert result.should_force_answer is False

    def test_zero_matches_forces_clarify(self):
        result = evaluate_rules(
            confidence=0.0,
            retrieval_results=[],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True
        assert result.forced_questions is not None
        assert len(result.forced_questions) >= 1

    def test_low_confidence_forces_clarify(self):
        result = evaluate_rules(
            confidence=0.3,
            retrieval_results=[{"id": "k1"}],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True

    def test_max_rounds_forces_answer(self):
        result = evaluate_rules(
            confidence=0.3,
            retrieval_results=[],
            round_count=3,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_answer is True
        assert result.should_force_clarify is False

    def test_max_rounds_overrides_low_confidence(self):
        result = evaluate_rules(
            confidence=0.1,
            retrieval_results=[],
            round_count=5,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_answer is True
        assert result.should_force_clarify is False

    def test_first_round_low_confidence_with_results(self):
        result = evaluate_rules(
            confidence=0.45,
            retrieval_results=[{"id": "k1"}, {"id": "k2"}],
            round_count=1,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True
        assert result.reason != ""
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd backend && python -m pytest tests/test_rule_engine.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RuleEngine**

Create `backend/app/services/rule_engine.py`:

```python
"""Pre-Claude rule engine for clarification decisions."""
from dataclasses import dataclass


@dataclass
class ClarificationQuestion:
    id: str
    text: str
    options: list[str]


@dataclass
class RuleEngineResult:
    should_force_clarify: bool = False
    should_force_answer: bool = False
    forced_questions: list[ClarificationQuestion] | None = None
    reason: str = ""


def evaluate_rules(
    confidence: float,
    retrieval_results: list,
    round_count: int,
    max_rounds: int,
    confidence_threshold: float,
) -> RuleEngineResult:
    # Rule 1: Max rounds reached — force direct answer, no more clarification
    if round_count >= max_rounds:
        return RuleEngineResult(
            should_force_answer=True,
            reason=f"Max clarification rounds reached ({max_rounds})",
        )

    # Rule 2: Zero knowledge matches — force clarification
    if len(retrieval_results) == 0:
        return RuleEngineResult(
            should_force_clarify=True,
            forced_questions=[
                ClarificationQuestion(
                    id="rule_q1",
                    text="I couldn't find a direct match in our knowledge base. Could you provide more details or rephrase your question?",
                    options=[
                        "Let me rephrase my question",
                        "I need help with device setup",
                        "I have a billing question",
                        "I need technical support",
                    ],
                )
            ],
            reason="No matching knowledge entries found",
        )

    # Rule 3: Low confidence — force clarification
    if confidence < confidence_threshold:
        return RuleEngineResult(
            should_force_clarify=True,
            forced_questions=[
                ClarificationQuestion(
                    id="rule_q1",
                    text="I found some related information but I'm not fully confident in the match. Could you help me narrow it down?",
                    options=[
                        "Show me what you found",
                        "Let me add more context",
                        "Try your best answer",
                    ],
                )
            ],
            reason=f"Low confidence ({confidence:.2f} < {confidence_threshold})",
        )

    # No rules triggered
    return RuleEngineResult(reason="All checks passed")
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd backend && python -m pytest tests/test_rule_engine.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/rule_engine.py backend/tests/test_rule_engine.py
git commit -m "feat: add rule engine for pre-Claude clarification decisions"
```

---

### Task 4: Claude Service — Streaming + Multi-Turn

**Files:**
- Modify: `backend/app/services/claude_service.py`

- [ ] **Step 1: Add streaming generator method**

Add after the existing `_chat()` method (after line 186) in `claude_service.py`:

```python
    def _chat_stream(self, messages: list[dict], system: str = "", max_tokens: int = 2048):
        """Stream a Claude response, yielding text chunks.
        Falls back to non-streaming for proxies that don't support it."""
        kwargs = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            kwargs["system"] = system

        try:
            with self.client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    yield text
        except Exception:
            # Fallback: non-streaming call, yield entire response at once
            full_text = self._chat(messages, system=system, max_tokens=max_tokens)
            yield full_text
```

- [ ] **Step 2: Add multi-turn reply method**

Add after `_chat_stream()`:

```python
    async def generate_reply_stream(
        self,
        messages: list[dict],
        knowledge_context: str,
        force_direct_answer: bool = False,
        reply_lang: str = "en",
        reply_format: str = "chat",
    ):
        """Generate a streaming reply using full conversation history.
        
        Yields dicts with keys:
          {"type": "token", "text": "..."}
          {"type": "clarification", "questions": [...]}
          {"type": "done", "full_text": "..."}
        """
        format_hints = {
            "email": "[Format: formal email reply, sign off as Yuan]",
            "chat": "[Format: short casual chat message, no greeting/sign-off needed]",
            "other": "[Format: neutral professional reply]",
        }
        lang_hint = "[请用中文回复]" if reply_lang == "zh" else "[Reply in English]"
        format_hint = format_hints.get(reply_format, format_hints["chat"])

        system_suffix = ""
        if force_direct_answer:
            system_suffix = "\n\nIMPORTANT: Do NOT ask for clarification. Give your best answer with the information available."

        # Inject knowledge context into the latest user message
        last_user_msg = messages[-1]["content"] if messages else ""
        context_block = (
            f"\n\nKnowledge sources:\n{knowledge_context}\n\n"
            f"{lang_hint}\n{format_hint}\n\n"
        )
        if not force_direct_answer:
            context_block += (
                "CLARIFICATION PROTOCOL:\n"
                "Most of the time, just answer the question directly. Only ask for clarification if:\n"
                "1. The answer would be COMPLETELY DIFFERENT depending on a missing detail\n"
                "2. You literally cannot give ANY useful answer without that info\n"
                "3. The knowledge sources provide multiple conflicting answers for different scenarios\n\n"
                'If you DO need clarification, respond ONLY with this exact JSON (nothing else):\n'
                '{"type":"clarification","questions":[{"id":"q1","text":"Your question","options":["Option A","Option B"]}]}\n\n'
                "Rules: Max 3 questions, 2-5 options each. Prefer giving a general answer over asking.\n\n"
            )
        context_block += "Otherwise, output ONLY the final reply text — no JSON, no analysis, no metadata."

        augmented_messages = list(messages)
        augmented_messages[-1] = {
            "role": "user",
            "content": last_user_msg + context_block,
        }

        full_text = ""
        for chunk in self._chat_stream(
            augmented_messages,
            system=SYSTEM_PROMPT + system_suffix,
            max_tokens=2048,
        ):
            full_text += chunk
            yield {"type": "token", "text": chunk}

        # Check if the full response is a clarification JSON
        clarification = _parse_json_object(full_text)
        if clarification and clarification.get("type") == "clarification" and clarification.get("questions"):
            yield {"type": "clarification", "questions": clarification["questions"]}
        else:
            yield {"type": "done", "full_text": full_text}
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/claude_service.py
git commit -m "feat: add streaming and multi-turn methods to ClaudeService"
```

---

### Task 5: Settings — Add max_clarification_rounds

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/api/settings.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Add to backend config**

In `backend/app/config.py`, add after line 19 (`knowledge_stale_days`):

```python
    max_clarification_rounds: int = 3
```

- [ ] **Step 2: Add to settings API**

In `backend/app/api/settings.py`, add to `DEFAULT_SETTINGS` dict (after line 20):

```python
    "max_clarification_rounds": 3,
```

Add to `AppSettings` model (after line 36):

```python
    max_clarification_rounds: int = 3
```

- [ ] **Step 3: Add to frontend AppSettings interface**

In `frontend/src/lib/api.ts`, add to the `AppSettings` interface (after `ai_summaries: boolean;`):

```typescript
  max_clarification_rounds: number;
```

- [ ] **Step 4: Add slider to Settings page**

In `frontend/src/app/settings/page.tsx`, add a new slider in the AI Configuration section (after the draft threshold slider). Find the section with `confidence_draft_min` slider and add after its closing `</div>`:

```tsx
{/* Max Clarification Rounds */}
<div>
  <label className="block text-sm font-medium text-on-surface mb-2">
    Max Clarification Rounds
  </label>
  <div className="flex items-center gap-4">
    <input
      type="range"
      min={1}
      max={10}
      step={1}
      value={aiConfig.max_clarification_rounds ?? 3}
      onChange={(e) => setAiConfig({ ...aiConfig, max_clarification_rounds: parseInt(e.target.value) })}
      className="flex-1 accent-primary"
    />
    <span className="text-sm font-mono w-8 text-center">{aiConfig.max_clarification_rounds ?? 3}</span>
  </div>
  <p className="text-xs text-on-surface-variant mt-1">
    Maximum times AI can ask follow-up questions before giving its best answer
  </p>
</div>
```

- [ ] **Step 5: Verify settings page loads**

Run the dev server and visit `/settings`. Confirm the new slider appears and saves correctly.

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/api/settings.py frontend/src/lib/api.ts frontend/src/app/settings/page.tsx
git commit -m "feat: add configurable max_clarification_rounds setting"
```

---

### Task 6: Bug Fix — History Blank Content

**Files:**
- Create: `backend/tests/test_history_bug.py`
- Modify: `backend/app/api/ask.py`
- Modify: `frontend/src/app/ask/page.tsx`

- [ ] **Step 1: Write failing regression test**

Create `backend/tests/test_history_bug.py`:

```python
import pytest
import uuid
from app.models.interaction import Interaction


class TestHistoryFilter:
    @pytest.mark.asyncio
    async def test_history_excludes_null_draft_reply(self, client, db_session):
        # Create an interaction WITH draft_reply
        good = Interaction(
            id=str(uuid.uuid4()),
            query_text="What is Pivot Plus?",
            draft_reply="Pivot Plus is a platform...",
            channel="manual",
            confidence=0.9,
            status="draft",
        )
        # Create an interaction WITHOUT draft_reply (clarification in progress)
        bad = Interaction(
            id=str(uuid.uuid4()),
            query_text="Tell me about pricing",
            draft_reply=None,
            final_reply=None,
            channel="manual",
            confidence=0.3,
            status="pending",
        )
        db_session.add(good)
        db_session.add(bad)
        await db_session.commit()

        response = await client.get("/api/ask/history?limit=10")
        assert response.status_code == 200
        data = response.json()
        ids = [item["id"] for item in data["items"]]
        assert good.id in ids
        assert bad.id not in ids

    @pytest.mark.asyncio
    async def test_history_includes_final_reply_only(self, client, db_session):
        # Interaction with final_reply but no draft_reply
        item = Interaction(
            id=str(uuid.uuid4()),
            query_text="How do I enroll?",
            draft_reply=None,
            final_reply="You can enroll via...",
            channel="manual",
            confidence=0.8,
            status="draft",
        )
        db_session.add(item)
        await db_session.commit()

        response = await client.get("/api/ask/history?limit=10")
        data = response.json()
        ids = [i["id"] for i in data["items"]]
        assert item.id in ids
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd backend && python -m pytest tests/test_history_bug.py -v`
Expected: FAIL — `bad.id` appears in results (no filter)

- [ ] **Step 3: Fix backend — add filter to history endpoint**

In `backend/app/api/ask.py`, modify the history endpoint query. Find line 459:

```python
        .where(Interaction.query_text.isnot(None))
```

Replace with:

```python
        .where(Interaction.query_text.isnot(None))
        .where(
            or_(
                Interaction.draft_reply.isnot(None),
                Interaction.final_reply.isnot(None),
            )
        )
```

Also add `or_` to the import at line 456. Change:

```python
    from sqlalchemy import select, desc, func as sqlfunc
```

To:

```python
    from sqlalchemy import select, desc, func as sqlfunc, or_
```

Also update the total count query (line 467) similarly. Change:

```python
    total_result = await db.execute(
        select(sqlfunc.count()).select_from(Interaction).where(Interaction.query_text.isnot(None))
    )
```

To:

```python
    total_result = await db.execute(
        select(sqlfunc.count()).select_from(Interaction)
        .where(Interaction.query_text.isnot(None))
        .where(or_(Interaction.draft_reply.isnot(None), Interaction.final_reply.isnot(None)))
    )
```

- [ ] **Step 4: Run test — verify it passes**

Run: `cd backend && python -m pytest tests/test_history_bug.py -v`
Expected: All 2 tests PASS

- [ ] **Step 5: Fix frontend — friendly message for null draft_reply**

In `frontend/src/app/ask/page.tsx`, find line 979:

```tsx
{item.draft_reply || item.final_reply}
```

Replace with:

```tsx
{item.draft_reply || item.final_reply || "⏳ Clarification in progress"}
```

Find line 1079 (detail panel):

```tsx
{selectedHistoryItem.draft_reply || "—"}
```

Replace with:

```tsx
{selectedHistoryItem.draft_reply || selectedHistoryItem.final_reply || "⏳ Clarification in progress — no reply generated yet"}
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/ask.py backend/tests/test_history_bug.py frontend/src/app/ask/page.tsx
git commit -m "fix: filter incomplete interactions from history, show friendly message"
```

---

### Task 7: Followup Bilingual Fix

**Files:**
- Modify: `backend/app/api/ask.py`

- [ ] **Step 1: Fix followup to use bilingual reply**

In `backend/app/api/ask.py`, find the followup endpoint (line 284–287):

```python
        reply_data = await claude_service.generate_reply(
            augmented_query, results, followup_context=followup_context
        )
```

Replace with:

```python
        reply_data = await claude_service.generate_bilingual_reply(
            request.original_query, results,
            reply_format=request.reply_format,
            followup_context=followup_context,
        )
```

- [ ] **Step 2: Update followup response to include bilingual fields**

Find lines 343–351 (the final AskResponse in followup):

```python
    return AskResponse(
        id=interaction.id,
        query=request.original_query,
        draft_reply=reply_data.get("reply", ""),
        confidence=confidence,
        sources=results[:3],
        status=status,
        elapsed_ms=elapsed_ms,
    )
```

Replace with:

```python
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
```

Also update the interaction draft_reply save (line 321):

```python
        interaction.draft_reply = reply_data.get("reply", "")
```

Replace with:

```python
        interaction.draft_reply = reply_data.get("reply_en") or reply_data.get("reply", "")
```

- [ ] **Step 3: Verify no regressions**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/ask.py
git commit -m "fix: use bilingual reply for followup responses"
```

---

### Task 8: SSE Streaming Endpoints

**Files:**
- Create: `backend/tests/test_ask_stream.py`
- Modify: `backend/app/api/ask.py`

- [ ] **Step 1: Write SSE endpoint test**

Create `backend/tests/test_ask_stream.py`:

```python
import pytest
import json


class TestSSEStream:
    @pytest.mark.asyncio
    async def test_stream_endpoint_returns_sse(self, client):
        """Test that /api/ask/stream returns SSE content type."""
        response = await client.post(
            "/api/ask/stream",
            json={"query": "What is Pivot Plus?", "channel": "manual"},
        )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    @pytest.mark.asyncio
    async def test_stream_events_have_correct_format(self, client):
        """Test that SSE events follow the expected format."""
        response = await client.post(
            "/api/ask/stream",
            json={"query": "What is Pivot Plus?", "channel": "manual"},
        )
        body = response.text
        # Should contain at least a session event and either token or clarification events
        assert "event:" in body
        # Should contain session_id
        assert "session" in body.lower() or "thinking" in body.lower()
```

- [ ] **Step 2: Implement SSE streaming endpoint**

Add the following imports at the top of `backend/app/api/ask.py`:

```python
from sse_starlette.sse import EventSourceResponse
from app.services.conversation_manager import ConversationManager
from app.services.rule_engine import evaluate_rules
```

Add module-level conversation manager after the existing service instantiations (after line 20):

```python
conversation_mgr = ConversationManager(ttl_seconds=1800)
```

Add the SSE endpoint after the existing `/` POST endpoint:

```python
class StreamAskRequest(BaseModel):
    query: str
    channel: str = "manual"
    reply_lang: str = "en"
    reply_format: str = "chat"
    session_id: str | None = None


@router.post("/stream")
async def ask_stream(request: StreamAskRequest, db: AsyncSession = Depends(get_db)):
    """SSE streaming endpoint for ask with multi-turn support."""
    import time
    start_time = time.time()
    claude_service = get_claude_service()

    # Retrieve knowledge
    results = await retrieval_service.retrieve(db, request.query)
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
        else:
            session_id = request.session_id
    else:
        session_id = conversation_mgr.create_session(knowledge_context=results)

    session = conversation_mgr.get_session(session_id)

    # Rule engine check
    rule_result = evaluate_rules(
        confidence=confidence,
        retrieval_results=results,
        round_count=session.round_count,
        max_rounds=max_rounds,
        confidence_threshold=confidence_threshold,
    )

    async def event_generator():
        yield {"event": "thinking", "data": json.dumps({"status": "analyzing"})}
        yield {"event": "session", "data": json.dumps({"session_id": session_id})}

        # Rule engine forces clarification — no Claude call needed
        if rule_result.should_force_clarify:
            questions = [
                {"id": q.id, "text": q.text, "options": q.options}
                for q in (rule_result.forced_questions or [])
            ]
            conversation_mgr.increment_round(session_id)

            # Save interaction
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

            yield {
                "event": "clarification",
                "data": json.dumps({
                    "questions": questions,
                    "round": session.round_count,
                    "interaction_id": interaction.id,
                    "reason": rule_result.reason,
                }),
            }
            return

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

        for event in claude_service.generate_reply_stream(
            messages=messages,
            knowledge_context=context_text if context_text.strip() else "(No matching knowledge entries found)",
            force_direct_answer=rule_result.should_force_answer,
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

            yield {
                "event": "clarification",
                "data": json.dumps({
                    "questions": clarification_data,
                    "round": session.round_count,
                    "interaction_id": interaction.id,
                }),
            }
        else:
            # Got a direct answer — translate for bilingual
            conversation_mgr.add_assistant_message(session_id, full_text)
            yield {"event": "translating", "data": json.dumps({"status": "translating"})}

            try:
                zh_reply = claude_service._chat([{
                    "role": "user",
                    "content": f"Translate this customer service reply to Simplified Chinese. Keep the same tone and format. Output ONLY the translation.\n\n{full_text}",
                }], max_tokens=2048)
            except Exception:
                zh_reply = ""

            elapsed_ms = int((time.time() - start_time) * 1000)

            # Determine status
            if confidence >= current_settings.get("confidence_auto_reply", 0.90):
                status = "auto_reply"
            elif confidence >= confidence_threshold:
                status = "draft"
            else:
                status = "low_confidence"

            # Save interaction
            interaction = Interaction(
                id=str(uuid.uuid4()),
                query_text=request.query,
                channel=request.channel,
                draft_reply=full_text,
                confidence=confidence,
                status=status,
                matched_knowledge_id=results[0]["id"] if results else None,
            )
            db.add(interaction)
            await db.commit()

            yield {
                "event": "complete",
                "data": json.dumps({
                    "id": interaction.id,
                    "query": request.query,
                    "reply_en": full_text,
                    "reply_zh": zh_reply,
                    "confidence": confidence,
                    "status": status,
                    "sources": results[:3],
                    "elapsed_ms": elapsed_ms,
                    "session_id": session_id,
                }),
            }

    return EventSourceResponse(event_generator())
```

- [ ] **Step 3: Run tests**

Run: `cd backend && python -m pytest tests/test_ask_stream.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/ask.py backend/tests/test_ask_stream.py
git commit -m "feat: add SSE streaming endpoint /api/ask/stream"
```

---

### Task 9: Frontend — SSE Streaming Utility

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add SSE streaming functions to api.ts**

Add at the end of `frontend/src/lib/api.ts`:

```typescript
// SSE Streaming API

export interface StreamCallbacks {
  onThinking: (status: string) => void;
  onSession: (sessionId: string) => void;
  onToken: (text: string) => void;
  onClarification: (questions: ClarificationQuestion[], round: number, interactionId: string) => void;
  onTranslating: () => void;
  onComplete: (result: {
    id: string;
    query: string;
    reply_en: string;
    reply_zh: string;
    confidence: number;
    status: string;
    sources: Array<{ id: string; question_patterns: string[]; answer: string; score: number; tags: string[] }>;
    elapsed_ms: number;
    session_id: string;
  }) => void;
  onError: (message: string) => void;
}

export function streamAsk(
  body: { query: string; channel?: string; reply_lang?: string; reply_format?: string; session_id?: string },
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();
  const apiBase = getApiBase();

  fetch(`${apiBase}/api/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        callbacks.onError(`API error: ${response.status}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              switch (currentEvent) {
                case "thinking":
                  callbacks.onThinking(data.status);
                  break;
                case "session":
                  callbacks.onSession(data.session_id);
                  break;
                case "token":
                  callbacks.onToken(data.text);
                  break;
                case "clarification":
                  callbacks.onClarification(
                    data.questions.map((q: { id: string; text: string; options: string[] }) => ({
                      id: q.id,
                      text: q.text,
                      options: q.options,
                    })),
                    data.round,
                    data.interaction_id,
                  );
                  break;
                case "translating":
                  callbacks.onTranslating();
                  break;
                case "complete":
                  callbacks.onComplete(data);
                  break;
                case "error":
                  callbacks.onError(data.message);
                  break;
              }
            } catch {
              // skip malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message);
      }
    });

  return controller;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add SSE streaming client utility"
```

---

### Task 10: Frontend — Ask Page SSE Integration + Thinking Animation

**Files:**
- Modify: `frontend/src/app/ask/page.tsx`

- [ ] **Step 1: Add new state variables**

Add after the existing useState declarations (around line 96):

```typescript
const [sessionId, setSessionId] = useState<string | null>(null);
const [isStreaming, setIsStreaming] = useState(false);
const [streamingText, setStreamingText] = useState("");
const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
const [isTranslating, setIsTranslating] = useState(false);
const [currentRound, setCurrentRound] = useState(0);
const abortControllerRef = useRef<AbortController | null>(null);
```

- [ ] **Step 2: Add streaming submit handler**

Add a new `handleStreamSubmit` function after the existing `handleTextSubmit`:

```typescript
const handleStreamSubmit = useCallback(async () => {
  const text = queryText.trim();
  if (!text) return;

  setState((prev) => ({ ...prev, isProcessing: true, error: null, draftReply: null, draftReplyEn: null, draftReplyZh: null, clarificationQuestions: [], followupHistory: [] }));
  setClarifyAnswers({});
  setStreamingText("");
  setThinkingStatus("analyzing");
  setIsStreaming(true);
  setIsTranslating(false);

  const controller = streamAsk(
    { query: text, channel: "manual", reply_lang: replyLang, reply_format: replyFormat, session_id: sessionId || undefined },
    {
      onThinking: (status) => setThinkingStatus(status),
      onSession: (sid) => setSessionId(sid),
      onToken: (token) => {
        setThinkingStatus(null);
        setStreamingText((prev) => prev + token);
      },
      onClarification: (questions, round, interactionId) => {
        setIsStreaming(false);
        setThinkingStatus(null);
        setCurrentRound(round);
        const aiText = questions.map((q) => q.text).join("\n");
        setChatMessages([{ role: "user", text }, { role: "ai", text: aiText }]);
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          interactionId,
          confidence: 0,
          clarificationQuestions: questions,
          status: "clarification",
        }));
      },
      onTranslating: () => {
        setThinkingStatus(null);
        setIsTranslating(true);
      },
      onComplete: (result) => {
        setIsStreaming(false);
        setIsTranslating(false);
        setThinkingStatus(null);
        setStreamingText("");
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          interactionId: result.id,
          draftReply: result.reply_en,
          draftReplyEn: result.reply_en,
          draftReplyZh: result.reply_zh,
          confidence: result.confidence,
          sources: result.sources,
          status: result.status,
          clarificationQuestions: [],
        }));
        setEditedReplyEn(result.reply_en || "");
        setEditedReplyZh(result.reply_zh || "");
        addToHistory({ query: text, draftReply: result.reply_en, confidence: result.confidence, status: result.status });
        refreshHistory();
      },
      onError: (message) => {
        setIsStreaming(false);
        setThinkingStatus(null);
        setState((prev) => ({ ...prev, isProcessing: false, error: message }));
      },
    },
  );
  abortControllerRef.current = controller;
}, [queryText, replyLang, replyFormat, sessionId, addToHistory, refreshHistory]);
```

- [ ] **Step 3: Replace submit handler in the submit button**

Find the text submit button's `onClick` and change `handleTextSubmit` to `handleStreamSubmit`.

- [ ] **Step 4: Add thinking animation UI**

Find the clarification chat area (around line 709, the processing/typing indicator). Replace the existing simple dots with:

```tsx
{(state.isProcessing || isStreaming) && (
  <div className="flex justify-start">
    <div className="bg-amber-50 border border-amber-200/50 rounded-2xl rounded-bl-md px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-amber-700">
          {thinkingStatus === "analyzing" && "Analyzing your question..."}
          {thinkingStatus === "summarizing" && "Summarizing context..."}
          {isTranslating && "Translating..."}
          {!thinkingStatus && !isTranslating && isStreaming && "Generating reply..."}
        </span>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Add streaming text display**

Add after the thinking animation, before the chat end ref:

```tsx
{isStreaming && streamingText && (
  <div className="flex justify-start">
    <div className="max-w-[80%] bg-amber-50 border border-amber-200/50 rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed">
      <p className="whitespace-pre-wrap">{streamingText}<span className="inline-block w-0.5 h-4 bg-amber-600 animate-pulse ml-0.5" /></p>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add round counter display**

In the clarification header area (near the "Need more info" badge), add:

```tsx
{currentRound > 0 && (
  <span className="text-xs text-on-surface-variant ml-2">
    Round {currentRound}/{settings?.max_clarification_rounds ?? 3}
  </span>
)}
```

- [ ] **Step 7: Add import for streamAsk**

At the top of `page.tsx`, add to the import from `@/lib/api`:

```typescript
import { ..., streamAsk } from "@/lib/api";
```

- [ ] **Step 8: Manual test**

1. Start frontend and backend
2. Ask a question — verify streaming tokens appear character by character
3. Ask an ambiguous question — verify clarification flow works
4. Verify thinking dots appear during processing
5. Verify round counter shows during clarification

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/ask/page.tsx
git commit -m "feat: integrate SSE streaming with thinking animation and round counter"
```

---

### Task 11: Integration Test — Full Multi-Turn Flow

- [ ] **Step 1: End-to-end manual test checklist**

Test each scenario:

1. **Direct answer**: Ask "What is Pivot Plus?" → should stream tokens → show bilingual result
2. **AI-triggered clarification**: Ask "Tell me about pricing" → should get clarification questions → answer → get bilingual reply
3. **Rule engine — zero matches**: Ask something completely unrelated → should get rule-based clarification
4. **Rule engine — max rounds**: Trigger clarification multiple times → at max rounds, should force direct answer
5. **History bug**: Check history panel → no blank entries
6. **Bilingual followup**: After clarification → final reply should have both EN and ZH
7. **Settings**: Change max_clarification_rounds in settings → verify it takes effect
8. **Abort**: Start streaming, navigate away → no errors

- [ ] **Step 2: Run all backend tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete multi-turn conversation enhancement with SSE streaming

- ConversationManager with TTL sessions and message compression
- Rule engine for pre-Claude clarification decisions
- Claude streaming with true multi-turn messages
- SSE endpoints for real-time token delivery
- Thinking animation and round counter in frontend
- Bilingual followup replies
- History blank content bug fix
- Configurable max_clarification_rounds in settings"
```
