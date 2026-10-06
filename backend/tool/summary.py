"""The sheet page's header (2026-10-06 redesign): where the sheet stands right now, in one pass over its rows."""
from datetime import datetime, timedelta

from django.utils import timezone

RECENT = 20


def sheet_summary(matches):
    """`matches`: a MatchRecord queryset already narrowed to the sheet (and member)."""
    rows = list(
        matches.order_by("id").values("result", "first_or_second", "coin_toss_result", "rank", "wins", "score", "score_type", "created_at")
    )
    totals = {k: 0 for k in ("games", "wins", "first", "first_wins", "second", "second_wins",
                             "coin_win", "coin_win_wins", "coin_lose", "coin_lose_wins")}
    for r in rows:
        win = r["result"] == "win"
        totals["games"] += 1
        totals["wins"] += win
        if r["first_or_second"] in ("first", "second"):
            totals[r["first_or_second"]] += 1
            totals[f"{r['first_or_second']}_wins"] += win
        if r["coin_toss_result"] in ("win", "lose"):
            key = f"coin_{r['coin_toss_result']}"
            totals[key] += 1
            totals[f"{key}_wins"] += win

    if not rows:
        return {"totals": totals, "recent": [], "streak": None, "last_day": None, "latest": None}

    last = rows[-1]
    streak = 0
    for r in reversed(rows):
        if r["result"] != last["result"]:
            break
        streak += 1

    day = timezone.localtime(last["created_at"]).date()
    day_rows = [r for r in rows if timezone.localtime(r["created_at"]).date() == day]

    return {
        "totals": totals,
        "recent": [{"r": r["result"], "fs": r["first_or_second"], "coin": r["coin_toss_result"]} for r in rows[-RECENT:]],
        "streak": {"result": last["result"], "count": streak},
        "last_day": {"date": day.isoformat(), "count": len(day_rows), "wins": sum(r["result"] == "win" for r in day_rows)},
        "latest": {k: last[k] for k in ("result", "rank", "wins", "score", "score_type")},
    }


def filter_period(matches, params):
    """Narrow a MatchRecord queryset by `period` (today | 7d) or `date_from` / `date_to` (YYYY-MM-DD, local days).
    Anything unreadable leaves the queryset as it is."""
    now = timezone.localtime(timezone.now())
    period = params.get("period")
    if period == "today":
        start = timezone.make_aware(datetime.combine(now.date(), datetime.min.time()))
        return matches.filter(created_at__gte=start)
    if period == "7d":
        return matches.filter(created_at__gte=now - timedelta(days=7))

    def day(name):
        try:
            return datetime.strptime(params.get(name) or "", "%Y-%m-%d").date()
        except ValueError:
            return None

    lo, hi = day("date_from"), day("date_to")
    if lo:
        matches = matches.filter(created_at__gte=timezone.make_aware(datetime.combine(lo, datetime.min.time())))
    if hi:
        matches = matches.filter(created_at__lt=timezone.make_aware(datetime.combine(hi + timedelta(days=1), datetime.min.time())))
    return matches
