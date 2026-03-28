import os
import random

from django.conf import settings
from PIL import Image
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Card, QuizHighScore

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

    best = QuizHighScore.objects.filter(user=request.user).first()
    is_new_record = not best or score > best.score

    if is_new_record:
        if best:
            best.score = score
            best.streak = streak
            best.save()
        else:
            QuizHighScore.objects.create(user=request.user, score=score, streak=streak)

    return Response({
        "is_new_record": is_new_record,
        "score": score,
        "streak": streak,
    })


@api_view(["GET"])
def quiz_leaderboard(request):
    top_records = (
        QuizHighScore.objects
        .select_related("user")
        .order_by("-score")[:10]
    )

    leaderboard = [
        {"username": r.user.username, "score": r.score, "streak": r.streak}
        for r in top_records
    ]

    return Response({"leaderboard": leaderboard})
