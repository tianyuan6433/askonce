# Multi-Turn Conversation Enhancement + Bug Fix — Design Spec

**Date**: 2026-04-15
**Batch**: 1 of 3 (①对话增强+Bug修复 → ②生长日志+搜索 → ③效率分析优化)
**Approach**: Progressive Enhancement (Approach A)
**Dev Method**: Test-Driven Development

---

## Problem Statement

AskOnce's current ask flow is single-turn: one question → one answer, with a shallow clarification mechanism that lacks persistence, proper multi-turn Claude context, streaming, and has a bug that leaves history records blank.

### Goals

1. Enhance the clarification flow with true multi-turn Claude conversations
2. Add a rule engine that works alongside Claude's own judgment to trigger clarification
3. Stream responses via SSE with thinking-state animations
4. Fix the bilingual gap in followup replies
5. Fix the history blank-content bug
6. Make max clarification rounds configurable in Settings

### Non-Goals (deferred to Batch 2 & 3)

- Full free-form conversation (ChatGPT-style topic switching)
- Conversation persistence across page refreshes
- Knowledge growth log improvements
- Analytics chart deduplication
- Search in Recent Queries

---

## Architecture Overview

```
User Question
      │
      ▼
┌─────────────────┐
│  Rule Engine     │  ← Pre-check: confidence < threshold? 0 matches? max rounds?
│  (Pre-Claude)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Claude Service  │  ← True multi-turn messages[] array
│  (Streaming)     │     Summarize when messages > threshold
└────────┬────────┘
         │
    SSE Stream
         │
         ▼
┌─────────────────┐
│  Frontend        │  ← EventSource + typing animation + thinking state
│  Chat UI         │
└─────────────────┘
```

---

## Module 1: Conversation Manager

**New file**: `backend/app/services/conversation_manager.py`

### ConversationSession

```python
@dataclass
class ConversationSession:
    session_id: str
    messages: list[dict]           # Claude messages format: [{role, content}]
    knowledge_context: list[dict]  # Retrieved knowledge entries for this conversation
    round_count: int = 0           # Number of clarification rounds so far
    created_at: datetime
    last_active: datetime
```

### ConversationManager

- In-memory dict: `{session_id: ConversationSession}`
- `create_session(knowledge_context) → session_id`
- `add_user_message(session_id, content) → updated messages[]`
- `add_assistant_message(session_id, content)`
- `get_session(session_id) → ConversationSession | None`
- `increment_round(session_id)`
- `cleanup_expired()` — TTL of 30 minutes, called lazily on access

### Summary Strategy

When `len(messages) > summary_threshold` (default: 6 messages = 3 rounds):

1. Take all messages except the last 2
2. Call Claude to generate a one-sentence summary of the conversation so far
3. Replace those messages with a single system-level context prefix
4. Keep the latest user + assistant pair intact

---

## Module 2: Rule Engine

**New file**: `backend/app/services/rule_engine.py`

### Pre-Claude Rules

Evaluated before calling Claude, in order:

| Rule | Condition | Action |
|------|-----------|--------|
| Max rounds reached | `round_count >= max_clarification_rounds` | Force direct answer (skip clarification) |
| Zero matches | `len(retrieval_results) == 0` | Force clarification ("Could you provide more details?") |
| Low confidence | `confidence < confidence_draft_min` | Force clarification with context-aware questions |

### Interface

```python
class RuleEngineResult:
    should_force_clarify: bool
    should_force_answer: bool
    forced_questions: list[ClarificationQuestion] | None
    reason: str

def evaluate_rules(
    confidence: float,
    retrieval_results: list,
    round_count: int,
    settings: AppSettings,
) -> RuleEngineResult
```

When `should_force_clarify=True`, the system constructs pre-defined clarification questions without calling Claude. When `should_force_answer=True`, Claude is instructed to give its best answer without requesting clarification.

---

## Module 3: Claude Service Enhancements

**Modified file**: `backend/app/services/claude_service.py`

### True Multi-Turn

Change `generate_reply()` to accept a full `messages[]` array instead of constructing a single user message:

```python
def generate_reply_multiturn(
    self,
    messages: list[dict],         # Full conversation history
    knowledge_context: str,       # Formatted knowledge entries
    force_direct_answer: bool,    # From rule engine
    reply_lang: str,
    reply_format: str,
) -> Generator[StreamEvent, None, None]  # Yields SSE events
```

### Streaming Output

Use Anthropic SDK streaming:

```python
with self.client.messages.stream(
    model=self.model,
    system=system_prompt,
    messages=messages,
    max_tokens=2048,
) as stream:
    for text in stream.text_stream:
        yield TokenEvent(text=text)
```

Fall back to non-streaming for custom proxy endpoints that don't support streaming.

### Bilingual Fix

`generate_bilingual_reply()` is now used for ALL final replies, including followups. The translation step is also streamed (second SSE phase with `translating` status).

---

## Module 4: SSE Streaming Endpoints

**Modified file**: `backend/app/api/ask.py`

### New Endpoints

```
POST /api/ask/stream          → SSE stream for initial question
POST /api/ask/followup/stream → SSE stream for followup answers
```

Both accept the same request bodies as their non-streaming counterparts, plus an optional `session_id` field for conversation continuity.

### SSE Event Types

| Event | Data | When |
|-------|------|------|
| `thinking` | `{"status": "analyzing"}` | Processing starts |
| `session` | `{"session_id": "xxx"}` | Session created/resumed |
| `token` | `{"text": "Hello"}` | Each token from Claude |
| `clarification` | `{"questions": [...], "round": 2}` | Claude or rule engine requests clarification |
| `translating` | `{"status": "translating"}` | English reply done, translating to Chinese |
| `translation_token` | `{"text": "你好"}` | Each token of Chinese translation |
| `complete` | `{"reply_en": "...", "reply_zh": "...", "confidence": 0.85, ...}` | Final result |
| `error` | `{"message": "..."}` | Error occurred |

### Existing Endpoints Preserved

`POST /api/ask/` and `POST /api/ask/followup` remain unchanged for non-browser channels (Feishu, Outlook).

---

## Module 5: Settings Enhancement

**Modified files**: `backend/app/config.py`, `backend/app/api/settings.py`, frontend Settings page

### New Setting

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max_clarification_rounds` | int | 3 | Maximum number of clarification rounds before forcing a direct answer |

Added to `AppSettings` model and exposed in the Settings API and frontend Settings page.

---

## Module 6: Frontend Enhancements

**Modified file**: `frontend/src/app/ask/page.tsx`, `frontend/src/lib/api.ts`

### SSE Client

New utility in `api.ts`:

```typescript
function streamAsk(
  body: AskRequest,
  callbacks: {
    onThinking: () => void;
    onSession: (sessionId: string) => void;
    onToken: (text: string) => void;
    onClarification: (questions: ClarificationQuestion[], round: number) => void;
    onTranslating: () => void;
    onTranslationToken: (text: string) => void;
    onComplete: (result: AskResponse) => void;
    onError: (message: string) => void;
  }
): AbortController
```

Uses `fetch()` with `ReadableStream` (not `EventSource`, since we need POST with body).

### Thinking State Animation

Three pulsing dots with rotating status text:
- "Analyzing your question..."
- "Searching knowledge base..."
- "Generating reply..."

CSS animation: fade-in dots with 0.2s stagger, text changes every 2 seconds.

### Streaming Chat Bubble

When tokens arrive, they are appended character-by-character to the AI chat bubble. The bubble grows dynamically. A blinking cursor appears at the end until the stream completes.

### Followup Flow Enhancement

- `session_id` is tracked in React state
- Each followup includes `session_id` for conversation continuity
- Round counter displayed in the UI ("Clarification 2/3")
- When max rounds reached, show "AI will provide its best answer" message

---

## Module 7: Bug Fix — History Blank Content

### Root Cause

When clarification is triggered in `ask.py` (lines 87–96), the `Interaction` is saved with `draft_reply=NULL`. If the user never completes the followup, this null-reply record appears in history.

### Fix — Backend

In the history API endpoint (`GET /api/ask/history`), add filter:

```python
query = query.where(
    or_(
        Interaction.draft_reply.isnot(None),
        Interaction.final_reply.isnot(None),
    )
)
```

This excludes incomplete clarification interactions from history results.

### Fix — Frontend

For any remaining items where `draft_reply` is null (edge cases), display:

```
"⏳ Clarification in progress — no reply generated yet"
```

instead of a blank "—".

---

## Testing Strategy (TDD)

### Backend Tests

| Test | Module | Description |
|------|--------|-------------|
| `test_conversation_manager.py` | ConversationManager | Session CRUD, TTL expiry, message append, summary trigger |
| `test_rule_engine.py` | Rule Engine | Low confidence → force clarify, zero matches → force clarify, max rounds → force answer |
| `test_claude_multiturn.py` | Claude Service | Multi-turn messages construction, summary compression, streaming yield |
| `test_ask_stream.py` | SSE Endpoints | SSE event format, session continuity across rounds, bilingual followup |
| `test_history_bug.py` | History API | Null draft_reply filtered out, clarification items excluded |

### Frontend Tests

| Test | Component | Description |
|------|-----------|-------------|
| `ask-stream.test.tsx` | SSE integration | Mock SSE events, verify token-by-token rendering |
| `thinking-animation.test.tsx` | Thinking state | Animation renders, status text cycles |
| `clarification-flow.test.tsx` | Multi-round | Round counter increments, max rounds warning shown |
| `history-display.test.tsx` | History | Null draft_reply shows friendly message, not blank |

---

## File Change Summary

| Action | File | Description |
|--------|------|-------------|
| **New** | `backend/app/services/conversation_manager.py` | In-memory session management |
| **New** | `backend/app/services/rule_engine.py` | Pre-Claude rule evaluation |
| **New** | `backend/tests/test_conversation_manager.py` | Tests |
| **New** | `backend/tests/test_rule_engine.py` | Tests |
| **New** | `backend/tests/test_ask_stream.py` | Tests |
| **New** | `backend/tests/test_history_bug.py` | Tests |
| **Modify** | `backend/app/services/claude_service.py` | Multi-turn messages, streaming |
| **Modify** | `backend/app/api/ask.py` | SSE endpoints, history filter, bilingual followup |
| **Modify** | `backend/app/config.py` | `max_clarification_rounds` setting |
| **Modify** | `backend/app/api/settings.py` | Expose new setting |
| **Modify** | `frontend/src/lib/api.ts` | `streamAsk()` utility |
| **Modify** | `frontend/src/app/ask/page.tsx` | SSE integration, animations, round counter |
| **Modify** | `frontend/src/app/settings/page.tsx` | Max rounds config UI |
