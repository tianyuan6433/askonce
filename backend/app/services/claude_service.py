"""AI service for AskOnce — uses OpenAI-compatible API (DashScope/Qwen, Claude proxy, etc.).
Never falls back to mock — errors are surfaced directly."""
import base64
import json
import logging
import re
from openai import OpenAI, APITimeoutError, APIStatusError, APIConnectionError
from app.config import settings

logger = logging.getLogger(__name__)


class ClaudeServiceError(Exception):
    """Raised when AI API is not configured or fails."""
    pass


def _parse_json_array(text: str) -> list[dict]:
    """Extract a JSON array from LLM response text."""
    start = text.find("[")
    end = text.rfind("]") + 1
    if start < 0 or end <= start:
        return []
    raw = text[start:end]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    repaired = re.sub(r',\s*([}\]])', r'\1', raw)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        pass
    # Parse individual objects
    entries = []
    depth = 0
    obj_start = None
    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and obj_start is not None:
                obj_str = raw[obj_start:i + 1]
                try:
                    entries.append(json.loads(obj_str))
                except json.JSONDecodeError:
                    cleaned = re.sub(r',\s*}', '}', obj_str)
                    try:
                        entries.append(json.loads(cleaned))
                    except json.JSONDecodeError:
                        pass
                obj_start = None
    return entries


def _parse_json_object(text: str) -> dict | None:
    """Extract a JSON object from LLM response text."""
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            return None
    return None


SYSTEM_PROMPT = """You are AskOnce, an AI assistant for the MAXHUB Pivot Plus product line. You generate accurate, professional replies based on the provided knowledge base entries.

RULES:
1. Use information ONLY from the provided knowledge sources. If NO knowledge source is relevant to the user's question, respond with: "I'm sorry, I don't have information about that in my knowledge base. Please contact the MAXHUB Pivot Plus support team for further assistance."
2. NEVER include source citations, reference IDs, or internal metadata in the reply.
3. Length guide:
   - Simple factual queries: 2-3 sentences. Be concise.
   - Multi-part or technical questions: 5-8 sentences max. Cover key points with specific values. Be concise and direct — avoid filler.
4. For numbers, model names, specifications — quote them exactly.
5. When the question asks about security, compliance, or architecture, list specific controls, mechanisms, and responsibilities clearly. Separate what MAXHUB handles vs what the customer handles.

FORMATTING (CRITICAL):
- Output ONLY plain text. No markdown syntax whatsoever.
- NEVER use: **bold**, *italic*, ## headers, - bullet lists, | tables |, > blockquotes, ``` code blocks, [links](url)
- Use line breaks to separate paragraphs. That is the ONLY formatting allowed.
- Write as if you are typing a message in a chat app or composing an email — no markup at all.

LANGUAGE AND REGISTER:
- Follow the language and format hints provided in the user message.
- For chat format: Keep it short, conversational, use contractions (don't, we'll, it's). No greeting or sign-off unless natural. Sound like a real person talking.
- For email format: Complete sentences, include a brief greeting (Hi/Hello), sign off as "Yuan". Professional but warm, not stiff.
- For other/neutral format: Professional, direct, active voice.

MAXHUB TERMINOLOGY (always use these exact terms):
- "Pivot Plus" (not "PivotPlus" or "PIVOT PLUS")
- "setup" (not "installation")
- "run into issues" (not "encounter issues")
- "check" (not "verify" or "confirm")
- "CMS" / "DMS" — keep acronyms as-is
- "R&D team" (not "R & D" or "development team")

DEVICE & LICENSING KNOWLEDGE:
- Pivot Plus licenses are per-device, per-year (365 credits per license)
- Licenses apply to managed devices: IFP (Interactive Flat Panel), DS (Digital Signage), MTR rooms, etc.
- Peripherals (microphones, cameras, speakers, USB dongles) do NOT require separate licenses — they are accessories managed through the parent device
- If a user mentions peripherals, clarify that they only need licenses for the main display/device units

QUALITY:
- Cut every unnecessary word
- Sound like a real person — read it aloud; if it sounds robotic, rewrite
- Never answer word-for-word from a source — rephrase naturally
- Chinese output: short sentences, avoid 书面语 filler (我们希望、贵司、特此、请悉知)
- English output: direct, active voice, simple verbs"""


class ClaudeService:
    """AI service using OpenAI-compatible API (DashScope, Claude proxy, etc.)."""

    def __init__(self):
        if not settings.claude_api_key:
            raise ClaudeServiceError(
                "ASKONCE_CLAUDE_API_KEY is not set. "
                "Please set it in your .env file or environment variables."
            )
        self.client = OpenAI(
            api_key=settings.claude_api_key,
            base_url=settings.claude_api_base.rstrip("/"),
            timeout=120.0,
        )
        self.model = settings.claude_model

    def _chat(self, messages: list[dict], system: str = "", max_tokens: int = 1024) -> str:
        """Send messages and return text response."""
        api_messages = []
        if system:
            api_messages.append({"role": "system", "content": system})
        api_messages.extend(messages)

        msg_len = sum(len(str(m.get("content", ""))) for m in messages)
        logger.info(f"[_chat] model={self.model}, max_tokens={max_tokens}, input_chars={msg_len}")

        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=api_messages,
                max_tokens=max_tokens,
            )
        except APITimeoutError as e:
            logger.error(f"[_chat] TIMEOUT: {e}")
            raise ClaudeServiceError("AI request timed out — the document may be too large.") from e
        except APIStatusError as e:
            logger.error(f"[_chat] STATUS ERROR {e.status_code}: {e.message}")
            raise ClaudeServiceError(f"AI API error ({e.status_code}): {e.message}") from e
        except APIConnectionError as e:
            logger.error(f"[_chat] CONNECTION ERROR: {e}")
            raise ClaudeServiceError("Cannot connect to AI service — please check network.") from e

        return resp.choices[0].message.content or ""

    def _chat_stream(self, messages: list[dict], system: str = "", max_tokens: int = 2048):
        """Stream response, yielding text chunks."""
        api_messages = []
        if system:
            api_messages.append({"role": "system", "content": system})
        api_messages.extend(messages)

        try:
            stream = self.client.chat.completions.create(
                model=self.model,
                messages=api_messages,
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception:
            # Fallback to non-streaming
            full_text = self._chat(messages, system=system, max_tokens=max_tokens)
            yield full_text

    async def generate_reply_stream(
        self,
        messages: list[dict],
        knowledge_context: str,
        force_direct_answer: bool = False,
        force_clarification: bool = False,
        reply_lang: str = "en",
        reply_format: str = "chat",
    ):
        """Generate a streaming reply using full conversation history."""
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

        last_user_msg = messages[-1]["content"] if messages else ""
        context_block = (
            f"\n\nKnowledge sources:\n{knowledge_context}\n\n"
            f"{lang_hint}\n{format_hint}\n\n"
        )
        if force_clarification:
            context_block += (
                "MANDATORY CLARIFICATION:\n"
                "You MUST ask clarification questions before answering. Do NOT give a direct answer yet.\n"
                "Analyze the user's question and the knowledge sources, then ask 1-3 targeted questions "
                "to better understand their specific situation (e.g., region, device model, use case, timeline).\n\n"
                "If the knowledge sources contain region-specific, tier-specific, or conditional data, "
                "ask which scenario applies to the user.\n\n"
                'Respond ONLY with this exact JSON (nothing else):\n'
                '{"type":"clarification","questions":[{"id":"q1","text":"Your question","options":["Option A","Option B"]}]}\n\n'
                "Rules: 1-3 questions, 2-5 options each. Questions should be specific and actionable. "
                "Use ALL the knowledge sources provided.\n\n"
            )
        elif not force_direct_answer:
            context_block += (
                "CLARIFICATION PROTOCOL:\n"
                "Answer directly when you can. Ask for clarification ONLY when:\n"
                "1. The answer would be COMPLETELY DIFFERENT depending on a missing detail "
                "(e.g., pricing varies by region/country, features differ by product model)\n"
                "2. You literally cannot give ANY useful answer without that info\n"
                "3. The knowledge sources provide different answers for different scenarios "
                "(different regions, tiers, device types, etc.) — ASK which scenario applies\n\n"
                'If you DO need clarification, respond ONLY with this exact JSON (nothing else):\n'
                '{"type":"clarification","questions":[{"id":"q1","text":"Your question","options":["Option A","Option B"]}]}\n\n'
                "Rules: Max 3 questions, 2-5 options each. Use ALL the knowledge sources provided — "
                "never say you don't have information that IS present in the sources above.\n\n"
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

        clarification = _parse_json_object(full_text)
        if clarification and clarification.get("type") == "clarification" and clarification.get("questions"):
            yield {"type": "clarification", "questions": clarification["questions"]}
        else:
            yield {"type": "done", "full_text": full_text}

    async def generate_reply(self, query: str, context_entries: list[dict], followup_context: list[dict] | None = None) -> dict:
        """Generate a reply using RAG context from knowledge base."""
        context_text = "\n\n".join([
            f"Q: {', '.join(e.get('question_patterns', []))}\n"
            f"A: {e.get('answer', '')}"
            for e in context_entries
        ])

        clarify_section = ""
        if followup_context:
            lines = []
            for fc in followup_context:
                lines.append(f"[You asked]: {fc['question']}")
                lines.append(f"[User answered]: {fc['answer']}")
            clarify_section = (
                "\nPrevious clarification:\n" + "\n".join(lines) + "\n\n"
                "Now generate the final reply incorporating the user's answers above.\n"
            )

        user_message = (
            f"Customer query:\n{query}\n\n"
            f"Knowledge sources:\n"
            f"{context_text if context_text.strip() else '(No matching knowledge entries found)'}\n\n"
            f"{clarify_section}"
            f"CLARIFICATION PROTOCOL:\n"
            f"Answer directly when you can. Ask for clarification ONLY when:\n"
            f"1. The answer would be COMPLETELY DIFFERENT depending on a missing detail\n"
            f"2. You literally cannot give ANY useful answer without that info\n"
            f"3. The knowledge sources provide different answers for different scenarios\n\n"
            f'If you DO need clarification, respond ONLY with this exact JSON (nothing else):\n'
            f'{{"type":"clarification","questions":[{{"id":"q1","text":"Your question","options":["Option A","Option B"]}}]}}\n\n'
            f"Otherwise, output ONLY the final reply text — no JSON, no analysis, no metadata. "
            f"Plain text only, absolutely no markdown formatting."
        )

        try:
            reply_text = self._chat(
                [{"role": "user", "content": user_message}],
                system=SYSTEM_PROMPT,
                max_tokens=2048,
            )
            clarification = _parse_json_object(reply_text)
            if clarification and clarification.get("type") == "clarification" and clarification.get("questions"):
                return {"type": "clarification", "questions": clarification["questions"], "model": self.model}
            return {"type": "reply", "reply": reply_text, "model": self.model}
        except Exception as e:
            return {"type": "reply", "reply": f"Error generating reply: {str(e)}", "model": self.model, "error": str(e)}

    async def generate_bilingual_reply(self, query: str, context_entries: list[dict],
                                        reply_format: str = "chat",
                                        followup_context: list[dict] | None = None) -> dict:
        """Generate reply in English, then translate to Chinese. Returns both."""
        format_hints = {
            "email": "[Format: formal email reply, sign off as Yuan]",
            "chat": "[Format: short casual chat message, no greeting/sign-off needed]",
            "other": "[Format: neutral professional reply]",
        }
        format_hint = format_hints.get(reply_format, format_hints["chat"])
        augmented = f"{query}\n[Reply in English]\n{format_hint}"

        result = await self.generate_reply(augmented, context_entries, followup_context)
        if result.get("type") == "clarification":
            return result

        en_reply = result.get("reply", "")

        try:
            zh_reply = self._chat([{
                "role": "user",
                "content": (
                    f"Translate this customer service reply to Simplified Chinese. "
                    f"Keep the same tone and format. Output ONLY the translation.\n\n{en_reply}"
                ),
            }], max_tokens=2048)
        except Exception:
            zh_reply = ""

        return {
            "type": "reply",
            "reply_en": en_reply,
            "reply_zh": zh_reply,
            "reply": en_reply,
            "model": self.model,
        }

    async def learn_from_edit(self, query: str, original_reply: str, edited_reply: str, matched_knowledge: list[dict]) -> list[dict]:
        """Analyze user edits and suggest knowledge base updates."""
        kb_context = "\n".join([
            f"[ID: {e.get('id', 'unknown')}] Q: {', '.join(e.get('question_patterns', []))}\nA: {e.get('answer', '')}"
            for e in matched_knowledge
        ]) if matched_knowledge else "(no matching entries)"

        prompt = f"""You are a knowledge base curator. A user asked a question, the AI generated a reply from the knowledge base, but the user edited it before sending. Analyze the difference and suggest how to update the knowledge base.

Customer question:
{query}

AI original reply (from knowledge base):
{original_reply}

User's edited version (what they actually sent):
{edited_reply}

Matched knowledge entries:
{kb_context}

Analyze what the user changed and WHY. Then suggest knowledge base actions:
- "update": if an existing entry's answer should be improved/corrected (include the entry ID)
- "add": if the edit reveals new information not in any existing entry

Output ONLY valid JSON array:
[
  {{
    "action": "update",
    "entry_id": "existing-entry-uuid",
    "reason": "Why this entry should be updated",
    "suggested_answer": "The improved answer text"
  }},
  {{
    "action": "add",
    "reason": "Why this is new knowledge",
    "question_patterns": ["Question 1?", "Question 2?"],
    "answer": "The new knowledge answer",
    "tags": ["tag1", "tag2"],
    "category": "Technical"
  }}
]

If the edit was just minor wording/style changes, return an empty array: []"""

        try:
            resp_text = self._chat([{"role": "user", "content": prompt}], max_tokens=2048)
            suggestions = _parse_json_array(resp_text)
            return [s for s in suggestions if s.get("action") in ("update", "add")]
        except Exception as e:
            logger.error("learn_from_edit failed: %s", e)
            return []

    async def suggest_merges(self, entries: list[dict]) -> list[dict]:
        """Analyze knowledge entries and suggest merges."""
        entries_text = "\n\n".join([
            f"[ID: {e.get('id')}] Category: {e.get('category', 'General')}\n"
            f"Q: {', '.join(e.get('question_patterns', []))}\n"
            f"A: {e.get('answer', '')[:200]}"
            for e in entries
        ])

        prompt = f"""You are a knowledge base curator. Review these knowledge entries and identify groups that should be merged.

Entries:
{entries_text}

For each merge group, output:
- "ids": list of entry IDs to merge
- "reason": why they should be merged
- "merged_question_patterns": combined question patterns
- "merged_answer": the best combined answer
- "merged_tags": combined tags
- "merged_category": the appropriate category

Output ONLY valid JSON array. If no merges are needed, return [].
[
  {{
    "ids": ["id1", "id2"],
    "reason": "Both entries describe the same feature",
    "merged_question_patterns": ["Combined question 1?", "Combined question 2?"],
    "merged_answer": "The merged comprehensive answer",
    "merged_tags": ["tag1", "tag2"],
    "merged_category": "Technical"
  }}
]"""

        try:
            resp_text = self._chat([{"role": "user", "content": prompt}], max_tokens=4096)
            return _parse_json_array(resp_text)
        except Exception as e:
            logger.error("suggest_merges failed: %s", e)
            return []

    async def extract_from_image(self, image_bytes: bytes, mime_type: str) -> dict:
        """Extract text and conversation from screenshot using vision."""
        b64_image = base64.b64encode(image_bytes).decode("utf-8")

        prompt = """Analyze this screenshot and extract:
1. The main question or inquiry being asked
2. Any relevant context, names, topics
3. Suggested tags/categories

Respond in JSON format:
{
  "detected_question": "the main question extracted",
  "context": "relevant context and background",
  "tags": ["TAG1", "TAG2"],
  "extracted_text": "full text visible in the image"
}"""

        try:
            # Use qwen-vl-plus for vision tasks
            vision_model = "qwen-vl-plus" if "qwen" in self.model else self.model
            text = self._chat_vision(b64_image, mime_type, prompt, vision_model)
            result = _parse_json_object(text)
            if result:
                return result
            return {"detected_question": text[:200], "context": "", "tags": [], "extracted_text": text}
        except Exception as e:
            return {"detected_question": f"Error: {str(e)}", "context": "", "tags": [], "extracted_text": "", "error": str(e)}

    def _chat_vision(self, b64_image: str, mime_type: str, prompt: str, model: str) -> str:
        """Send a vision request using OpenAI-compatible format."""
        resp = self.client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_image}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=2048,
        )
        return resp.choices[0].message.content or ""

    async def extract_knowledge(self, text: str) -> list[dict]:
        """Extract knowledge Q&A entries from text content."""
        CHUNK_SIZE = 12000
        chunks = []
        if len(text) > CHUNK_SIZE:
            paragraphs = text.split("\n\n")
            current_chunk = ""
            for para in paragraphs:
                if len(current_chunk) + len(para) > CHUNK_SIZE and current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = para
                else:
                    current_chunk = current_chunk + "\n\n" + para if current_chunk else para
            if current_chunk:
                chunks.append(current_chunk)
        else:
            chunks = [text]

        logger.info("Extracting knowledge: %d chars, %d chunk(s)", len(text), len(chunks))

        all_entries = []
        for i, chunk in enumerate(chunks):
            logger.info("Processing chunk %d/%d (%d chars)", i + 1, len(chunks), len(chunk))
            entries = self._extract_knowledge_chunk(chunk)
            all_entries.extend(entries)

        return all_entries

    def _extract_knowledge_chunk(self, text: str) -> list[dict]:
        """Extract knowledge entries from a single text chunk."""
        prompt = f"""You are a knowledge base curator for MAXHUB Pivot Plus. Extract structured Q&A entries from the following text.

RULES:
1. Each entry must be self-contained with a clear question and answer.
2. question_patterns: 2-4 natural question variations.
3. answer: Complete, accurate answer from the text — do NOT fabricate.
4. tags: 2-5 concise topic tags (lowercase).
5. category: One of: Product, Pricing, Technical, Support, Security, Content, Organization, General.
6. conditions: optional context (e.g., "for Enterprise tier only").
7. Skip vague or non-informational sentences.
8. Keep entries atomic — one fact per entry.
9. Output ONLY valid JSON.

Text:
{text}

Output format:
[
  {{
    "question_patterns": ["Question 1?", "Question 2?"],
    "answer": "Factual answer from the text.",
    "tags": ["tag1", "tag2"],
    "category": "Technical",
    "conditions": "Optional condition"
  }}
]"""

        try:
            resp_text = self._chat([{"role": "user", "content": prompt}], max_tokens=4096)
            entries = _parse_json_array(resp_text)
            cleaned = []
            for e in entries:
                if not e.get("question_patterns") or not e.get("answer"):
                    continue
                cleaned.append({
                    "question_patterns": [q for q in e.get("question_patterns", []) if q.strip()],
                    "answer": e.get("answer", "").strip(),
                    "tags": e.get("tags", []),
                    "category": e.get("category", "General"),
                    "conditions": e.get("conditions") or None,
                })
            return cleaned
        except ClaudeServiceError:
            raise
        except Exception as e:
            raise ClaudeServiceError(f"Failed to extract knowledge: {str(e)}") from e

    async def translate_text(self, text: str, target_lang: str) -> str:
        """Translate text to target language."""
        lang_map = {"en": "English", "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese"}
        lang_name = lang_map.get(target_lang, target_lang)

        try:
            return self._chat([{
                "role": "user",
                "content": f"Translate the following text to {lang_name}. Output ONLY the translation.\n\n{text}",
            }], max_tokens=2048)
        except Exception as e:
            raise ClaudeServiceError(f"Translation failed: {str(e)}") from e

    async def translate_entry_bilingual(self, question_patterns: list[str], answer: str) -> dict:
        """Translate a knowledge entry to both EN and ZH-CN."""
        questions_block = "\n".join(f"- {q}" for q in question_patterns)
        prompt = f"""You are a bilingual translation engine.

INPUT:
QUESTIONS:
{questions_block}

ANSWER:
{answer}

TASK: Detect language and translate to both English and Chinese.

OUTPUT FORMAT (strict JSON):
{{
  "question_patterns_en": ["English question 1", "English question 2"],
  "answer_en": "English answer",
  "question_patterns_zh": ["中文问题1", "中文问题2"],
  "answer_zh": "中文回答"
}}

RULES:
- Keep technical terms (MAXHUB, Pivot Plus, CMS, DMS, API) unchanged.
- Maintain the same number of question patterns.
- Output ONLY the JSON object."""

        try:
            resp = self._chat([{"role": "user", "content": prompt}], max_tokens=4096)
            result = _parse_json_object(resp)
            if result and "question_patterns_en" in result and "answer_en" in result:
                return result
            return {
                "question_patterns_en": question_patterns,
                "answer_en": answer,
                "question_patterns_zh": question_patterns,
                "answer_zh": answer,
            }
        except Exception as e:
            raise ClaudeServiceError(f"Bilingual translation failed: {str(e)}") from e
