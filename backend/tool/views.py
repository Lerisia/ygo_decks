from django.db.models import Count, Q, F, FloatField, ExpressionWrapper
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from .models import RecordGroup, MatchRecord
from deck.models import Deck
from django.core.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from datetime import timedelta, datetime
from django.utils import timezone
from django.utils.timezone import make_aware

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_record_group(request):
    user = request.user
    name = request.data.get("name")

    if not name:
        return Response({"error": "이름을 입력해야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    record_group = RecordGroup.objects.create(user=user, name=name)
    return Response({"record_group_id": record_group.id, "name": record_group.name}, status=status.HTTP_201_CREATED)

@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_record_group_name(request, record_group_id):
    user = request.user
    name = request.data.get("name")

    if not name:
        return Response({"error": "이름을 입력해야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        record_group = RecordGroup.objects.get(id=record_group_id, user=user)
    except RecordGroup.DoesNotExist:
        return Response({"error": "기록 그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    record_group.name = name
    record_group.save()

    return Response({"record_group_id": record_group.id, "name": record_group.name}, status=status.HTTP_200_OK)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_user_record_groups(request):
    user = request.user
    record_groups = RecordGroup.objects.filter(user=user, is_deleted=False).values(
        "id", "name", "created_at"
    ).order_by("-created_at")

    return Response(list(record_groups))

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_match_to_record_group(request, record_group_id):
    user = request.user
    record_group = RecordGroup.objects.filter(id=record_group_id, user=user).first()

    if not record_group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    data = request.data

    opponent_deck = data.get("opponent_deck")
    if opponent_deck == "null" or opponent_deck == "" or opponent_deck is None:
        opponent_deck = None
        
    match = MatchRecord(
        record_group=record_group,
        deck_id=data.get("deck"),
        opponent_deck_id=data.get("opponent_deck"),
        first_or_second=data.get("first_or_second"),
        result=data.get("result"),
        notes=data.get("notes"),
        coin_toss_result=data.get("coin_toss_result"),
        rank=data.get("rank"),
        wins=data.get("wins"),
        score=data.get("score"),
    )
    # Check it has only 1 field between rank and score
    try:
        match.full_clean()
        match.save()
    except ValidationError as e:
        return Response({"error": e.message_dict}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"match_id": match.id}, status=status.HTTP_201_CREATED)

@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_record_group(request, record_group_id):
    user = request.user
    record_group = RecordGroup.objects.filter(id=record_group_id, user=user).first()

    if not record_group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    record_group.is_deleted = True
    record_group.save()
    record_group.matches.update(is_deleted=True)

    return Response(status=status.HTTP_204_NO_CONTENT)

@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_match_record(request, match_id):
    user = request.user
    match = MatchRecord.objects.filter(id=match_id, record_group__user=user, is_deleted=False).first()

    if not match:
        return Response({"error": "게임 기록을 찾을 수 없습니다."}, status=404)

    updatable_fields = [
        "deck", "opponent_deck", "first_or_second", "coin_toss_result",
        "result", "rank", "wins", "score", "notes"
    ]
    
    for field in updatable_fields:
        if field in request.data:
            setattr(match, field, request.data[field])

    try:
        match.full_clean()
    except ValidationError as e:
        return Response({"error": e.message_dict}, status=400)

    match.save()
    return Response({"message": "수정되었습니다."})

@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_match_record(request, match_id):
    user = request.user
    match = MatchRecord.objects.filter(id=match_id, record_group__user=user).first()

    if not match:
        return Response({"error": "게임 기록을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    match.is_deleted = True
    match.save()

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_record_group_statistics(request, record_group_id):
    user = request.user
    record_group = RecordGroup.objects.filter(id=record_group_id, user=user).first()

    if not record_group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    matches = record_group.matches.filter(is_deleted=False)

    total_games = matches.count()
    total_wins = matches.filter(result="win").count()
    first_games = matches.filter(first_or_second="first")
    second_games = matches.filter(first_or_second="second")

    first_win_rate = (
        first_games.filter(result="win").count() / first_games.count() * 100
        if first_games.count() > 0 else 0
    )
    second_win_rate = (
        second_games.filter(result="win").count() / second_games.count() * 100
        if second_games.count() > 0 else 0
    )
    first_ratio = first_games.count() / total_games * 100 if total_games > 0 else 0
    overall_win_rate = total_wins / total_games * 100 if total_games > 0 else 0

    return Response({
        "group_name": record_group.name,
        "total_games": total_games,
        "overall_win_rate": overall_win_rate,
        "first_win_rate": first_win_rate,
        "second_win_rate": second_win_rate,
        "first_ratio": first_ratio,
    })

from .serializers import DeckShortSerializer

@api_view(['GET'])
def get_record_group_statistics_full(request, record_group_id):
    record_group = RecordGroup.objects.filter(id=record_group_id).first()

    if not record_group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    matches = record_group.matches.filter(is_deleted=False)

    # ----------------------
    # 1) Basic statistics
    # ----------------------
    total_games = matches.count()
    total_wins = matches.filter(result="win").count()
    overall_win_rate = (total_wins / total_games * 100) if total_games > 0 else 0

    first_games = matches.filter(first_or_second="first")
    second_games = matches.filter(first_or_second="second")

    first_win_count = first_games.filter(result="win").count()
    first_win_rate = (first_win_count / first_games.count() * 100) if first_games.count() > 0 else 0

    second_win_count = second_games.filter(result="win").count()
    second_win_rate = (second_win_count / second_games.count() * 100) if second_games.count() > 0 else 0

    first_ratio = (first_games.count() / total_games * 100) if total_games > 0 else 0

    coin_toss_win_matches = matches.filter(coin_toss_result="win")
    coin_toss_lose_matches = matches.filter(coin_toss_result="lose")

    coin_toss_win_count = coin_toss_win_matches.count()
    coin_toss_lose_count = coin_toss_lose_matches.count()
    coin_toss_win_rate = (coin_toss_win_count / total_games * 100) if total_games > 0 else 0

    coin_toss_win_and_match_win = coin_toss_win_matches.filter(result="win").count()
    coin_toss_win_win_rate = (coin_toss_win_and_match_win / coin_toss_win_count * 100) if coin_toss_win_count > 0 else 0

    coin_toss_lose_and_match_win = coin_toss_lose_matches.filter(result="win").count()
    coin_toss_lose_win_rate = (coin_toss_lose_and_match_win / coin_toss_lose_count * 100) if coin_toss_lose_count > 0 else 0

    # ----------------------
    # 2) Statistics by my decks
    # ----------------------
    my_deck_ids = matches.values_list('deck_id', flat=True).distinct()

    my_deck_stats = []
    for deck_id in my_deck_ids:
        deck_count = matches.filter(deck_id=deck_id).count()
        deck_ratio = deck_count / total_games * 100 if total_games > 0 else 0
        deck = Deck.objects.get(id=deck_id)
        deck_matches = matches.filter(deck_id=deck_id)
        deck_total = deck_matches.count()
        deck_win_count = deck_matches.filter(result="win").count()
        deck_win_rate = (deck_win_count / deck_total * 100) if deck_total > 0 else 0

        deck_first = deck_matches.filter(first_or_second="first")
        deck_second = deck_matches.filter(first_or_second="second")
        deck_first_win = deck_first.filter(result="win").count()
        deck_second_win = deck_second.filter(result="win").count()
        deck_first_win_rate = (deck_first_win / deck_first.count() * 100) if deck_first.count() > 0 else 0
        deck_second_win_rate = (deck_second_win / deck_second.count() * 100) if deck_second.count() > 0 else 0

        deck_coin_toss_win = deck_matches.filter(coin_toss_result="win")
        deck_coin_toss_lose = deck_matches.filter(coin_toss_result="lose")
        deck_coin_toss_win_and_match_win = deck_coin_toss_win.filter(result="win").count()
        deck_coin_toss_lose_and_match_win = deck_coin_toss_lose.filter(result="win").count()
        deck_coin_toss_win_rate = (
            deck_coin_toss_win_and_match_win / deck_coin_toss_win.count() * 100
            if deck_coin_toss_win.count() > 0 else 0
        )
        deck_coin_toss_lose_win_rate = (
            deck_coin_toss_lose_and_match_win / deck_coin_toss_lose.count() * 100
            if deck_coin_toss_lose.count() > 0 else 0
        )

        my_deck_stats.append({
            "deck": DeckShortSerializer(deck).data,
            "count": deck_count,
            "ratio": deck_ratio,
            "total_games": deck_total,
            "win_rate": deck_win_rate,
            "first_win_rate": deck_first_win_rate,
            "second_win_rate": deck_second_win_rate,
            "coin_toss_win_win_rate": deck_coin_toss_win_rate,
            "coin_toss_lose_win_rate": deck_coin_toss_lose_win_rate,
        })

    # ----------------------
    # 3) Statistics by opponents' decks
    # ----------------------
    opponent_deck_ids = matches.values_list('opponent_deck_id', flat=True).distinct()

    opponent_deck_stats = []
    for opp_deck_id in opponent_deck_ids:
        try:
            opp_deck = Deck.objects.get(id=opp_deck_id)
        except Deck.DoesNotExist:
            opp_deck = None
        opp_count = matches.filter(opponent_deck_id=opp_deck_id).count()
        opp_ratio = opp_count / total_games * 100 if total_games > 0 else 0
        opp_matches = matches.filter(opponent_deck_id=opp_deck_id)
        opp_total = opp_matches.count()
        opp_win_count = opp_matches.filter(result="win").count()
        opp_win_rate = (opp_win_count / opp_total * 100) if opp_total > 0 else 0

        opp_first = opp_matches.filter(first_or_second="first")
        opp_second = opp_matches.filter(first_or_second="second")
        opp_first_win = opp_first.filter(result="win").count()
        opp_first_ratio = opp_first.count() / opp_total * 100 if opp_total > 0 else 0
        opp_first_win_rate = (opp_first_win / opp_first.count() * 100) if opp_first.count() > 0 else None
        opp_second_win = opp_second.filter(result="win").count()
        opp_second_win_rate = (opp_second_win / opp_second.count() * 100) if opp_second.count() > 0 else None

        opp_coin_toss_win = opp_matches.filter(coin_toss_result="win")
        opp_coin_toss_lose = opp_matches.filter(coin_toss_result="lose")
        opp_coin_toss_win_and_match_win = opp_coin_toss_win.filter(result="win").count()
        opp_coin_toss_lose_and_match_win = opp_coin_toss_lose.filter(result="win").count()
        opp_coin_toss_win_rate = (
            opp_coin_toss_win_and_match_win / opp_coin_toss_win.count() * 100
            if opp_coin_toss_win.count() > 0 else 0
        )
        opp_coin_toss_lose_win_rate = (
            opp_coin_toss_lose_and_match_win / opp_coin_toss_lose.count() * 100
            if opp_coin_toss_lose.count() > 0 else 0
        )

        opponent_deck_stats.append({
            "deck": DeckShortSerializer(opp_deck).data,
            "count": opp_count,
            "ratio": opp_ratio,
            "total_games": opp_total,
            "win_rate": opp_win_rate,
            "first_ratio": opp_first_ratio,
            "first_win_rate": opp_first_win_rate,
            "second_win_rate": opp_second_win_rate,
            "coin_toss_win_win_rate": opp_coin_toss_win_rate,
            "coin_toss_lose_win_rate": opp_coin_toss_lose_win_rate,
        })

    # ----------------------
    # 4) My deck x opponents' deck statistics
    # ----------------------
    deck_pairs = matches.values_list('deck_id', 'opponent_deck_id').distinct()

    deck_vs_deck_stats = []
    for (d_id, o_id) in deck_pairs:
        pair_matches = matches.filter(deck_id=d_id, opponent_deck_id=o_id)
        pair_total = pair_matches.count()
        pair_win_count = pair_matches.filter(result="win").count()
        pair_win_rate = (pair_win_count / pair_total * 100) if pair_total > 0 else 0

        pair_first = pair_matches.filter(first_or_second="first")
        pair_second = pair_matches.filter(first_or_second="second")
        pair_first_win = pair_first.filter(result="win").count()
        pair_second_win = pair_second.filter(result="win").count()
        pair_first_win_rate = (pair_first_win / pair_first.count() * 100) if pair_first.count() > 0 else 0
        pair_second_win_rate = (pair_second_win / pair_second.count() * 100) if pair_second.count() > 0 else 0

        pair_coin_win = pair_matches.filter(coin_toss_result="win")
        pair_coin_lose = pair_matches.filter(coin_toss_result="lose")
        pair_coin_win_and_match_win = pair_coin_win.filter(result="win").count()
        pair_coin_lose_and_match_win = pair_coin_lose.filter(result="win").count()
        pair_coin_win_win_rate = (pair_coin_win_and_match_win / pair_coin_win.count() * 100) if pair_coin_win.count() else 0
        pair_coin_lose_win_rate = (pair_coin_lose_and_match_win / pair_coin_lose.count() * 100) if pair_coin_lose.count() else 0

        deck_vs_deck_stats.append({
            "deck_id": d_id,
            "opponent_deck_id": o_id,
            "total_games": pair_total,
            "win_rate": pair_win_rate,
            "first_win_rate": pair_first_win_rate,
            "second_win_rate": pair_second_win_rate,
            "coin_toss_win_win_rate": pair_coin_win_win_rate,
            "coin_toss_lose_win_rate": pair_coin_lose_win_rate,
        })

    # ----------------------
    # Overall
    # ----------------------
    data = {
        "basic": {
            "total_games": total_games,
            "overall_win_rate": overall_win_rate,
            "first_win_rate": first_win_rate,
            "second_win_rate": second_win_rate,
            "first_ratio": first_ratio,
            "coin_toss_win_rate": coin_toss_win_rate,
            "coin_toss_win_win_rate": coin_toss_win_win_rate,
            "coin_toss_lose_win_rate": coin_toss_lose_win_rate,
        },
        "my_deck_stats": my_deck_stats,
        "opponent_deck_stats": opponent_deck_stats,
        "deck_vs_deck_stats": deck_vs_deck_stats,
    }

    return Response(data, status=status.HTTP_200_OK)
    
from django.core.paginator import Paginator

@api_view(["GET"])
def get_record_group_matches(request, record_group_id):
    record_group = RecordGroup.objects.filter(id=record_group_id).first()
    if not record_group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=404)
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 10)) 
    deck_filter = request.GET.get("deck")

    query = Q(record_group_id=record_group_id) & Q(is_deleted=False)
    
    if deck_filter:
        query &= Q(deck_id=deck_filter)

    matches = MatchRecord.objects.filter(query).select_related("deck", "opponent_deck").order_by("-id")
    paginator = Paginator(matches, page_size)

    try:
        current_page = paginator.page(page)
    except:
        return Response({"matches": [], "total_pages": paginator.num_pages})

    data = [
        {
            "id": match.id,
            "deck": {
                "id": match.deck.id,
                "name": match.deck.name,
                "cover_image_small": (
                    match.deck.cover_image_small.url 
                    if match.deck.cover_image_small 
                    else None
                ),
            },
            "opponent_deck": (
                {
                    "id": match.opponent_deck.id,
                    "name": match.opponent_deck.name,
                    "cover_image_small": (
                        match.opponent_deck.cover_image_small.url 
                        if match.opponent_deck.cover_image_small 
                        else None
                    ),
                }
                if match.opponent_deck else None
            ),
            "first_or_second": match.first_or_second,
            "coin_toss_result": match.coin_toss_result,
            "result": match.result,
            "rank": match.rank,
            "wins": match.wins,
            "score": match.score,
            "notes": match.notes,
        }
        for match in current_page
    ]

    return Response({"matches": data, "total_pages": paginator.num_pages, "record_group_name": record_group.name})

RANK_RANGE = [
    "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
    "master5", "master4", "master3", "master2"
]

@api_view(["GET"])
def recent_meta_deck_stats(request):
    reset_time = make_aware(datetime(2025, 6, 4, 15, 0, 0))
    one_week_ago = timezone.now() - timedelta(days=7)
    time_threshold = max(reset_time, one_week_ago)  # 둘 중 더 최근 시각

    qs = MatchRecord.objects.filter(
        ~Q(opponent_deck__name=""),
        opponent_deck__isnull=False,
        opponent_deck__name__isnull=False,
        created_at__gte=time_threshold,
        rank__in=RANK_RANGE,
        is_deleted=False,
    )

    total_matches = qs.count()

    qs = qs.annotate(
        meta_deck_id=F("opponent_deck_id"),
        meta_deck_name=F("opponent_deck__name")
    )

    deck_stats = qs.values(
        "meta_deck_id", "meta_deck_name"
    ).annotate(
        count=Count("id"),
        wins=Count("id", filter=Q(result="lose"))
    )

    results = []
    for stat in deck_stats:
        percent = stat["count"] / total_matches * 100 if total_matches > 0 else 0
        win_rate = stat["wins"] / stat["count"] * 100 if stat["count"] > 0 else 0
        results.append({
            "meta_deck_id": stat["meta_deck_id"],
            "meta_deck_name": stat["meta_deck_name"],
            "appearance_percent": round(percent, 1),
            "win_rate": round(win_rate, 1),
        })

    results = sorted(results, key=lambda x: x["appearance_percent"], reverse=True)[:10]

    return Response({
        "total_matches": total_matches,
        "meta_decks": results
    }, status=status.HTTP_200_OK)

