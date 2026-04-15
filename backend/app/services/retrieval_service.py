"""Improved retrieval with TF-IDF scoring and multi-field matching."""
import json
import math
import re
from collections import Counter
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.knowledge import KnowledgeEntry


def _as_list(v) -> list:
    """Ensure a value is a list, handling JSON strings from SQLite."""
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return []


class RetrievalService:
    def __init__(self):
        self._stopwords = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "can",
            "and", "or", "but", "not", "no", "nor", "so", "yet",
            "in", "on", "at", "to", "for", "of", "with", "by", "from",
            "this", "that", "these", "those", "it", "its",
            "what", "which", "who", "whom", "how", "when", "where", "why",
            "的", "了", "是", "在", "我", "有", "和", "就", "不", "人",
            "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去",
            "你", "会", "着", "没有", "看", "好", "自己", "这",
        }

    def _tokenize(self, text: str) -> list[str]:
        """Tokenize text into words, handling both English and Chinese."""
        # Split into runs of Chinese chars or runs of alphanumeric/underscore
        tokens = re.findall(r'[\u4e00-\u9fff]+|[a-z0-9_]+', text.lower())
        result = []
        for token in tokens:
            if re.match(r'^[\u4e00-\u9fff]+$', token):
                # Chinese: add individual chars AND bigrams
                result.extend(list(token))
                for i in range(len(token) - 1):
                    result.append(token[i:i+2])
            else:
                if token not in self._stopwords and len(token) > 1:
                    result.append(token)
        return result

    def _compute_tfidf_score(self, query_tokens: list[str], doc_tokens: list[str],
                              total_docs: int, doc_freq: dict[str, int]) -> float:
        """Compute TF-IDF similarity between query and document."""
        if not query_tokens or not doc_tokens:
            return 0.0

        doc_counter = Counter(doc_tokens)
        query_counter = Counter(query_tokens)

        score = 0.0
        for term, query_tf in query_counter.items():
            if term in doc_counter:
                tf = math.log(1 + doc_counter[term])
                df = doc_freq.get(term, 0)
                idf = math.log((total_docs + 1) / (1 + df))
                score += tf * idf * math.log(1 + query_tf)

        if doc_tokens:
            score /= math.sqrt(len(doc_tokens))

        return score

    async def retrieve(self, db: AsyncSession, query: str, top_k: int = 5) -> list[dict]:
        """Retrieve relevant knowledge entries using TF-IDF scoring."""
        result = await db.execute(
            select(KnowledgeEntry).where(KnowledgeEntry.status == "active")
        )
        entries = result.scalars().all()

        if not entries:
            return []

        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        # Build document frequency map
        all_doc_tokens = []
        for entry in entries:
            patterns_text = " ".join(_as_list(entry.question_patterns))
            doc_text = f"{patterns_text} {entry.answer or ''} {entry.conditions or ''}"
            all_doc_tokens.append(self._tokenize(doc_text))

        doc_freq: dict[str, int] = {}
        for tokens in all_doc_tokens:
            for term in set(tokens):
                doc_freq[term] = doc_freq.get(term, 0) + 1

        total_docs = len(entries)
        scored = []

        for i, entry in enumerate(entries):
            doc_tokens = all_doc_tokens[i]

            # Score against patterns (higher weight)
            patterns_text = " ".join(_as_list(entry.question_patterns))
            pattern_tokens = self._tokenize(patterns_text)
            pattern_score = self._compute_tfidf_score(query_tokens, pattern_tokens, total_docs, doc_freq)

            # Score against answer
            answer_tokens = self._tokenize(entry.answer or "")
            answer_score = self._compute_tfidf_score(query_tokens, answer_tokens, total_docs, doc_freq)

            # Exact match bonus
            exact_bonus = 0.0
            query_lower = query.lower().strip()
            for pattern in (_as_list(entry.question_patterns)):
                if query_lower == pattern.lower().strip():
                    exact_bonus = 5.0
                    break
                elif query_lower in pattern.lower() or pattern.lower() in query_lower:
                    exact_bonus = max(exact_bonus, 2.0)

            # Combined score: patterns weighted 3x, answer 1x, plus exact bonus
            combined = pattern_score * 3.0 + answer_score + exact_bonus

            if combined > 0.01:
                tags = _as_list(entry.tags)
                scored.append({
                    "id": entry.id,
                    "question_patterns": _as_list(entry.question_patterns),
                    "answer": entry.answer,
                    "conditions": entry.conditions,
                    "tags": tags,
                    "confidence": entry.confidence,
                    "score": round(combined, 4),
                    "source_type": entry.source_type,
                })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k]

    def compute_confidence(self, results: list[dict]) -> float:
        """Compute overall confidence from retrieval results."""
        if not results:
            return 0.0

        top_score = results[0]["score"]
        entry_confidence = results[0].get("confidence", 0.5)

        # Normalize score to 0-1 range using sigmoid-like function
        normalized = 1.0 / (1.0 + math.exp(-0.5 * (top_score - 2.0)))

        # Combine retrieval score with entry's own confidence
        combined = normalized * 0.7 + entry_confidence * 0.3

        # Boost if multiple good results agree
        if len(results) >= 2 and results[1]["score"] > top_score * 0.5:
            combined = min(1.0, combined * 1.1)

        return round(min(1.0, combined), 2)
