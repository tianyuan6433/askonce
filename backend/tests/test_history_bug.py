import pytest
import uuid
from app.models.interaction import Interaction


class TestHistoryFilter:
    @pytest.mark.asyncio
    async def test_history_excludes_null_draft_reply(self, client, db_session):
        good = Interaction(
            id=str(uuid.uuid4()),
            query_text="What is Pivot Plus?",
            draft_reply="Pivot Plus is a platform...",
            channel="manual",
            confidence=0.9,
            status="draft",
        )
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
