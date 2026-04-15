"""
Batch import Pivot+ documents into AskOnce knowledge base.
Usage: python scripts/import_pivot_docs.py [--extract]
  Without --extract: parses docs and saves text to data/parsed_docs/
  With --extract: also calls Claude to extract knowledge entries
"""
import asyncio
import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.document_service import DocumentService

DOCS_DIR = "/Users/tianyuan/Documents/Pivot+/文档"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "parsed_docs")
SUPPORTED_EXTS = {".docx", ".pdf", ".xlsx", ".txt", ".md"}


async def main():
    extract_mode = "--extract" in sys.argv
    doc_service = DocumentService()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    results = []

    for root, dirs, files in os.walk(DOCS_DIR):
        for fname in sorted(files):
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_EXTS:
                print(f"  ⏭ Skipping: {fname} (unsupported: {ext})")
                continue

            filepath = os.path.join(root, fname)
            rel_path = os.path.relpath(filepath, DOCS_DIR)
            print(f"  📄 Parsing: {rel_path}")

            try:
                with open(filepath, "rb") as f:
                    content = f.read()
                text = await doc_service.parse(content, fname)

                # Save parsed text
                safe_name = rel_path.replace("/", "__").replace(" ", "_")
                out_path = os.path.join(OUTPUT_DIR, f"{safe_name}.txt")
                with open(out_path, "w") as f:
                    f.write(text)

                results.append({
                    "file": rel_path,
                    "size": len(content),
                    "text_length": len(text),
                    "status": "parsed",
                })
                print(f"    ✅ {len(text)} chars extracted")

            except Exception as e:
                results.append({
                    "file": rel_path,
                    "status": "error",
                    "error": str(e),
                })
                print(f"    ❌ Error: {e}")

    # Save manifest
    manifest_path = os.path.join(OUTPUT_DIR, "_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump({
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "source_dir": DOCS_DIR,
            "results": results,
        }, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    success = sum(1 for r in results if r["status"] == "parsed")
    errors = sum(1 for r in results if r["status"] == "error")
    total_chars = sum(r.get("text_length", 0) for r in results)
    print(f"✅ Parsed: {success} files ({total_chars:,} chars total)")
    if errors:
        print(f"❌ Errors: {errors} files")
    print(f"📁 Output: {OUTPUT_DIR}")
    print(f"📋 Manifest: {manifest_path}")

    if extract_mode:
        await run_extraction(results)



async def run_extraction(parse_results: list):
    """Use Claude to extract knowledge entries from parsed documents and save to DB."""
    import uuid
    from app.services.claude_service import ClaudeService, ClaudeServiceError
    from app.db.database import async_session, engine, Base
    from app.models.knowledge import KnowledgeEntry, KnowledgeLog
    from sqlalchemy import text as sql_text

    print("\n🤖 Starting AI knowledge extraction...")

    try:
        claude = ClaudeService()
    except Exception as e:
        print(f"❌ Cannot init Claude: {e}")
        return

    # Init DB
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    MAX_CHUNK = 6000  # chars per Claude call (to stay within token limits)
    total_extracted = 0
    total_errors = 0

    parsed_files = [r for r in parse_results if r["status"] == "parsed"]
    # Sort by text_length ascending so small docs go first (quick wins)
    parsed_files.sort(key=lambda r: r.get("text_length", 0))

    for i, result in enumerate(parsed_files):
        fname = result["file"]
        safe_name = fname.replace("/", "__").replace(" ", "_")
        txt_path = os.path.join(OUTPUT_DIR, f"{safe_name}.txt")

        if not os.path.exists(txt_path):
            continue

        with open(txt_path, "r") as f:
            full_text = f.read()

        if len(full_text.strip()) < 50:
            print(f"  ⏭ [{i+1}/{len(parsed_files)}] {fname} — too short, skipping")
            continue

        # Chunk long documents
        chunks = []
        if len(full_text) <= MAX_CHUNK:
            chunks = [full_text]
        else:
            # Split on paragraph boundaries
            paragraphs = full_text.split("\n\n")
            current_chunk = ""
            for para in paragraphs:
                if len(current_chunk) + len(para) + 2 > MAX_CHUNK and current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = para
                else:
                    current_chunk = current_chunk + "\n\n" + para if current_chunk else para
            if current_chunk:
                chunks.append(current_chunk)

        print(f"  📄 [{i+1}/{len(parsed_files)}] {fname} ({len(full_text):,} chars, {len(chunks)} chunk{'s' if len(chunks)>1 else ''})")

        doc_entries = []
        for ci, chunk in enumerate(chunks):
            try:
                entries = await claude.extract_knowledge(chunk)
                doc_entries.extend(entries)
                if len(chunks) > 1:
                    print(f"      chunk {ci+1}/{len(chunks)}: {len(entries)} entries")
                await asyncio.sleep(1)  # Rate limiting
            except ClaudeServiceError as e:
                total_errors += 1
                print(f"      ❌ chunk {ci+1} error: {e}")
                if "rate_limit" in str(e).lower() or "402" in str(e):
                    print("      ⚠️ Quota likely exhausted, stopping extraction.")
                    await _save_entries_to_db(doc_entries, fname)
                    print(f"\n🛑 Stopped early. Extracted {total_extracted + len(doc_entries)} entries total before quota hit.")
                    return
                continue

        if doc_entries:
            saved = await _save_entries_to_db(doc_entries, fname)
            total_extracted += saved
            print(f"      ✅ {saved} entries saved to DB")
        else:
            print(f"      ⚠️ No entries extracted")

    print(f"\n{'='*60}")
    print(f"🎉 Extraction complete: {total_extracted} knowledge entries created")
    if total_errors:
        print(f"⚠️ {total_errors} chunk errors encountered")


async def _save_entries_to_db(entries: list[dict], source_file: str) -> int:
    """Save extracted entries to the database."""
    import uuid
    from app.db.database import async_session
    from app.models.knowledge import KnowledgeEntry, KnowledgeLog

    saved = 0
    async with async_session() as db:
        for entry in entries:
            try:
                qp = entry.get("question_patterns", [])
                tags = entry.get("tags", [])
                ke = KnowledgeEntry(
                    id=str(uuid.uuid4()),
                    question_patterns=json.dumps(qp, ensure_ascii=False) if isinstance(qp, list) else str(qp),
                    answer=entry.get("answer", ""),
                    conditions=entry.get("conditions"),
                    tags=json.dumps(tags, ensure_ascii=False) if isinstance(tags, list) else str(tags),
                    confidence=0.85,
                    source_type="document",
                    source_ref=source_file,
                    status="active",
                )
                db.add(ke)
                saved += 1
            except Exception as e:
                print(f"      ⚠️ Skip entry: {e}")

        # Log the import
        if saved > 0:
            log = KnowledgeLog(
                id=str(uuid.uuid4()),
                action="imported",
                method="document",
                count=saved,
                details=f"AI-extracted from {source_file}",
                source_filename=source_file,
            )
            db.add(log)

        await db.commit()
    return saved


if __name__ == "__main__":
    asyncio.run(main())
