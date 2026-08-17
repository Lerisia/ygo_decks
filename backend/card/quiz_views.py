import os
import random
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.utils import timezone
from PIL import Image
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Card, QuizAllTimeBest, QuizHighScore


# Cutover from monthly to weekly leaderboard cadence. Anything strictly
# before this KST moment uses the old monthly window; from this moment on,
# the leaderboard window is the current Mon-Sun KST week and submit_score
# resets QuizHighScore on a weekly (not monthly) boundary.
WEEKLY_CUTOVER_KST = datetime(2026, 6, 1, 0, 0, 0)


def _kst_now() -> datetime:
    """Naive KST datetime — Django stores UTC; localtime applies TIME_ZONE."""
    return timezone.localtime(timezone.now()).replace(tzinfo=None)


def _week_start_date(dt: datetime) -> date:
    """Monday (KST) of the week containing dt."""
    d = dt.date()
    return d - timedelta(days=d.weekday())


def _is_weekly_active(now_kst: datetime) -> bool:
    return now_kst >= WEEKLY_CUTOVER_KST

SIZES = [8, 10, 12, 16]
UPSCALE_MAP = {8: 160, 10: 160, 12: 168, 16: 160}
SCORE_MAP = {8: 4, 10: 3, 12: 2, 16: 1}


def _build_image_urls(request, card):
    original_path = card.card_illust.path
    urls = {}

    for size in SIZES:
        output_dir = os.path.join(settings.MEDIA_ROOT, f"quiz_thumbnails/{size}x{size}_shown")
        os.makedirs(output_dir, exist_ok=True)
        output_filename = f"{card.card_id}_{size}x{size}.jpg"
        output_path = os.path.join(output_dir, output_filename)

        if not os.path.exists(output_path):
            img = Image.open(original_path).convert("RGB")
            img = img.resize((size, size), Image.NEAREST)
            img = img.resize((UPSCALE_MAP[size], UPSCALE_MAP[size]), Image.NEAREST)
            img.save(output_path)

        urls[f"{size}x{size}"] = f"{settings.MEDIA_URL}quiz_thumbnails/{size}x{size}_shown/{output_filename}"
    urls["original"] = card.card_illust.url
    return urls


@api_view(["GET"])
def quiz_next_card(request):
    valid_cards = Card.objects.filter(
        korean_name__isnull=False,
        card_illust__isnull=False,
    ).exclude(card_illust="")
    unique_names = list(valid_cards.values_list("korean_name", flat=True).distinct())
    chosen_name = random.choice(unique_names)
    card = valid_cards.filter(korean_name=chosen_name).first()
    if not card:
        return Response({"error": "유효한 카드가 없습니다."}, status=404)

    wrong_cards = list(
        valid_cards.exclude(korean_name=card.korean_name).order_by("?").values_list("korean_name", flat=True).distinct()[:3]
    )
    choices = [card.korean_name] + wrong_cards
    random.shuffle(choices)

    return Response({
        "card_id": card.card_id,
        "images": _build_image_urls(request, card),
        "choices": choices,
        "score_map": SCORE_MAP,
    })


@api_view(["POST"])
def quiz_check_answer(request):
    card_id = request.data.get("card_id")
    answer = request.data.get("answer")

    if not card_id or not answer:
        return Response({"error": "card_id와 answer가 필요합니다."}, status=400)

    try:
        card = Card.objects.get(card_id=card_id)
    except Card.DoesNotExist:
        return Response({"error": "카드를 찾을 수 없습니다."}, status=404)

    correct = card.korean_name == answer
    return Response({
        "correct": correct,
        "correct_answer": card.korean_name,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quiz_submit_score(request):
    score = request.data.get("score")
    streak = request.data.get("streak")

    if score is None or streak is None:
        return Response({"error": "score와 streak이 필요합니다."}, status=400)

    now = timezone.now()
    now_kst = _kst_now()
    weekly = _is_weekly_active(now_kst)
    best = QuizHighScore.objects.filter(user=request.user).first()

    if best:
        best_kst = timezone.localtime(best.created_at).replace(tzinfo=None)
        if weekly:
            same_period = _week_start_date(best_kst) == _week_start_date(now_kst)
        else:
            same_period = (
                best_kst.year == now_kst.year and best_kst.month == now_kst.month
            )
        if same_period:
            is_new_record = score > best.score
            if is_new_record:
                best.score = score
                best.streak = streak
        else:
            is_new_record = True
            best.score = score
            best.streak = streak
        best.created_at = now
        best.save()
    else:
        is_new_record = True
        QuizHighScore.objects.create(user=request.user, score=score, streak=streak)

    # All-time best — display only, never resets. Update strictly on improve.
    all_time, created = QuizAllTimeBest.objects.get_or_create(
        user=request.user,
        defaults={"score": score, "streak": streak, "achieved_at": now},
    )
    if not created and score > all_time.score:
        all_time.score = score
        all_time.streak = streak
        all_time.achieved_at = now
        all_time.save(update_fields=["score", "streak", "achieved_at"])

    return Response({
        "is_new_record": is_new_record,
        "score": score,
        "streak": streak,
        "all_time_best": all_time.score,
    })


@api_view(["GET"])
def quiz_leaderboard(request):
    from avatar.serializers import CardIconSerializer, BorderSerializer
    from avatar.views import _resolve_default_icon, _resolve_default_border

    now_kst = _kst_now()
    weekly = _is_weekly_active(now_kst)

    if weekly:
        week_start = _week_start_date(now_kst)
        window_start_kst = datetime.combine(week_start, time.min)
        period = f"{week_start.isoformat()} 주"
        cadence = "weekly"
    else:
        window_start_kst = now_kst.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period = f"{now_kst.year}.{now_kst.month:02d}"
        cadence = "monthly"

    # Convert the naive KST window boundary back to an aware datetime so the
    # ORM filter compares correctly against UTC-stored created_at values.
    window_start = timezone.make_aware(window_start_kst, timezone.get_current_timezone())

    qs = QuizHighScore.objects.select_related(
        "user", "user__avatar_icon", "user__avatar_icon__card", "user__equipped_border"
    ).filter(created_at__gte=window_start)

    top_records = qs.order_by("-score")[:10]

    default_icon = _resolve_default_icon()
    default_border = _resolve_default_border()
    default_icon_data = CardIconSerializer(default_icon).data if default_icon else None
    default_border_data = BorderSerializer(default_border).data if default_border else None

    leaderboard = []
    for r in top_records:
        icon = r.user.avatar_icon
        border = r.user.equipped_border
        leaderboard.append({
            "username": r.user.username,
            "score": r.score,
            "streak": r.streak,
            "avatar_icon": CardIconSerializer(icon).data if icon else default_icon_data,
            "border": BorderSerializer(border).data if border else default_border_data,
        })

    viewer_all_time = None
    if request.user.is_authenticated:
        atb = QuizAllTimeBest.objects.filter(user=request.user).first()
        if atb:
            viewer_all_time = {"score": atb.score, "streak": atb.streak}

    return Response({
        "leaderboard": leaderboard,
        "period": period,
        "cadence": cadence,
        "viewer_all_time_best": viewer_all_time,
    })
