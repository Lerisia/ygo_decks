"""Solo Duchmind endpoints — async draw & guess board.

Auth: all endpoints require login (guests blocked at view level — no
`AllowAny` here). The frontend is responsible for showing a login wall.

Daily quotas: enforced via SoloDailyPoints rows under SELECT FOR UPDATE so
two concurrent requests from the same user can't both bypass the cap.

Card pool: hard-pinned to the system "중급" DuchMindWordPack — same pool
the multiplayer "중급" tier draws from, so the moderator can curate one
list and both modes reuse it.
"""
import random
import re
import secrets
from datetime import timedelta
from typing import Optional

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from avatar.serializers import CardIconSerializer, BorderSerializer
from avatar.views import _resolve_default_icon, _resolve_default_border
from card.models import Card
from multiplayer.models import DuchMindWord, DuchMindWordPack
from user.points import award_points


def _decimate_strokes(strokes, target_moves: int = 600):
    """Drop intermediate 'move' points so the board can render compact
    previews without paying for the full ~50–200 KB stroke buffer per card.

    'start', 'end', and 'fill' events are always preserved — they carry
    metadata (color/size/tool) and stroke boundaries that the renderer
    relies on. Only 'move' events are decimated, and the keep-every factor
    is computed per-drawing so very short drawings stay untouched while
    huge drawings collapse hard.
    """
    if not strokes:
        return []
    moves = sum(1 for s in strokes if (s or {}).get("op") == "move")
    if moves <= target_moves:
        return strokes
    keep_every = max(2, moves // target_moves + 1)
    out = []
    move_counter = 0
    for s in strokes:
        op = (s or {}).get("op")
        if op == "move":
            if move_counter % keep_every == 0:
                out.append(s)
            move_counter += 1
        else:
            # Reset on each segment so the first move after 'start' is
            # always kept — preserves the line's starting shape.
            move_counter = 0
            out.append(s)
    return out


def _serialize_user_avatar(user) -> dict:
    """Return {icon, border} dicts for a User, falling back to system
    defaults so the frontend always has something to render. Mirrors the
    multiplayer RoomPlayerSerializer.get_avatar_icon / get_border pattern."""
    icon = getattr(user, "avatar_icon", None) if user else None
    if icon is None:
        icon = _resolve_default_icon()
    border = getattr(user, "equipped_border", None) if user else None
    if border is None:
        border = _resolve_default_border()
    return {
        "avatar_icon": CardIconSerializer(icon).data if icon else None,
        "border": BorderSerializer(border).data if border else None,
    }

from .models import (
    SOLO_DAILY_POINTS_CAP,
    SOLO_DRAW_SECONDS,
    SOLO_DRAWER_FIRST_POINTS,
    SOLO_DRAWER_MAX_POINTS,
    SOLO_DRAWER_NEXT_POINTS,
    SOLO_DRAWING_LIFESPAN_DAYS,
    SOLO_GUESSER_FIRST_POINTS,
    SOLO_GUESSER_NEXT_POINTS,
    SOLO_POINT_ATTEMPT_LIMIT,
    SoloDailyPoints,
    SoloDrawing,
    SoloDrawingGuess,
    SoloDrawingRecommend,
)


# Reuses multiplayer's normalizer so "마법 사" matches "마법사" the same way
# the live game does — keeps the answer-matching feel consistent across modes.
def _normalize_for_match(s: str) -> str:
    return re.sub(r"[^가-힣a-zA-Z0-9]+", "", (s or "")).lower()


def _today():
    return timezone.localdate()


def _intermediate_pack() -> Optional[DuchMindWordPack]:
    return DuchMindWordPack.objects.filter(name="중급", owner__isnull=True).first()


def _card_image_url(card: Card) -> Optional[str]:
    try:
        if card.card_illust:
            return card.card_illust.url
    except ValueError:
        pass
    return card.image_url or None


def _get_or_create_daily(user, *, lock: bool = False, source: str = "duchmind") -> SoloDailyPoints:
    """Daily ledger row for (user, today, source). Each solo game mode caps
    independently — `source` is "duchmind" (default for back-compat with the
    existing duchmind callsites) or "twenty" for the 딱무고개 mode."""
    today = _today()
    qs = SoloDailyPoints.objects.filter(user=user, date=today, source=source)
    if lock:
        qs = qs.select_for_update()
    row = qs.first()
    if row is None:
        row, _ = SoloDailyPoints.objects.get_or_create(user=user, date=today, source=source)
        if lock:
            row = SoloDailyPoints.objects.select_for_update().get(pk=row.pk)
    return row


def _serialize_drawing_summary(d: SoloDrawing, *, viewer, include_strokes: bool = False) -> dict:
    """Card thumbnail is intentionally omitted for unsolved drawings — viewers
    must solve (or be the drawer/already-solver) before seeing the answer image.

    `include_strokes` ships the stroke buffer so the board can render a
    mini-canvas preview — the drawing itself is public, only the answer is
    gated.

    Viewer may be `AnonymousUser` (guest browsing without login). In that
    case all "iam_*" flags collapse to False and the answer stays hidden
    until the guest solves it — but their solve isn't persisted, so the
    answer just unlocks for this single guess via lastResult on the
    frontend side.
    """
    viewer_authed = getattr(viewer, "is_authenticated", False)
    viewer_id = getattr(viewer, "id", None) if viewer_authed else None
    viewer_is_staff = bool(viewer_authed and (getattr(viewer, "is_staff", False) or getattr(viewer, "is_superuser", False)))
    iam_drawer = (viewer_id is not None and d.drawer_id == viewer_id)
    my_guess = (
        SoloDrawingGuess.objects.filter(drawing=d, guesser=viewer).first()
        if viewer_authed else None
    )
    iam_solver = bool(my_guess and my_guess.solved)
    iam_gave_up = bool(my_guess and my_guess.gave_up)
    # 'reveal' gates the answer + card image — drawer can always see it, and
    # so can anyone who solved OR explicitly gave up (no take-backs).
    reveal = iam_drawer or iam_solver or iam_gave_up
    drawer_avatar = _serialize_user_avatar(d.drawer) if d.drawer else {"avatar_icon": None, "border": None}
    out = {
        "id": d.id,
        "drawer_id": str(d.drawer_id),
        "drawer_name": d.drawer.username if d.drawer else "(?)",
        "drawer_avatar_icon": drawer_avatar["avatar_icon"],
        "drawer_border": drawer_avatar["border"],
        "created_at": d.created_at.isoformat(),
        "expires_at": d.expires_at.isoformat(),
        "solver_count": d.solver_count,
        "recommend_count": d.recommend_count,
        "is_hidden": d.is_hidden,
        "aspect_ratio": d.aspect_ratio or 1.6,
        "first_solved_at": d.first_solved_at.isoformat() if d.first_solved_at else None,
        "iam_drawer": iam_drawer,
        "iam_solved": iam_solver,
        "iam_gave_up": iam_gave_up,
        # Staff-only flag — surfaces the delete button on any drawing, not
        # just one's own. Read by the client to render an admin delete UI.
        "viewer_is_staff": viewer_is_staff,
        "my_attempts_used": my_guess.attempts_used if my_guess else 0,
        # Answer + card image only revealed to drawer / solver / gave-up.
        "word": d.word if reveal else None,
        "card_image_url": _card_image_url(d.card) if (reveal and d.card) else None,
    }
    if include_strokes:
        # Board previews ship a decimated buffer so the response stays
        # under a megabyte even when a page is full of long drawings; the
        # detail endpoint still sends the full stroke list for replay.
        out["strokes"] = _decimate_strokes(d.strokes_json or [])
    return out


# ---------------------------------------------------------------------
# Drawing creation: offer → submit
# ---------------------------------------------------------------------

def _cards_payload(card_ids: list) -> list:
    """Serialize a card-id list into the offer payload, preserving order."""
    cards_by_id = {c.id: c for c in Card.objects.filter(id__in=card_ids)}
    out = []
    for cid in card_ids:
        c = cards_by_id.get(cid)
        if not c:
            continue
        out.append({
            "card_id": c.id,
            "name": c.korean_name or c.name,
            "image_url": _card_image_url(c),
        })
    return out


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def start_draw(request):
    """Offer 3 random card choices. The offer is persisted on the user's
    daily ledger so a refresh / re-open returns the SAME three cards —
    players can't re-roll until they actually submit a drawing (or the day
    rolls over and a fresh ledger row starts empty). The token is required
    on submit so the client can't claim a card it wasn't offered.

    There is no drawings-per-day limit — the only throttle is the unified
    daily points cap, enforced at award time."""
    user = request.user

    with transaction.atomic():
        daily = _get_or_create_daily(user, lock=True)

        # Reuse an outstanding offer if one exists — this is what blocks the
        # re-roll exploit.
        if daily.pending_offer_cards and daily.pending_offer_token:
            cards = _cards_payload(list(daily.pending_offer_cards))
            if len(cards) >= 3:
                return Response({
                    "offer_token": daily.pending_offer_token,
                    "draw_seconds": SOLO_DRAW_SECONDS,
                    "cards": cards,
                })
            # Stale (cards deleted/disabled) — fall through and re-deal.

        pack = _intermediate_pack()
        if not pack:
            return Response({"error": "단어팩 설정이 잘못되어 있습니다. 관리자에게 문의해주세요."}, status=500)

        pool = list(
            DuchMindWord.objects
            .filter(pack=pack, enabled=True, card__isnull=False)
            .values_list("card_id", flat=True)
        )
        if len(pool) < 3:
            return Response({"error": "단어 풀이 부족합니다."}, status=500)

        card_ids = random.sample(pool, 3)
        token = secrets.token_urlsafe(16)
        daily.pending_offer_cards = card_ids
        daily.pending_offer_token = token
        daily.save(update_fields=["pending_offer_cards", "pending_offer_token"])

    return Response({
        "offer_token": token,
        "draw_seconds": SOLO_DRAW_SECONDS,
        "cards": _cards_payload(card_ids),
    })


def _validate_strokes(strokes) -> Optional[str]:
    if not isinstance(strokes, list):
        return "strokes는 배열이어야 합니다."
    # Keep submission size bounded — same 50k cap multiplayer uses.
    if len(strokes) > 50_000:
        return "획이 너무 많습니다."
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def submit_draw(request):
    user = request.user
    token = (request.data.get("offer_token") or "").strip()
    card_id = request.data.get("card_id")
    strokes = request.data.get("strokes") or []

    err = _validate_strokes(strokes)
    if err:
        return Response({"error": err}, status=400)

    # Canvas aspect the drawing was made at — clamped to a sane range so a
    # bad client can't store something degenerate.
    try:
        aspect = float(request.data.get("aspect_ratio") or 1.6)
    except (TypeError, ValueError):
        aspect = 1.6
    aspect = max(0.4, min(2.6, aspect))

    now = timezone.now()
    expires = now + timedelta(days=SOLO_DRAWING_LIFESPAN_DAYS)

    with transaction.atomic():
        daily = _get_or_create_daily(user, lock=True)
        # Validate against the persisted offer — token + card must match
        # what was dealt, so the client can't draw an un-offered card.
        if not daily.pending_offer_token or daily.pending_offer_token != token:
            return Response({"error": "잘못된 요청입니다 (토큰)."}, status=400)
        if card_id not in (daily.pending_offer_cards or []):
            return Response({"error": "제시되지 않은 카드입니다."}, status=400)

        card = Card.objects.filter(id=card_id).first()
        if not card:
            return Response({"error": "카드를 찾을 수 없습니다."}, status=404)

        word = card.korean_name or card.name or ""
        d = SoloDrawing.objects.create(
            drawer=user,
            card=card,
            word=word,
            strokes_json=strokes,
            aspect_ratio=aspect,
            expires_at=expires,
        )
        daily.drawings_created = daily.drawings_created + 1
        # Consume the offer so the next start_draw deals a fresh trio.
        daily.pending_offer_cards = []
        daily.pending_offer_token = ""
        daily.save(update_fields=["drawings_created", "pending_offer_cards", "pending_offer_token"])

    return Response({"id": d.id})


# ---------------------------------------------------------------------
# Board / detail
# ---------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([AllowAny])
def board(request):
    """Board feed. Guests can browse — anon viewers get all the same
    drawings but with iam_* flags collapsed to False (no own-drawing
    badge, no "solved" highlight). Tabs that filter on the viewer (e.g.
    `unsolved`, `mine`) fall back to `all` for anon.

    tab:
      all       — every (visible, unexpired) drawing
      unsolved  — drawings the VIEWER hasn't solved (own drawings excluded)
      nobody    — drawings nobody has solved yet (first_solved_at IS NULL)
    order (within the tab):
      recent     — newest first (default)
      solvers    — most solvers first
      recommends — most recommends first

    Separately, `hall_of_fame` carries the 3 most-recommended drawings,
    surfaced at the top of the board regardless of tab/order.
    """
    user = request.user
    is_authed = getattr(user, "is_authenticated", False)
    tab = (request.GET.get("tab") or "all").lower()
    order = (request.GET.get("order") or "recent").lower()
    try:
        page = max(1, int(request.GET.get("page") or 1))
    except ValueError:
        page = 1
    page_size = 12
    now = timezone.now()

    base = SoloDrawing.objects.select_related("drawer", "card").filter(
        is_hidden=False, expires_at__gt=now,
    )
    # Viewer-relative tabs (unsolved / mine) only make sense when logged
    # in; anon guests fall back to `all` rather than 404-ing.
    if tab == "unsolved" and is_authed:
        solved_ids = list(
            SoloDrawingGuess.objects.filter(guesser=user, solved=True)
            .values_list("drawing_id", flat=True)
        )
        base = base.exclude(drawer=user).exclude(id__in=solved_ids)
    elif tab == "nobody":
        base = base.filter(first_solved_at__isnull=True)
    elif tab == "mine" and is_authed:
        # User's own drawings — also surfaces hidden ones since the
        # drawer themselves should be able to see what they've posted.
        base = SoloDrawing.objects.select_related("drawer", "card").filter(drawer=user)
    else:
        tab = "all"

    if order == "solvers":
        base = base.order_by("-solver_count", "-created_at")
    elif order == "recommends":
        base = base.order_by("-recommend_count", "-created_at")
    else:
        order = "recent"
        base = base.order_by("-created_at")

    total = base.count()
    start = (page - 1) * page_size
    chunk = list(base[start:start + page_size])

    # Hall of Fame — the 3 most-recommended drawings (must have at least one
    # recommend to qualify). Always returned, independent of tab/order.
    hof = list(
        SoloDrawing.objects.select_related("drawer", "card")
        .filter(is_hidden=False, expires_at__gt=now, recommend_count__gt=0)
        .order_by("-recommend_count", "-created_at")[:3]
    )

    return Response({
        "tab": tab,
        "order": order,
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            _serialize_drawing_summary(d, viewer=user, include_strokes=True)
            for d in chunk
        ],
        "hall_of_fame": [
            _serialize_drawing_summary(d, viewer=user, include_strokes=True)
            for d in hof
        ],
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def drawing_detail(request, drawing_id: int):
    d = SoloDrawing.objects.select_related("drawer", "card").filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    viewer_id = getattr(request.user, "id", None) if request.user.is_authenticated else None
    if d.is_hidden and d.drawer_id != viewer_id:
        return Response({"error": "비공개된 그림입니다."}, status=404)

    summary = _serialize_drawing_summary(d, viewer=request.user)
    iam_drawer = summary["iam_drawer"]
    iam_solved = summary["iam_solved"]
    expired = d.expires_at <= timezone.now()

    # Solver list — public. Order: first solved at the top.
    solver_rows = (
        SoloDrawingGuess.objects.filter(drawing=d, solved=True)
        .select_related("guesser")
        .order_by("solved_at")
    )
    solvers = []
    for g in solver_rows:
        av = _serialize_user_avatar(g.guesser)
        solvers.append({
            "user_id": str(g.guesser_id),
            "name": g.guesser.username,
            "solved_at": g.solved_at.isoformat() if g.solved_at else None,
            "avatar_icon": av["avatar_icon"],
            "border": av["border"],
        })

    # Recommend toggle state for the viewer (auth only — anon can't
    # recommend; the frontend hides the button for guests).
    iam_recommended = (
        SoloDrawingRecommend.objects.filter(drawing=d, user=request.user).exists()
        if request.user.is_authenticated else False
    )

    return Response({
        **summary,
        "strokes": d.strokes_json or [],
        "draw_seconds": SOLO_DRAW_SECONDS,
        "point_attempt_limit": SOLO_POINT_ATTEMPT_LIMIT,
        "iam_recommended": iam_recommended,
        "expired": expired,
        # Drawer-only intel.
        "solvers": solvers,
    })


# ---------------------------------------------------------------------
# Guess submission
# ---------------------------------------------------------------------

@api_view(["POST"])
@permission_classes([AllowAny])
def submit_guess(request, drawing_id: int):
    user = request.user
    is_authed = user.is_authenticated
    raw = (request.data.get("guess") or "").strip()
    if not raw:
        return Response({"error": "정답을 입력해주세요."}, status=400)

    d = SoloDrawing.objects.select_related("card").filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    if d.is_hidden:
        return Response({"error": "비공개된 그림입니다."}, status=404)
    if d.expires_at <= timezone.now():
        return Response({"error": "만료된 그림입니다."}, status=410)
    if is_authed and d.drawer_id == user.id:
        return Response({"error": "자신의 그림에는 응답할 수 없습니다."}, status=403)

    now = timezone.now()
    correct_norm = _normalize_for_match(d.word)
    guess_norm = _normalize_for_match(raw)
    correct = bool(correct_norm) and (correct_norm == guess_norm)

    # Guest guess — no DB write, no solver-count increment, no points,
    # not surfaced in the solver list. Just correctness for fun.
    if not is_authed:
        return Response({
            "correct": correct,
            "attempts_used": 0,
            "points_awarded": 0,
            "points_remaining_today": 0,
            "first_solver": False,
            "guest": True,
            "word": d.word if correct else None,
            "card_image_url": _card_image_url(d.card) if (correct and d.card) else None,
        })

    points_awarded = 0
    first_solver = False
    cap_reached = False
    within_point_window = False

    with transaction.atomic():
        # Guessing is unlimited — no attempt cap. We just track attempts_used
        # so we can decide whether a correct answer still earns points.
        g, _created = SoloDrawingGuess.objects.select_for_update().get_or_create(
            drawing=d, guesser=user,
        )
        if g.solved:
            return Response({"error": "이미 맞힌 그림이에요."}, status=400)
        if g.gave_up:
            return Response({"error": "이미 포기한 그림이에요."}, status=400)

        g.attempts_used = g.attempts_used + 1
        # Points are earned only when the solve lands within the first N
        # attempts; a later solve still counts as solved, just for 0pt.
        within_point_window = g.attempts_used <= SOLO_POINT_ATTEMPT_LIMIT

        if correct:
            d_locked = SoloDrawing.objects.select_for_update().get(pk=d.pk)
            first_solver = (d_locked.first_solved_at is None)

            # Guesser payout — only if solved within the point window, and
            # bounded by the unified daily cap.
            if within_point_window:
                daily = _get_or_create_daily(user, lock=True)
                base = SOLO_GUESSER_FIRST_POINTS if first_solver else SOLO_GUESSER_NEXT_POINTS
                remaining = max(0, SOLO_DAILY_POINTS_CAP - daily.points_earned)
                points_awarded = min(base, remaining)
                cap_reached = (remaining == 0)
                if points_awarded > 0:
                    award_points(user, points_awarded, kind="game_dm", note=f"솔로 정답 (#{d_locked.id})")
                    daily.points_earned = daily.points_earned + points_awarded
                    daily.save(update_fields=["points_earned"])

            # Drawer payout — first solver 5pt / subsequent 1pt, per-drawing
            # cap 10pt, and the drawer's own unified daily cap.
            drawer_base = SOLO_DRAWER_FIRST_POINTS if first_solver else SOLO_DRAWER_NEXT_POINTS
            drawer_want = min(drawer_base, max(0, SOLO_DRAWER_MAX_POINTS - d_locked.drawer_points_earned))
            if drawer_want > 0:
                drawer_daily = _get_or_create_daily(d_locked.drawer, lock=True)
                drawer_payout = min(drawer_want, max(0, SOLO_DAILY_POINTS_CAP - drawer_daily.points_earned))
                if drawer_payout > 0:
                    award_points(d_locked.drawer, drawer_payout, kind="game_dm",
                                 note=f"솔로 그림 정답 받음 (#{d_locked.id})")
                    d_locked.drawer_points_earned = d_locked.drawer_points_earned + drawer_payout
                    drawer_daily.points_earned = drawer_daily.points_earned + drawer_payout
                    drawer_daily.save(update_fields=["points_earned"])

            if first_solver:
                d_locked.first_solved_at = now
            d_locked.solver_count = d_locked.solver_count + 1
            d_locked.save(update_fields=["drawer_points_earned", "first_solved_at", "solver_count"])

            g.solved = True
            g.solved_at = now
            g.points_earned = g.points_earned + points_awarded

        g.save()

    points_today = (
        SoloDailyPoints.objects.filter(user=user, date=_today())
        .values_list("points_earned", flat=True).first() or 0
    )
    return Response({
        "correct": correct,
        "attempts_used": g.attempts_used,
        "points_awarded": points_awarded,
        "points_remaining_today": max(0, SOLO_DAILY_POINTS_CAP - points_today),
        "daily_points_cap": SOLO_DAILY_POINTS_CAP,
        "first_solver": first_solver and correct,
        "cap_reached": cap_reached,
        # True when a correct answer earned nothing because it came after the
        # point-earning attempt window — lets the client explain the 0pt.
        "solved_without_points": bool(correct and not within_point_window),
        "point_attempt_limit": SOLO_POINT_ATTEMPT_LIMIT,
        "word": d.word if correct else None,
        "card_image_url": _card_image_url(d.card) if (correct and d.card) else None,
    })


# ---------------------------------------------------------------------
# Recommend toggle + hide + report
# ---------------------------------------------------------------------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def give_up(request, drawing_id: int):
    """Permanently mark this drawing as 'given up' for the calling user.
    Once set the answer is revealed (same as solving — sets the gating
    flag in the detail serializer) but no points are paid, and further
    guesses are refused. Cannot be undone."""
    user = request.user
    d = SoloDrawing.objects.filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    if d.drawer_id == user.id:
        return Response({"error": "자신의 그림에는 포기할 수 없습니다."}, status=403)
    with transaction.atomic():
        g, _created = SoloDrawingGuess.objects.select_for_update().get_or_create(
            drawing=d, guesser=user,
        )
        if g.solved:
            return Response({"error": "이미 맞힌 그림이에요."}, status=400)
        if g.gave_up:
            return Response({"error": "이미 포기한 그림이에요."}, status=400)
        g.gave_up = True
        g.gave_up_at = timezone.now()
        g.save()
    return Response({
        "gave_up": True,
        "word": d.word,
        "card_image_url": _card_image_url(d.card) if d.card else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def toggle_recommend(request, drawing_id: int):
    user = request.user
    d = SoloDrawing.objects.filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    if d.drawer_id == user.id:
        return Response({"error": "자신의 그림은 추천할 수 없습니다."}, status=403)
    if d.is_hidden or d.expires_at <= timezone.now():
        return Response({"error": "추천할 수 없는 그림입니다."}, status=410)

    with transaction.atomic():
        d_locked = SoloDrawing.objects.select_for_update().get(pk=d.pk)
        existing = SoloDrawingRecommend.objects.filter(drawing=d_locked, user=user).first()
        if existing:
            existing.delete()
            d_locked.recommend_count = max(0, d_locked.recommend_count - 1)
            d_locked.save(update_fields=["recommend_count"])
            return Response({"recommended": False, "recommend_count": d_locked.recommend_count})
        SoloDrawingRecommend.objects.create(drawing=d_locked, user=user)
        d_locked.recommend_count = d_locked.recommend_count + 1
        d_locked.save(update_fields=["recommend_count"])
        return Response({"recommended": True, "recommend_count": d_locked.recommend_count})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def hide_drawing(request, drawing_id: int):
    """Soft-delete a drawing. The owner can always remove their own; staff
    (운영자) can remove anyone's. Stored as `is_hidden=True` rather than a
    hard row delete so solver records / recommend logs keep referential
    integrity."""
    d = SoloDrawing.objects.filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    is_owner = d.drawer_id == request.user.id
    is_staff = bool(getattr(request.user, "is_staff", False) or getattr(request.user, "is_superuser", False))
    if not (is_owner or is_staff):
        return Response({"error": "본인의 그림만 삭제할 수 있습니다."}, status=403)
    if not d.is_hidden:
        d.is_hidden = True
        d.save(update_fields=["is_hidden"])
    return Response({"is_hidden": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def report_drawing(request, drawing_id: int):
    """Cheating report — currently best-effort logged on the drawing row's
    note channel via a PointTransaction-style audit. For now we just bump a
    server log; a proper review queue can come later."""
    d = SoloDrawing.objects.filter(id=drawing_id).first()
    if not d:
        return Response({"error": "그림을 찾을 수 없습니다."}, status=404)
    if d.drawer_id == request.user.id:
        return Response({"error": "자신의 그림은 신고할 수 없습니다."}, status=403)
    reason = (request.data.get("reason") or "").strip()[:200]
    import logging
    logging.getLogger("solo.report").warning(
        "Solo drawing %d reported by user %s: %s",
        d.id, request.user.id, reason or "(no reason)"
    )
    return Response({"ok": True})


# ---------------------------------------------------------------------
# My status (daily quota)
# ---------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_status(request):
    user = request.user
    today = _today()
    row = SoloDailyPoints.objects.filter(user=user, date=today).first()
    drawings_created = row.drawings_created if row else 0
    points_today = row.points_earned if row else 0

    # Quick "my recent drawings" for the my-page widget.
    my_recent = (
        SoloDrawing.objects.select_related("card")
        .filter(drawer=user)
        .order_by("-created_at")[:10]
    )

    return Response({
        "drawings_created_today": drawings_created,
        "points_earned_today": points_today,
        "daily_points_cap": SOLO_DAILY_POINTS_CAP,
        "points_remaining_today": max(0, SOLO_DAILY_POINTS_CAP - points_today),
        "draw_seconds": SOLO_DRAW_SECONDS,
        "point_attempt_limit": SOLO_POINT_ATTEMPT_LIMIT,
        "lifespan_days": SOLO_DRAWING_LIFESPAN_DAYS,
        "my_recent": [
            {
                "id": d.id,
                "word": d.word,
                "is_hidden": d.is_hidden,
                "created_at": d.created_at.isoformat(),
                "expires_at": d.expires_at.isoformat(),
                "solver_count": d.solver_count,
                "recommend_count": d.recommend_count,
            }
            for d in my_recent
        ],
    })
