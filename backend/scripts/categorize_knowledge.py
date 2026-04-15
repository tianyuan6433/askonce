"""
Backfill category for all knowledge entries that have category=NULL.
Usage: python -m scripts.categorize_knowledge
Run from the backend directory.
"""
import asyncio
import sys
import os

# Ensure backend root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update
from app.db.database import async_session
from app.models.knowledge import KnowledgeEntry


def auto_categorize(answer: str, tags: list[str]) -> str:
    """Auto-assign category based on content keywords."""
    text = (answer + " " + " ".join(tags)).lower()
    categories = {
        "Product": ["pivot", "maxhub", "dms", "cms", "device", "display", "screen", "panel", "ifp"],
        "Pricing": ["price", "pricing", "cost", "plan", "subscription", "license", "tier", "discount"],
        "Technical": ["api", "install", "setup", "configure", "deploy", "firmware", "update", "network", "server"],
        "Support": ["support", "troubleshoot", "error", "issue", "fix", "help", "contact", "warranty", "return"],
        "Security": ["security", "soc", "gdpr", "encrypt", "tls", "compliance", "audit", "permission"],
        "Content": ["content", "playlist", "canvas", "resource", "media", "schedule", "publish"],
        "Organization": ["organization", "role", "admin", "user", "member", "permission", "group"],
    }
    for cat, keywords in categories.items():
        if any(kw in text for kw in keywords):
            return cat
    return "General"


async def main():
    async with async_session() as db:
        result = await db.execute(
            select(KnowledgeEntry).where(KnowledgeEntry.category.is_(None))
        )
        entries = result.scalars().all()

        if not entries:
            print("No entries with NULL category found.")
            return

        print(f"Found {len(entries)} entries with NULL category. Categorizing...")

        counts: dict[str, int] = {}
        for entry in entries:
            tags = entry.tags if isinstance(entry.tags, list) else []
            cat = auto_categorize(entry.answer or "", tags)
            entry.category = cat
            counts[cat] = counts.get(cat, 0) + 1

        await db.commit()

        print(f"Done! Updated {len(entries)} entries:")
        for cat, count in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"  {cat}: {count}")


if __name__ == "__main__":
    asyncio.run(main())
