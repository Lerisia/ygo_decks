"""Skill name game (beta): the ranking.

The page judges each name itself so typing feels instant; the ranking does not take its word for the result. A game
starts with a signed token, ends with the list of names and when each was typed, and is recorded only if that list
could have been played: real skills, none twice, each inside the 20-second clock, and no faster than the wall clock.
Guests are let in during the beta and leave a nickname; guests at one address count as one player.
"""
import ipaddress
import json
import os
import re
import secrets
import time
import unicodedata

from django.core import signing
from django.db import IntegrityError, transaction
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from avatar.serializers import BorderSerializer, CardIconSerializer
from avatar.views import _resolve_default_border, _resolve_default_icon

from .models import SkillNameScore

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "lol_skills.json")
TOKEN_SALT = "solo.skill-names"
TOKEN_MAX_AGE = 12 * 3600
TURN_MS = 20_000
TURN_GRACE_MS = 1_500     # the page's clock ticks every 100 ms and submits what is typed as it runs out
MIN_GAP_MS = 300          # nobody types a name faster
CLOCK_GRACE_MS = 5_000    # the token is signed a network round trip after the page started its clock
NICKNAME_MAX = 12
BOARD_SIZE = 30


class GameThrottle(SimpleRateThrottle):
    """Per address, members and guests alike: far more games than a person plays, far fewer than a script wants."""
    rate = "120/hour"

    def get_cache_key(self, request, view):
        return f"throttle_skill_names_{self.get_ident(request)}"


def normalize(s):
    """What two spellings of a name are compared by (the same rule as the page's normalizeName)."""
    return re.sub(r"[^0-9a-z가-힣]", "", unicodedata.normalize("NFKC", str(s)).lower())


def _load_keys():
    with open(DATA_PATH, encoding="utf-8") as f:
        return {normalize(s["n"]) for s in json.load(f)["skills"]} - {""}


SKILL_KEYS = _load_keys()


def _played(answers, elapsed_ms):
    """The names of a game that could have been played, or None."""
    if not isinstance(answers, list) or not 0 < len(answers) <= len(SKILL_KEYS):
        return None
    names, seen, last = [], set(), 0
    for a in answers:
        if not isinstance(a, dict) or not isinstance(a.get("name"), str) or isinstance(a.get("ms"), bool):
            return None
        ms = a.get("ms")
        if not isinstance(ms, (int, float)):
            return None
        key = normalize(a["name"])
        if key not in SKILL_KEYS or key in seen:
            return None
        if ms - last > TURN_MS + TURN_GRACE_MS or (names and ms - last < MIN_GAP_MS) or ms < 0:
            return None
        seen.add(key); names.append(a["name"].strip()[:40]); last = ms
    return names if last <= elapsed_ms + CLOCK_GRACE_MS else None


def _client_ip(request):
    ip = (request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR") or "").strip()
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return None
    return ip


def _players():
    """Every player's best game, best first, and which player each game belongs to.

    A member is the account. Guests cannot be told apart for certain, so two guest games are taken as one player's
    when they share an address or a nickname: one person trying several nicknames stays one row, and so does one
    person whose phone changes address between games.
    """
    games = list(SkillNameScore.objects.select_related("user", "user__avatar_icon", "user__avatar_icon__card", "user__equipped_border"))
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for g in games:
        if g.user_id is None and g.ip:
            parent[find(("name", g.nickname))] = find(("ip", g.ip))
    who = {g.id: ("user", g.user_id) if g.user_id else find(("name", g.nickname)) for g in games}
    seen, best = set(), []
    for g in games:
        if who[g.id] not in seen:
            seen.add(who[g.id]); best.append(g)
    return best, who


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([GameThrottle])
def start(request):
    return Response({"token": signing.dumps({"g": secrets.token_urlsafe(12), "t": time.time()}, salt=TOKEN_SALT)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([GameThrottle])
def submit(request):
    try:
        game = signing.loads(str(request.data.get("token") or ""), salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE)
    except signing.BadSignature:
        return Response({"error": "게임 정보가 올바르지 않습니다."}, status=400)
    names = _played(request.data.get("answers"), (time.time() - game["t"]) * 1000)
    if names is None:
        return Response({"error": "기록을 확인할 수 없습니다."}, status=400)

    user = request.user if request.user.is_authenticated else None
    nickname = ""
    if user is None:
        nickname = " ".join(str(request.data.get("nickname") or "").split())
        if not nickname or len(nickname) > NICKNAME_MAX or not nickname.isprintable():
            return Response({"error": f"닉네임을 1~{NICKNAME_MAX}자로 입력해 주세요."}, status=400)

    try:
        with transaction.atomic():
            score = SkillNameScore.objects.create(
                user=user, nickname=nickname, count=len(names), names=names, game_id=game["g"], ip=_client_ip(request)
            )
    except IntegrityError:
        score = SkillNameScore.objects.get(game_id=game["g"])   # sent twice: the first one stands

    best, who = _players()
    rank = next(i for i, g in enumerate(best, 1) if who[g.id] == who[score.id])
    return Response({"count": score.count, "rank": rank, "best": best[rank - 1].count, "players": len(best)})


@api_view(["GET"])
@permission_classes([AllowAny])
def leaderboard(request):
    default_icon, default_border = _resolve_default_icon(), _resolve_default_border()
    default_icon_data = CardIconSerializer(default_icon).data if default_icon else None
    default_border_data = BorderSerializer(default_border).data if default_border else None

    rows, _ = _players()
    board = []
    for s in rows[:BOARD_SIZE]:
        u = s.user
        board.append({
            "name": u.username if u else s.nickname,
            "guest": u is None,
            "count": s.count,
            "avatar_icon": None if u is None else CardIconSerializer(u.avatar_icon).data if u.avatar_icon else default_icon_data,
            "border": None if u is None else BorderSerializer(u.equipped_border).data if u.equipped_border else default_border_data,
        })
    my_best = None
    if request.user.is_authenticated:
        my_best = next((s.count for s in rows if s.user_id == request.user.id), None)
    return Response({"leaderboard": board, "players": len(rows), "my_best": my_best})
