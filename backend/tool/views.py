from django.db.models import Count, Q, F, FloatField, ExpressionWrapper
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from .models import RecordGroup, RecordGroupMember, MatchRecord, SiteConfig
from .permissions import allows, role_of, user_brief
from user.models import User
from deck.models import Deck
from django.core.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from datetime import timedelta, datetime
from django.utils import timezone
from django.utils.timezone import make_aware


def _get_accessible_group(request, record_group_id, need="view"):
    """Fetch a sheet the caller may `view`, `write` to, or `manage`; sets `group.viewer_role`."""
    group = RecordGroup.objects.filter(id=record_group_id, is_deleted=False).first()
    if not group:
        return None, Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    role = role_of(request.user, group)
    if not allows(role, need):
        # managing someone else's sheet answers 404 (as it always has); reading/writing answers 403
        if need == "manage":
            return None, Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        return None, Response({"error": "접근 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
    group.viewer_role = role
    return group, None


def _may_edit_match(user, match):
    """Your own records, plus anything inside a sheet you own."""
    return match.recorded_by_id == user.id or match.record_group.user_id == user.id


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_record_group(request):
    user = request.user
    name = request.data.get("name")

    if not name:
        return Response({"error": "이름을 입력해야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    kind = "shared" if request.data.get("kind") == "shared" else "solo"
    record_group = RecordGroup.objects.create(user=user, name=name, kind=kind)
    return Response({"id": record_group.id, "record_group_id": record_group.id, "name": record_group.name,
                     "kind": record_group.kind}, status=status.HTTP_201_CREATED)

@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_record_group_name(request, record_group_id):
    user = request.user
    name = request.data.get("name")

    if not name:
        return Response({"error": "이름을 입력해야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    record_group, err = _get_accessible_group(request, record_group_id, need="manage")
    if err:
        return err

    record_group.name = name
    record_group.save()

    return Response({"record_group_id": record_group.id, "name": record_group.name}, status=status.HTTP_200_OK)

@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_record_group_visibility(request, record_group_id):
    group, err = _get_accessible_group(request, record_group_id, need="manage")
    if err:
        return err

    is_public = request.data.get("is_public")
    if is_public is not None:
        group.is_public = is_public
        group.save(update_fields=["is_public"])

    return Response({"is_public": group.is_public})

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_user_record_groups(request):
    user = request.user
    groups = (RecordGroup.objects.filter(user=user, is_deleted=False) | RecordGroup.objects.filter(members__user=user, is_deleted=False))
    groups = groups.distinct().select_related("user").prefetch_related("members").order_by("-created_at")

    out = []
    for g in groups:
        mine = g.user_id == user.id
        out.append({
            "id": g.id,
            "name": g.name,
            "created_at": g.created_at,
            "kind": g.kind,
            "role": "owner" if mine else next((m.role for m in g.members.all() if m.user_id == user.id), "viewer"),
            "member_count": len(g.members.all()) + 1,
            "owner": None if mine else user_brief(g.user),
        })
    return Response(out)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_match_to_record_group(request, record_group_id):
    user = request.user
    record_group, err = _get_accessible_group(request, record_group_id, need="write")
    if err:
        return err

    data = request.data

    opponent_deck = data.get("opponent_deck")
    if opponent_deck == "null" or opponent_deck == "" or opponent_deck is None:
        opponent_deck = None
        
    match = MatchRecord(
        record_group=record_group,
        recorded_by=user,
        deck_id=data.get("deck"),
        opponent_deck_id=opponent_deck,
        opponent_deck_name=data.get("opponent_deck_name") or None,
        first_or_second=data.get("first_or_second"),
        result=data.get("result"),
        notes=data.get("notes"),
        coin_toss_result=data.get("coin_toss_result"),
        rank=data.get("rank"),
        wins=data.get("wins"),
        score=data.get("score"),
        score_type=data.get("score_type") or None,
    )
    # Check it has only 1 field between rank and score
    try:
        match.full_clean()
        match.save()
    except ValidationError as e:
        return Response({"error": e.message_dict}, status=status.HTTP_400_BAD_REQUEST)

    points_added = 0
    if data.get("tracker_pending_id"):
        from tracker.services import consume_pending
        pending = consume_pending(user, data.get("tracker_pending_id"), match)
        points_added = getattr(pending, "points_added", 0) or 0
    elif data.get("tracker_did"):
        from tracker.services import link_game
        points_added = link_game(user, data.get("tracker_did"), match)

    return Response({"match_id": match.id, "points_added": points_added}, status=status.HTTP_201_CREATED)

@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_record_group(request, record_group_id):
    record_group, err = _get_accessible_group(request, record_group_id, need="manage")
    if err:
        return err

    record_group.is_deleted = True
    record_group.save()
    record_group.matches.update(is_deleted=True)

    return Response(status=status.HTTP_204_NO_CONTENT)

@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_match_record(request, match_id):
    user = request.user
    match = MatchRecord.objects.filter(id=match_id, is_deleted=False).select_related("record_group").first()

    if not match or not _may_edit_match(user, match):
        return Response({"error": "게임 기록을 찾을 수 없습니다."}, status=404)

    updatable_fields = [
        "deck", "opponent_deck", "opponent_deck_name", "first_or_second",
        "coin_toss_result", "result", "rank", "wins", "score", "score_type", "notes"
    ]
    
    fk_fields = {"deck", "opponent_deck"}
    for field in updatable_fields:
        if field in request.data:
            value = request.data[field]
            if field in fk_fields:
                if value in (None, "", "null"):
                    setattr(match, f"{field}_id", None)
                else:
                    setattr(match, f"{field}_id", int(value))
            else:
                setattr(match, field, value)

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
    match = MatchRecord.objects.filter(id=match_id).select_related("record_group").first()

    if not match or not _may_edit_match(user, match):
        return Response({"error": "게임 기록을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    match.is_deleted = True
    match.save()

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def get_record_group_statistics(request, record_group_id):
    record_group, err = _get_accessible_group(request, record_group_id)
    if err:
        return err

    matches = record_group.matches.filter(is_deleted=False)
    _member = request.GET.get("member")
    if _member and _member.isdigit():
        matches = matches.filter(recorded_by_id=int(_member))

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
from .statistics import compute_full_statistics

@api_view(['GET'])
def get_record_group_statistics_full(request, record_group_id):
    record_group, err = _get_accessible_group(request, record_group_id)
    if err:
        return err

    matches = record_group.matches.filter(is_deleted=False)
    _member = request.GET.get("member")
    if _member and _member.isdigit():
        matches = matches.filter(recorded_by_id=int(_member))

    deck_id = request.GET.get("deck_id")
    if deck_id:
        matches = matches.filter(deck_id=deck_id)

    data = {"record_group_name": record_group.name}
    data.update(compute_full_statistics(matches))
    return Response(data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_user_statistics_full(request):
    """All of the caller's (non-deleted) sheets merged. Optional `group_ids`
    (comma-separated) narrows to specific own sheets; `deck_id` as per-sheet."""
    groups = (RecordGroup.objects.filter(user=request.user, is_deleted=False)
              | RecordGroup.objects.filter(members__user=request.user, is_deleted=False)).distinct()

    raw_ids = request.GET.get("group_ids")
    if raw_ids:
        try:
            wanted = [int(x) for x in raw_ids.split(",") if x.strip()]
        except ValueError:
            return Response({"error": "group_ids must be comma-separated integers"}, status=status.HTTP_400_BAD_REQUEST)
        groups = groups.filter(id__in=wanted)

    group_list = list(groups.order_by("-created_at").values("id", "name"))

    # Counted by author, not by membership: games you recorded stay yours even after
    # you leave the group sheet you recorded them in.
    matches = MatchRecord.objects.filter(
        is_deleted=False, recorded_by=request.user, record_group__is_deleted=False)
    if raw_ids:
        matches = matches.filter(record_group_id__in=wanted)
    deck_id = request.GET.get("deck_id")
    if deck_id:
        matches = matches.filter(deck_id=deck_id)

    data = {"record_groups": group_list, "group_count": len(group_list)}
    data.update(compute_full_statistics(matches))
    return Response(data, status=status.HTTP_200_OK)

from django.core.paginator import Paginator

@api_view(["GET"])
def get_record_group_matches(request, record_group_id):
    record_group, err = _get_accessible_group(request, record_group_id)
    if err:
        return err
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 10)) 
    deck_filter = request.GET.get("deck")

    query = Q(record_group_id=record_group_id) & Q(is_deleted=False)
    
    if deck_filter:
        query &= Q(deck_id=deck_filter)

    member = request.GET.get("member")
    if member and member.isdigit():
        query &= Q(recorded_by_id=int(member))

    matches = MatchRecord.objects.filter(query).select_related(
        "deck", "opponent_deck", "recorded_by", "recorded_by__avatar_icon", "recorded_by__equipped_border"
    ).order_by("-id")
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
            "score_type": match.score_type,
            "notes": match.notes,
            "opponent_deck_name": match.opponent_deck_name,
            "recorded_by": user_brief(match.recorded_by),
        }
        for match in current_page
    ]

    return Response({
        "matches": data,
        "total_pages": paginator.num_pages,
        "record_group_name": record_group.name,
        "is_public": record_group.is_public,
        "is_owner": request.user.is_authenticated and record_group.user == request.user,
        "kind": record_group.kind,
        "my_role": getattr(record_group, "viewer_role", None),
        "can_write": allows(getattr(record_group, "viewer_role", None), "write"),
    })

RANK_RANGE = [
    "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
    "master5", "master4", "master3", "master2"
]

@api_view(["GET"])
def recent_meta_deck_stats(request):
    reset_str = SiteConfig.get("meta_stats_reset_time", "2025-12-05T16:50:00")
    reset_time = make_aware(datetime.fromisoformat(reset_str))
    one_week_ago = timezone.now() - timedelta(days=7)
    time_threshold = max(reset_time, one_week_ago)  # 둘 중 더 최근 시각

    qs = MatchRecord.objects.filter(
        ~Q(opponent_deck__name=""),
        opponent_deck__isnull=False,
        opponent_deck__name__isnull=False,
        created_at__gte=time_threshold,
        is_deleted=False,
    ).filter(
        Q(rank__in=RANK_RANGE) | Q(score_type__in=["rating", "duelist_cup"])
    )

    total_matches = qs.count()

    opp_stats = qs.values(
        "opponent_deck_id", "opponent_deck__name",
    ).annotate(
        count=Count("id"),
        wins=Count("id", filter=Q(result="lose")),
    )

    results = []
    for stat in opp_stats:
        count = stat["count"]
        wins = stat["wins"]
        percent = count / total_matches * 100 if total_matches > 0 else 0
        win_rate = wins / count * 100 if count > 0 else 0
        results.append({
            "meta_deck_id": stat["opponent_deck_id"],
            "meta_deck_name": stat["opponent_deck__name"],
            "appearance_percent": round(percent, 1),
            "win_rate": round(win_rate, 1),
        })

    results = sorted(results, key=lambda x: x["appearance_percent"], reverse=True)[:10]

    return Response({
        "total_matches": total_matches,
        "meta_decks": results,
    }, status=status.HTTP_200_OK)

@api_view(["GET"])
def get_record_group_rank_history(request, record_group_id):
    record_group, err = _get_accessible_group(request, record_group_id)
    if err:
        return err

    # A rank curve only means something for one person: on a group sheet, several
    # people's climbs interleave into a line that goes nowhere. Default to the caller.
    asked = request.GET.get("member")
    if asked and asked.isdigit():
        whose = int(asked)
    elif (request.user.is_authenticated
          and record_group.matches.filter(is_deleted=False, recorded_by=request.user).exists()):
        whose = request.user.id
    else:
        whose = record_group.user_id

    matches = (
        record_group.matches
        .filter(is_deleted=False, recorded_by_id=whose)
        .filter(Q(rank__isnull=False) | Q(score__isnull=False))
        .order_by("id")
        .values("rank", "wins", "score", "result")
    )

    data = [
        {
            "index": i + 1,
            "rank": m["rank"],
            "wins": m["wins"],
            "score": m["score"],
            "result": m["result"],
        }
        for i, m in enumerate(matches)
    ]

    return Response({"matches": data, "member": user_brief(User.objects.filter(id=whose).first())},
                    status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def record_group_invite(request, record_group_id):
    """Owner: issue or rotate the invite code (which also turns the sheet into a shared one)."""
    import secrets

    group, err = _get_accessible_group(request, record_group_id, need="manage")
    if err:
        return err
    if request.data.get("disable"):
        group.invite_code = ""
        group.save(update_fields=["invite_code"])
    else:
        group.invite_code = secrets.token_urlsafe(8)[:10]
        group.kind = "shared"
        group.save(update_fields=["invite_code", "kind"])
    return Response({"invite_code": group.invite_code, "kind": group.kind})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def join_record_group(request):
    """Join a shared sheet with its invite code."""
    code = (request.data.get("code") or "").strip()
    if not code:
        return Response({"error": "초대 코드가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)
    group = RecordGroup.objects.filter(invite_code=code, is_deleted=False).first()
    if not group:
        return Response({"error": "초대 코드를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    if group.user_id == request.user.id:
        return Response({"record_group_id": group.id, "name": group.name, "role": "owner"})
    RecordGroupMember.objects.get_or_create(record_group=group, user=request.user, defaults={"role": "editor"})
    return Response({"record_group_id": group.id, "name": group.name, "role": "editor"})


@api_view(["GET", "POST"])
def record_group_members(request, record_group_id):
    """GET: who is on the sheet, open to anyone who may view it. POST (owner): add someone by id or nickname."""
    group, err = _get_accessible_group(request, record_group_id, need="manage" if request.method == "POST" else "view")
    if err:
        return err

    if request.method == "POST":
        uid = str(request.data.get("user_id") or "")
        username = (request.data.get("username") or "").strip()
        role = request.data.get("role") if request.data.get("role") in ("editor", "viewer") else "editor"
        if uid.isdigit():
            target = User.objects.filter(id=int(uid)).first()
        elif username:
            target = User.objects.filter(username=username).first()
            if not target:
                near = list(User.objects.filter(username__iexact=username)[:2])
                if len(near) > 1:
                    return Response({"error": "같은 닉네임이 여럿입니다. 대소문자까지 정확히 입력해 주세요."},
                                    status=status.HTTP_400_BAD_REQUEST)
                target = near[0] if near else None
        else:
            target = None
        if not target:
            return Response({"error": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        if target.id == group.user_id:
            return Response({"error": "시트 소유자입니다."}, status=status.HTTP_400_BAD_REQUEST)
        RecordGroupMember.objects.update_or_create(
            record_group=group, user=target, defaults={"role": role, "invited_by": request.user})
        if group.kind != "shared":
            group.kind = "shared"
            group.save(update_fields=["kind"])

    members = [
        {**user_brief(m.user), "role": m.role, "joined_at": m.joined_at}
        for m in group.members.select_related("user", "user__avatar_icon", "user__equipped_border").order_by("joined_at")
    ]
    my_role = getattr(group, "viewer_role", None)
    return Response({
        "kind": group.kind,
        "my_role": my_role,
        "owner": user_brief(group.user),
        "members": members,
        "invite_code": group.invite_code if my_role == "owner" else "",
    })


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def remove_record_group_member(request, record_group_id, user_id):
    """Owner removes anyone; a member removes themselves."""
    group = RecordGroup.objects.filter(id=record_group_id, is_deleted=False).first()
    if not group:
        return Response({"error": "그룹을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    if group.user_id != request.user.id and request.user.id != user_id:
        return Response({"error": "권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
    RecordGroupMember.objects.filter(record_group=group, user_id=user_id).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def record_group_contributors(request, record_group_id):
    """Per-person totals inside a sheet — the split shown on shared sheets."""
    group, err = _get_accessible_group(request, record_group_id)
    if err:
        return err
    rows = (group.matches.filter(is_deleted=False).values("recorded_by")
            .annotate(games=Count("id"), wins=Count("id", filter=Q(result="win"))).order_by("-games"))
    users = {u.id: u for u in User.objects.filter(id__in=[r["recorded_by"] for r in rows if r["recorded_by"]])
             .select_related("avatar_icon", "equipped_border")}
    out = [{
        "user": user_brief(users.get(r["recorded_by"])),
        "games": r["games"],
        "wins": r["wins"],
        "win_rate": round(r["wins"] / r["games"] * 100, 1) if r["games"] else None,
    } for r in rows]
    return Response({"contributors": out})
