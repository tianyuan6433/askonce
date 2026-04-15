"""Batch translate all knowledge entries to zh-CN using Claude.
Populates answer_zh and question_patterns_zh columns.
Usage: cd backend && python scripts/translate_knowledge.py
"""
import asyncio
import json
import sqlite3
import sys
import time
sys.path.insert(0, ".")

from app.services.claude_service import ClaudeService, ClaudeServiceError


def get_untranslated(conn: sqlite3.Connection, limit: int = 500):
    """Get entries that haven't been translated yet."""
    rows = conn.execute(
        "SELECT id, question_patterns, answer FROM knowledge_entries "
        "WHERE answer_zh IS NULL AND status = 'active' LIMIT ?",
        (limit,),
    ).fetchall()
    return rows


async def translate_entry(ai: ClaudeService, qp_raw, answer: str) -> dict:
    """Translate one entry's question_patterns + answer to zh-CN."""
    # Parse question_patterns
    if isinstance(qp_raw, str):
        try:
            qp = json.loads(qp_raw)
        except json.JSONDecodeError:
            qp = [qp_raw]
    else:
        qp = qp_raw or []

    text = f"QUESTIONS:\n" + "\n".join(qp) + f"\n\nANSWER:\n{answer}"

    result = await ai.translate_text(text, "zh-CN")

    # Parse back
    if "\nANSWER:\n" in result:
        parts = result.split("\nANSWER:\n", 1)
    elif "\n答案:\n" in result:
        parts = result.split("\n答案:\n", 1)
    elif "\n\n" in result:
        parts = result.split("\n\n", 1)
    else:
        return {"question_patterns_zh": qp, "answer_zh": result.strip()}

    q_part = parts[0]
    for prefix in ["QUESTIONS:\n", "QUESTIONS：\n", "问题:\n", "问题：\n", "問題:\n"]:
        q_part = q_part.replace(prefix, "")
    q_part = q_part.strip()

    translated_qp = [q.strip() for q in q_part.split("\n") if q.strip()]
    translated_answer = parts[1].strip() if len(parts) > 1 else result.strip()

    # Remove "答案:" prefix if present
    for prefix in ["答案:", "答案：", "回答:", "回答："]:
        if translated_answer.startswith(prefix):
            translated_answer = translated_answer[len(prefix):].strip()

    return {
        "question_patterns_zh": translated_qp,
        "answer_zh": translated_answer,
    }


async def main():
    try:
        ai = ClaudeService()
    except ClaudeServiceError as e:
        print(f"❌ {e}")
        return

    conn = sqlite3.connect("askonce.db")
    rows = get_untranslated(conn)
    total = len(rows)
    print(f"📝 {total} entries need translation")

    if total == 0:
        print("✅ All entries already translated!")
        conn.close()
        return

    translated = 0
    errors = 0

    for i, (entry_id, qp_raw, answer) in enumerate(rows):
        try:
            result = await translate_entry(ai, qp_raw, answer)
            conn.execute(
                "UPDATE knowledge_entries SET question_patterns_zh = ?, answer_zh = ? WHERE id = ?",
                (json.dumps(result["question_patterns_zh"], ensure_ascii=False),
                 result["answer_zh"],
                 entry_id),
            )
            if (i + 1) % 10 == 0:
                conn.commit()
            translated += 1
            print(f"  [{translated}/{total}] ✅ {entry_id[:8]}... → {result['answer_zh'][:40]}...")
        except Exception as e:
            errors += 1
            print(f"  [{i+1}/{total}] ❌ {entry_id[:8]}... → {e}")
            if "rate_limit" in str(e).lower() or "429" in str(e):
                print("  ⏳ Rate limited, waiting 30s...")
                time.sleep(30)
            elif errors > 10:
                print("  🛑 Too many errors, stopping")
                break

    conn.commit()
    conn.close()
    print(f"\n✅ Done: {translated} translated, {errors} errors out of {total}")


if __name__ == "__main__":
    asyncio.run(main())
