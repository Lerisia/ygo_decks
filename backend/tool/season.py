"""The home page's 메타 통계 tile names the season, or the Duelist Cup stage while one runs (참혈 2026-10-16).
The cup's dates are kept nowhere else, so operators store them in SiteConfig "duelist_cup_schedule" (manage.py
cup_schedule): {"stages": [{"stage": 1, "start": ISO, "end": ISO}, ...]}, each stage running from its start up to,
not at, its end (Konami's "~ 12:59" is an end of 13:00); times without an offset are Korean."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import SiteConfig

KEY = "duelist_cup_schedule"
STAGES = (1, 2)
KST = ZoneInfo("Asia/Seoul")
# Ranked seasons run a calendar month each, October 2026 being Season 58 (as frontend utils/mdSeason.ts).
BASE_YEAR, BASE_MONTH, BASE_SEASON = 2026, 10, 58
CACHE_KEY, KEEP = "home_season", 60


def md_season(at):
    local = at.astimezone(KST)
    return BASE_SEASON + (local.year - BASE_YEAR) * 12 + (local.month - BASE_MONTH)


def parse_moment(text):
    """An ISO time, Korean when it names no offset; ValueError when it is not one."""
    if not isinstance(text, str):
        raise ValueError(text)
    at = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    return at if at.tzinfo else at.replace(tzinfo=KST)


def stored_rows():
    try:
        rows = json.loads(SiteConfig.get(KEY) or "{}").get("stages", [])
    except (ValueError, AttributeError):
        return []
    return rows if isinstance(rows, list) else []


def cup_stages(rows=None):
    """[(stage, start, end)] by start; rows that do not read are left out."""
    stages = []
    for row in stored_rows() if rows is None else rows:
        try:
            stage, start, end = row["stage"], parse_moment(row["start"]), parse_moment(row["end"])
        except (TypeError, KeyError, ValueError):
            continue
        if stage in STAGES and start < end:
            stages.append((stage, start, end))
    return sorted(stages, key=lambda s: s[1])


def cup_stage(at=None):
    """The stage running at `at`; where two run at once (Konami keeps the 1st open through the 2nd), the later one."""
    at = at or timezone.now()
    running = [(start, stage) for stage, start, end in cup_stages() if start <= at < end]
    return max(running)[1] if running else None


@api_view(["GET"])
@permission_classes([AllowAny])
def home_season(request):
    """{season, cup_stage: null | 1 | 2}, kept a minute."""
    body = cache.get(CACHE_KEY)
    if body is None:
        now = timezone.now()
        body = {"season": md_season(now), "cup_stage": cup_stage(now)}
        cache.set(CACHE_KEY, body, KEEP)
    r = Response(body)
    r["Cache-Control"] = f"public, max-age={KEEP}"
    return r
