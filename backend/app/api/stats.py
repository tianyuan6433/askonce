from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, text
from datetime import datetime, timedelta

from app.db.database import get_db
from app.models.knowledge import KnowledgeEntry
from app.models.interaction import Interaction

router = APIRouter()


class StatsOverview(BaseModel):
    total_knowledge_entries: int
    total_interactions: int
    adoption_rate: float     # average edit_ratio for adopted interactions (0-100%)
    adopted_count: int       # number of interactions with copy action
    avg_confidence: float
    auto_reply_count: int
    draft_reply_count: int
    low_confidence_count: int
    confirmed_count: int
    avg_response_ms: int = 0


@router.get("/overview", response_model=StatsOverview)
async def get_stats_overview(db: AsyncSession = Depends(get_db)):
    """Get overview statistics — single efficient query."""
    # Knowledge count
    ke_result = await db.execute(select(func.count()).select_from(KnowledgeEntry))
    total_knowledge = ke_result.scalar() or 0

    # All interaction stats in one query
    result = await db.execute(
        select(
            func.count().label("total"),
            func.count(case((Interaction.status.in_(["confirmed", "edited"]), 1))).label("confirmed"),
            func.avg(Interaction.confidence).label("avg_conf"),
            func.count(case((Interaction.confidence >= 0.90, 1))).label("auto_reply"),
            func.count(case(
                (Interaction.confidence >= 0.60, 1),
            )).label("draft_or_better"),
            func.count(case((Interaction.confidence < 0.60, 1))).label("low_conf"),
            # Adoption: average edit_ratio across adopted interactions
            func.avg(case(
                (Interaction.edit_ratio.isnot(None), Interaction.edit_ratio),
            )).label("avg_edit_ratio"),
            func.count(case((Interaction.edit_ratio.isnot(None), 1))).label("adopted"),
            # Response time
            func.avg(case(
                (Interaction.elapsed_ms.isnot(None), Interaction.elapsed_ms),
            )).label("avg_ms"),
        ).select_from(Interaction)
    )
    row = result.one()
    total = row.total or 0
    confirmed = row.confirmed or 0
    avg_conf = float(row.avg_conf or 0)
    auto_reply = row.auto_reply or 0
    draft_count = (row.draft_or_better or 0) - auto_reply
    low_conf = row.low_conf or 0
    avg_edit_ratio = float(row.avg_edit_ratio or 0)
    adopted = row.adopted or 0
    avg_ms = int(row.avg_ms or 0)
    # adoption_rate = average similarity (edit_ratio) * 100
    adoption_rate = round(avg_edit_ratio * 100, 1) if adopted > 0 else 0.0

    return StatsOverview(
        total_knowledge_entries=total_knowledge,
        total_interactions=total,
        adoption_rate=adoption_rate,
        adopted_count=adopted,
        avg_confidence=round(avg_conf, 2),
        auto_reply_count=auto_reply,
        draft_reply_count=max(0, draft_count),
        low_confidence_count=low_conf,
        confirmed_count=confirmed,
        avg_response_ms=avg_ms,
    )


class TrendDataPoint(BaseModel):
    label: str
    interactions: int
    confirmed: int
    avg_response_ms: int = 0


class TrendsResponse(BaseModel):
    period: str
    data: list[TrendDataPoint]
    prev_data: list[TrendDataPoint] = []
    summary: dict = {}


@router.get("/trends", response_model=TrendsResponse)
async def get_trends(period: str = Query("week"), db: AsyncSession = Depends(get_db)):
    """Get trend data with period support and comparison.
    
    period=day   → 24 hourly data points (today), compare vs yesterday
    period=week  → 7 daily data points (this week), compare vs last week
    period=month → ~30 daily data points (this month), compare vs last month
    """
    now = datetime.utcnow()
    today = now.date()

    if period == "day":
        # Today's hourly breakdown
        day_start = datetime.combine(today, datetime.min.time())
        data = await _get_hourly_data(db, day_start, now)
        # Yesterday for comparison
        prev_start = day_start - timedelta(days=1)
        prev_end = datetime.combine(today - timedelta(days=1), datetime.max.time())
        prev_data = await _get_hourly_data(db, prev_start, prev_end)

    elif period == "month":
        # This month's daily breakdown
        month_start = today.replace(day=1)
        start_dt = datetime.combine(month_start, datetime.min.time())
        days = (today - month_start).days + 1
        data = await _get_daily_data(db, start_dt, now, days)
        # Last month for comparison
        prev_month = (month_start - timedelta(days=1)).replace(day=1)
        prev_end_date = month_start - timedelta(days=1)
        prev_days = (prev_end_date - prev_month).days + 1
        prev_start = datetime.combine(prev_month, datetime.min.time())
        prev_end = datetime.combine(prev_end_date, datetime.max.time())
        prev_data = await _get_daily_data(db, prev_start, prev_end, prev_days)

    else:  # week (default)
        # Last 7 days
        week_start = today - timedelta(days=6)
        start_dt = datetime.combine(week_start, datetime.min.time())
        data = await _get_daily_data(db, start_dt, now, 7)
        # Previous 7 days
        prev_start = datetime.combine(week_start - timedelta(days=7), datetime.min.time())
        prev_end = datetime.combine(week_start - timedelta(days=1), datetime.max.time())
        prev_data = await _get_daily_data(db, prev_start, prev_end, 7)

    # Summary: totals for current vs previous period
    curr_total = sum(d.interactions for d in data)
    curr_confirmed = sum(d.confirmed for d in data)
    prev_total = sum(d.interactions for d in prev_data)
    prev_confirmed = sum(d.confirmed for d in prev_data)

    def pct_change(curr: int, prev: int) -> float | None:
        if prev == 0:
            return None
        return round((curr - prev) / prev * 100, 1)

    summary = {
        "current_total": curr_total,
        "current_confirmed": curr_confirmed,
        "prev_total": prev_total,
        "prev_confirmed": prev_confirmed,
        "total_change_pct": pct_change(curr_total, prev_total),
        "confirmed_change_pct": pct_change(curr_confirmed, prev_confirmed),
    }

    return TrendsResponse(period=period, data=data, prev_data=prev_data, summary=summary)


async def _get_hourly_data(
    db: AsyncSession, start: datetime, end: datetime
) -> list[TrendDataPoint]:
    """Get hourly aggregated interaction data using a single GROUP BY query."""
    result = await db.execute(
        select(
            func.strftime("%H", Interaction.created_at).label("hour"),
            func.count().label("total"),
            func.count(case((Interaction.status.in_(["confirmed", "edited"]), 1))).label("confirmed"),
        )
        .select_from(Interaction)
        .where(Interaction.created_at >= start, Interaction.created_at <= end)
        .group_by("hour")
    )
    rows = {r.hour: r for r in result.all()}

    data = []
    for h in range(24):
        hk = f"{h:02d}"
        r = rows.get(hk)
        data.append(TrendDataPoint(
            label=f"{h:02d}:00",
            interactions=r.total if r else 0,
            confirmed=r.confirmed if r else 0,
        ))
    return data


async def _get_daily_data(
    db: AsyncSession, start: datetime, end: datetime, num_days: int
) -> list[TrendDataPoint]:
    """Get daily aggregated interaction data using a single GROUP BY query."""
    result = await db.execute(
        select(
            func.date(Interaction.created_at).label("day"),
            func.count().label("total"),
            func.count(case((Interaction.status.in_(["confirmed", "edited"]), 1))).label("confirmed"),
        )
        .select_from(Interaction)
        .where(Interaction.created_at >= start, Interaction.created_at <= end)
        .group_by("day")
    )
    rows = {r.day: r for r in result.all()}
    day_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    data = []
    base_date = start.date() if isinstance(start, datetime) else start
    for i in range(num_days):
        d = base_date + timedelta(days=i)
        dk = d.isoformat()
        r = rows.get(dk)
        label = f"{d.month}/{d.day} {day_labels[d.weekday()]}"
        data.append(TrendDataPoint(
            label=label,
            interactions=r.total if r else 0,
            confirmed=r.confirmed if r else 0,
        ))
    return data
