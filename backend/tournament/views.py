import math
import secrets

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from . import engine
import re

from .models import Announcement, ChatMessage, Entrant, Match, Round, Tournament
from .serializers import (AnnouncementSerializer, ChatMessageSerializer,
                          EntrantSerializer, TournamentDetailSerializer,
                          TournamentListSerializer, user_avatar)

VALID_FORMATS = {f for f, _ in Tournament.FORMAT_CHOICES}


def _err(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": msg}, status=code)


def _active_entrants(tournament):
    return tournament.entrants.filter(status="checked_in")


def _tournament_matches(tournament):
    return Match.objects.filter(round__tournament=tournament)


def _records(tournament):
    """Per-entrant W/D/L + points from confirmed matches (byes count as wins).
    Entrants who dropped out after being seated stay in (active=False) so the
    table still shows them; pairing only ever uses the active ones."""
    seated = {eid for m in _tournament_matches(tournament) for eid in (m.entrant1_id, m.entrant2_id) if eid}
    stats = {}
    for e in tournament.entrants.filter(status__in=["checked_in", "withdrawn", "kicked"]):
        if e.status == "checked_in" or e.id in seated:
            stats[e.id] = {"entrant": e, "active": e.status == "checked_in", "wins": 0, "draws": 0, "losses": 0, "opponents": []}
    for m in _tournament_matches(tournament).filter(report_status="confirmed"):
        s1 = stats.get(m.entrant1_id)
        s2 = stats.get(m.entrant2_id) if m.entrant2_id else None
        if m.result == "bye":
            if s1:
                s1["wins"] += 1
            continue
        if s1 and s2:
            s1["opponents"].append(m.entrant2_id)
            s2["opponents"].append(m.entrant1_id)
        if m.result == "p1":
            if s1: s1["wins"] += 1
            if s2: s2["losses"] += 1
        elif m.result == "p2":
            if s2: s2["wins"] += 1
            if s1: s1["losses"] += 1
        elif m.result == "draw":
            if s1: s1["draws"] += 1
            if s2: s2["draws"] += 1
    for s in stats.values():
        s["points"] = s["wins"] * engine.WIN_POINTS + s["draws"] * engine.DRAW_POINTS
    return stats


def _create_matches(rnd, pairs, groups=None, brackets=None):
    """`groups`: optional group index per pair (group stage); `brackets`: optional
    winners/losers/final tag per pair (double elimination)."""
    for pos, (a, b) in enumerate(pairs):
        Match.objects.create(
            round=rnd, entrant1_id=a, entrant2_id=b, bracket_pos=pos,
            group=groups[pos] if groups else None,
            bracket=brackets[pos] if brackets else "",
            result="bye" if b is None else None,
            report_status="confirmed" if b is None else "pending",
        )


def _winner(m):
    return m.entrant1_id if m.result in ("p1", "bye") else m.entrant2_id


def _loser(m):
    return None if m.result == "bye" else (m.entrant2_id if m.result == "p1" else m.entrant1_id)


def _double_elim_next(tournament, current):
    """Next round of a double elimination as (pairs, brackets), or None when the
    tournament is decided. Everything is derived from confirmed matches, so a
    stored state can never drift from the bracket."""
    all_matches = list(_tournament_matches(tournament).select_related("round").order_by("round__number", "bracket_pos"))
    cur = [m for m in all_matches if m.round_id == current.id]
    finals = [m for m in all_matches if m.bracket == "final"]
    if finals:
        last = finals[-1]
        if _winner(last) == last.entrant1_id or len(finals) >= 2:
            return None                                   # WB champion held, or the reset settled it
        return [(last.entrant1_id, last.entrant2_id)], ["final"]

    cur_wb = [m for m in cur if m.bracket == "winners"]
    if cur_wb:
        wb_alive = [_winner(m) for m in cur_wb]
    else:  # WB already finished: its champion won the last one-match WB round
        wb_alive = [_winner(m) for m in all_matches if m.bracket == "winners"][-1:]
    seated_in_lb = {eid for m in all_matches if m.bracket == "losers" for eid in (m.entrant1_id, m.entrant2_id) if eid}
    pending = [l for l in (_loser(m) for m in all_matches if m.bracket == "winners") if l and l not in seated_in_lb]
    survivors = [_winner(m) for m in cur if m.bracket == "losers"]

    pairs, brackets = [], []
    if len(wb_alive) >= 2:
        for p in engine.pair_adjacent(wb_alive):
            pairs.append(p); brackets.append("winners")
    lb_pairs, waiting = engine.losers_round(survivors, pending)
    if not survivors and len(pending) == 1 and not waiting:
        lb_pairs, lb_champion = [], pending[0]          # a lone first dropper needs no bye round
    else:
        lb_champion = survivors[0] if (len(survivors) == 1 and not pending and not lb_pairs) else None
    for p in lb_pairs:
        pairs.append(p); brackets.append("losers")
    if not pairs and len(wb_alive) == 1 and lb_champion:
        return [(wb_alive[0], lb_champion)], ["final"]
    return (pairs, brackets) if pairs else None


def _active_stats(stats):
    return {eid: st for eid, st in stats.items() if st["active"]}


def _ranked_entrant_ids(stats):
    """Standings order among still-active entrants: points desc, buchholz desc, name."""
    points = {eid: st["points"] for eid, st in stats.items()}
    opponents = {eid: st["opponents"] for eid, st in stats.items()}
    buch = engine.buchholz_scores(points, opponents)
    return [eid for eid, _ in sorted(
        _active_stats(stats).items(), key=lambda kv: (-kv[1]["points"], -buch.get(kv[0], 0), kv[1]["entrant"].name))]


def _seat(tournament, pairs):
    """Drop-outs never get seated: their would-be opponent takes a bye, and a
    pair of two drop-outs disappears."""
    active = set(_active_entrants(tournament).values_list("id", flat=True))
    out = []
    for a, b in pairs:
        a_ok, b_ok = a in active, b in active
        if a_ok and (b is None or b_ok):
            out.append((a, b))
        elif a_ok:
            out.append((a, None))
        elif b_ok:
            out.append((b, None))
    return out


def _forfeit_open_matches(tournament, entrant, actor):
    """Someone leaves mid-tournament: every unsettled match of theirs in the current
    round goes to the opponent (a bye of theirs is left alone)."""
    if tournament.status != "ongoing":
        return
    current = Round.objects.filter(tournament=tournament, number=tournament.current_round).first()
    if not current:
        return
    for m in current.matches.exclude(report_status="confirmed"):
        if m.entrant1_id == entrant.id and m.entrant2_id:
            m.result = "p2"
        elif m.entrant2_id == entrant.id:
            m.result = "p1"
        else:
            continue
        m.report_status, m.reported_by = "confirmed", actor
        m.save(update_fields=["result", "report_status", "reported_by"])


GROUP_COUNTS = (2, 4, 8)
MAX_ADVANCE = 4


def _group_options(format_config):
    """(groups, advance) from format_config, or an error message."""
    try:
        groups = int(format_config.get("groups", 2))
        advance = int(format_config.get("advance", 1))
    except (TypeError, ValueError):
        return None, "조 설정이 올바르지 않습니다."
    if groups not in GROUP_COUNTS:
        return None, "조 수는 2, 4, 8 중 하나여야 합니다."
    if not (1 <= advance <= MAX_ADVANCE):
        return None, f"조당 진출 인원은 1~{MAX_ADVANCE}명이어야 합니다."
    return (groups, advance), None


def _group_of(tournament):
    """entrant_id -> group index, from the table stored at start."""
    return {eid: gi for gi, ids in enumerate(tournament.format_config.get("group_table") or []) for eid in ids}


def _group_rankings(tournament, stats):
    """Per group, (entrant_id, points) best first — same order as the standings table."""
    group_of = _group_of(tournament)
    ranked = _ranked_entrant_ids(stats)
    rankings = [[] for _ in tournament.format_config.get("group_table") or []]
    for eid in ranked:
        gi = group_of.get(eid)
        if gi is not None:
            rankings[gi].append((eid, stats[eid]["points"]))
    return rankings


def _swiss_round_limit(tournament, entrant_count):
    configured = tournament.format_config.get("swiss_rounds")
    if configured:
        return int(configured)
    return max(1, math.ceil(math.log2(max(2, entrant_count))))



MAX_COVER_BYTES = 5 * 1024 * 1024


def _cover_error(image):
    if image.size > MAX_COVER_BYTES:
        return "배너 이미지는 5MB 이하여야 합니다."
    from PIL import Image as PILImage
    try:
        PILImage.open(image).verify()
        image.seek(0)
    except Exception:
        return "이미지 파일이 아닙니다."
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_tournament(request):
    data = request.data
    fmt = data.get("format")
    if fmt not in VALID_FORMATS:
        return _err("지원하지 않는 대회 형식입니다.")
    if not data.get("name") or not data.get("event_date"):
        return _err("name과 event_date는 필수입니다.")
    try:
        capacity = int(data.get("capacity", 8))
    except (TypeError, ValueError):
        return _err("capacity가 올바르지 않습니다.")
    if not (2 <= capacity <= 128):
        return _err("정원은 2~128명이어야 합니다.")
    cover = request.FILES.get("cover_image")
    if cover:
        cover_err = _cover_error(cover)
        if cover_err:
            return _err(cover_err)
    format_config = data.get("format_config") or {}
    if isinstance(format_config, str):  # multipart submits JSON as a string
        import json
        try:
            format_config = json.loads(format_config) if format_config else {}
        except ValueError:
            return _err("format_config가 올바르지 않습니다.")
    if fmt == "group_knockout":
        opts, opt_err = _group_options(format_config)
        if opt_err:
            return _err(opt_err)
        format_config = {**format_config, "groups": opts[0], "advance": opts[1]}
    t = Tournament.objects.create(
        name=data["name"],
        description=data.get("description", ""),
        host=request.user,
        format=fmt,
        format_config=format_config,
        capacity=capacity,
        event_date=data["event_date"],
        cover_image=request.FILES.get("cover_image"),
    )
    return Response(TournamentDetailSerializer(t).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def list_tournaments(request):
    qs = Tournament.objects.exclude(status="cancelled").order_by("-created_at")
    wanted = request.GET.get("status")
    if wanted:
        qs = qs.filter(status=wanted)
    return Response(TournamentListSerializer(qs, many=True).data)


@api_view(["GET", "PATCH"])
def tournament_detail(request, tournament_id):
    try:
        t = Tournament.objects.get(id=tournament_id)
    except Tournament.DoesNotExist:
        return _err("대회를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    if request.method == "PATCH":
        return _edit_tournament(request, t)
    show_uid = request.user.is_authenticated and (
        t.host_id == request.user.id or t.entrants.filter(user=request.user).exists()
    )
    return Response(TournamentDetailSerializer(t, context={"show_uid": show_uid}).data)


def _edit_tournament(request, t):
    """Host edits. Text and date any time before the end; capacity, format and
    format options only while still recruiting."""
    if not request.user.is_authenticated:
        return _err("로그인이 필요합니다.", status.HTTP_401_UNAUTHORIZED)
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    if t.status in ("completed", "cancelled"):
        return _err("끝난 대회는 수정할 수 없습니다.")
    data = request.data
    changed = []
    if "name" in data:
        if not str(data["name"]).strip():
            return _err("대회 이름을 입력해 주세요.")
        t.name = str(data["name"]).strip()[:100]; changed.append("name")
    if "description" in data:
        t.description = str(data["description"] or ""); changed.append("description")
    if "event_date" in data:
        if not data["event_date"]:
            return _err("일시를 입력해 주세요.")
        t.event_date = data["event_date"]; changed.append("event_date")
    locked = [k for k in ("capacity", "format", "format_config") if k in data]
    if locked and t.status != "recruiting":
        return _err("대회 시작 후에는 정원·형식을 바꿀 수 없습니다.")
    if "capacity" in data:
        try:
            capacity = int(data["capacity"])
        except (TypeError, ValueError):
            return _err("capacity가 올바르지 않습니다.")
        if not (2 <= capacity <= 128):
            return _err("정원은 2~128명이어야 합니다.")
        current = t.entrants.exclude(status__in=["withdrawn", "kicked"]).count()
        if capacity < current:
            return _err(f"현재 참가자({current}명)보다 적게 줄일 수 없습니다.")
        t.capacity = capacity; changed.append("capacity")
    if "format" in data:
        if data["format"] not in VALID_FORMATS:
            return _err("지원하지 않는 대회 형식입니다.")
        t.format = data["format"]; changed.append("format")
    if "format_config" in data:
        cfg = data["format_config"] or {}
        if isinstance(cfg, str):
            import json
            try:
                cfg = json.loads(cfg) if cfg else {}
            except ValueError:
                return _err("format_config가 올바르지 않습니다.")
        t.format_config = cfg; changed.append("format_config")
    if t.format == "group_knockout" and ("format" in data or "format_config" in data):
        opts, opt_err = _group_options(t.format_config)
        if opt_err:
            return _err(opt_err)
        t.format_config = {**t.format_config, "groups": opts[0], "advance": opts[1]}
        if "format_config" not in changed:
            changed.append("format_config")
    if changed:
        t.save(update_fields=changed)
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cancel_tournament(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    if t.status not in ("recruiting", "ongoing"):
        return _err("취소할 수 없는 상태입니다.")
    t.status = "cancelled"
    t.save(update_fields=["status"])
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)


def _get_tournament(tournament_id):
    try:
        return Tournament.objects.get(id=tournament_id), None
    except Tournament.DoesNotExist:
        return None, _err("대회를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def register(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.status != "recruiting":
        return _err("모집 중인 대회가 아닙니다.")
    active = t.entrants.exclude(status__in=["withdrawn", "kicked"])
    existing = t.entrants.filter(user=request.user).first()
    if existing and existing.status not in ("withdrawn",):
        return _err("이미 신청했습니다." if existing.status != "kicked" else "참가할 수 없는 대회입니다.")
    if active.count() >= t.capacity:
        return _err("정원이 가득 찼습니다.")
    md_uid = str(request.data.get("md_uid") or "").strip() or request.user.md_uid
    if not re.fullmatch(r"\d{9}", md_uid or ""):
        return _err("마스터 듀얼 UID(숫자 9자리)를 입력해 주세요.")
    if md_uid != request.user.md_uid:  # remember for the next tournament
        request.user.md_uid = md_uid
        request.user.save(update_fields=["md_uid"])
    if existing:  # withdrawn -> re-register on the same row
        existing.status = "registered"
        existing.md_uid = md_uid
        existing.save(update_fields=["status", "md_uid"])
        return Response(EntrantSerializer(existing, context={"show_uid": True}).data)
    entrant = Entrant.objects.create(tournament=t, user=request.user, name=request.user.username, md_uid=md_uid)
    return Response(EntrantSerializer(entrant, context={"show_uid": True}).data)


def _own_entrant(t, user):
    return t.entrants.filter(user=user).first()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def withdraw(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.status not in ("recruiting", "ongoing"):
        return _err("이미 끝난 대회입니다.")
    entrant = _own_entrant(t, request.user)
    if not entrant or entrant.status in ("withdrawn", "kicked"):
        return _err("참가 중이 아닙니다.")
    entrant.status = "withdrawn"
    entrant.save(update_fields=["status"])
    _forfeit_open_matches(t, entrant, request.user)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def check_in(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.status != "recruiting":
        return _err("체크인 기간이 아닙니다.")
    entrant = _own_entrant(t, request.user)
    if not entrant or entrant.status != "registered":
        return _err("신청 상태에서만 체크인할 수 있습니다.")
    entrant.status = "checked_in"
    entrant.save(update_fields=["status"])
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def kick(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    entrant = t.entrants.filter(id=request.data.get("entrant_id")).first()
    if not entrant:
        return _err("참가자를 찾을 수 없습니다.")
    entrant.status = "kicked"
    entrant.save(update_fields=["status"])
    _forfeit_open_matches(t, entrant, request.user)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def start_tournament(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "recruiting":
        return _err("이미 시작된 대회입니다.")
    entrants = list(_active_entrants(t))
    if len(entrants) < 2:
        return _err("체크인한 참가자가 2명 이상이어야 합니다.")

    seed = secrets.token_hex(8)
    rng = engine.make_rng(seed)
    ids = [e.id for e in entrants]

    groups, brackets = None, None
    if t.format == "round_robin":
        schedule = engine.round_robin_schedule(ids, rng)
        t.format_config = {**t.format_config, "rr_schedule": [[list(p) for p in rnd] for rnd in schedule]}
        pairs = [(a, b) for a, b in schedule[0]]
        stage = "league"
    elif t.format == "group_knockout":
        (n_groups, _), _ = _group_options(t.format_config)
        if len(ids) < 2 * n_groups:
            return _err(f"조당 2명 이상이 필요합니다 (체크인 {len(ids)}명, {n_groups}개 조).")
        table = engine.group_split(ids, n_groups, rng)
        schedule = engine.group_schedule(table, rng)
        t.format_config = {**t.format_config, "group_table": table,
                           "group_schedule": [[[gi, list(p)] for gi, p in rnd] for rnd in schedule]}
        groups = [gi for gi, _ in schedule[0]]
        pairs = [p for _, p in schedule[0]]
        stage = "league"
    elif t.format == "single_elim":
        pairs = engine.single_elim_round1(ids, rng)
        stage = "knockout"
    elif t.format == "double_elim":
        pairs = engine.single_elim_round1(ids, rng)
        brackets = ["winners"] * len(pairs)
        stage = "knockout"
    else:  # swiss / swiss_cut both open with a swiss round
        pairs = engine.swiss_pairs([(i, 0) for i in ids], history=set(), prior_byes=set(), rng=rng)
        stage = "swiss"

    rnd = Round.objects.create(tournament=t, number=1, random_seed=seed, stage=stage)
    _create_matches(rnd, pairs, groups, brackets)
    t.status = "ongoing"
    t.current_round = 1
    t.save(update_fields=["status", "current_round", "format_config"])
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def next_round(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "ongoing":
        return _err("진행 중인 대회가 아닙니다.")
    current = Round.objects.get(tournament=t, number=t.current_round)
    if current.matches.exclude(report_status="confirmed").exists():
        return _err("아직 확정되지 않은 경기가 있습니다.")

    stats = _records(t)
    seed = secrets.token_hex(8)
    rng = engine.make_rng(seed)

    def knockout_advance():
        winners = []
        for m in current.matches.order_by("bracket_pos"):
            winners.append(m.entrant1_id if m.result in ("p1", "bye") else m.entrant2_id)
        if len(winners) < 2:
            return None
        return _seat(t, engine.pair_adjacent(winners))

    def swiss_pairs_next():
        history = set()
        prior_byes = set()
        for m in _tournament_matches(t):
            if m.entrant2_id:
                history.add(frozenset((m.entrant1_id, m.entrant2_id)))
            else:
                prior_byes.add(m.entrant1_id)
        records = [(eid, st["points"]) for eid, st in _active_stats(stats).items()]
        return engine.swiss_pairs(records, history=history, prior_byes=prior_byes, rng=rng)

    groups, brackets = None, None
    if t.format == "single_elim":
        pairs = knockout_advance()
        if pairs is None:
            return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
        stage = "knockout"
    elif t.format == "double_elim":
        nxt = _double_elim_next(t, current)
        if nxt is None:
            return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
        pairs, brackets = nxt
        seated = [(p2, b) for p, b in zip(pairs, brackets) for p2 in _seat(t, [p])]
        pairs, brackets = [p for p, _ in seated], [b for _, b in seated]
        if not pairs:
            return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
        stage = "knockout"
    elif t.format == "group_knockout":
        schedule = t.format_config.get("group_schedule") or []
        if current.stage == "knockout":
            pairs = knockout_advance()
            if pairs is None:
                return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
            stage = "knockout"
        elif t.current_round < len(schedule):
            seated = [(gi, sp) for gi, p in schedule[t.current_round] for sp in _seat(t, [tuple(p)])]
            groups = [gi for gi, _ in seated]
            pairs = [p for _, p in seated]
            stage = "league"
        else:  # group stage done -> cross-seeded knockout
            (_, advance), _ = _group_options(t.format_config)
            ordered = engine.group_qualifiers(_group_rankings(t, stats), advance)
            if len(ordered) < 2:
                return _err("결선을 진행할 참가자가 부족합니다.")
            pairs = engine.seeded_bracket(ordered)
            stage = "knockout"
    elif t.format == "round_robin":
        schedule = t.format_config.get("rr_schedule") or []
        if t.current_round >= len(schedule):
            return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
        pairs = _seat(t, [tuple(p) for p in schedule[t.current_round]])
        stage = "league"
    elif t.format == "swiss_cut":
        if current.stage == "knockout":
            pairs = knockout_advance()
            if pairs is None:
                return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
            stage = "knockout"
        elif t.current_round < _swiss_round_limit(t, len(_active_stats(stats))):
            pairs = swiss_pairs_next()
            stage = "swiss"
        else:  # swiss stage done -> seed the cut
            try:
                cut = int(t.format_config.get("cut", 4))
            except (TypeError, ValueError):
                cut = 4
            ranked = _ranked_entrant_ids(stats)[:max(2, cut)]
            if len(ranked) < 2:
                return _err("결선을 진행할 참가자가 부족합니다.")
            pairs = engine.seeded_bracket(ranked)
            stage = "knockout"
    else:  # swiss
        if t.current_round >= _swiss_round_limit(t, len(_active_stats(stats))):
            return _err("모든 라운드가 끝났습니다. 대회를 종료해 주세요.")
        pairs = swiss_pairs_next()
        stage = "swiss"

    current.status = "completed"
    current.save(update_fields=["status"])
    rnd = Round.objects.create(tournament=t, number=t.current_round + 1, random_seed=seed, stage=stage)
    _create_matches(rnd, pairs, groups, brackets)
    t.current_round += 1
    t.save(update_fields=["current_round"])
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_tournament(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "ongoing":
        return _err("진행 중인 대회가 아닙니다.")
    if _tournament_matches(t).exclude(report_status="confirmed").exists():
        return _err("아직 확정되지 않은 경기가 있습니다.")
    Round.objects.filter(tournament=t, number=t.current_round).update(status="completed")
    t.status = "completed"
    t.save(update_fields=["status"])
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)


@api_view(["GET"])
def standings(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    stats = _records(t)
    points = {eid: s["points"] for eid, s in stats.items()}
    opponents = {eid: s["opponents"] for eid, s in stats.items()}
    buchholz = engine.buchholz_scores(points, opponents)
    group_of = _group_of(t)
    tier = {}
    knockout_rounds = list(Round.objects.filter(tournament=t, stage="knockout").order_by("number").prefetch_related("matches"))
    qualified = {eid for r in knockout_rounds for m in r.matches.all() for eid in (m.entrant1_id, m.entrant2_id) if eid}
    rows = []
    for eid, s in stats.items():
        icon, border = user_avatar(s["entrant"].user)
        rows.append({
            "entrant_id": eid,
            "name": s["entrant"].name,
            "user": s["entrant"].user_id,
            "wins": s["wins"], "draws": s["draws"], "losses": s["losses"],
            "points": s["points"],
            "buchholz": buchholz.get(eid, 0),
            "group": group_of.get(eid),
            "qualified": eid in qualified,
            "dropped": not s["active"],
            "avatar_icon": icon, "border": border,
        })
    if knockout_rounds:
        last_number = knockout_rounds[-1].number
        for r in knockout_rounds:
            for m in r.matches.all():
                for eid in (m.entrant1_id, m.entrant2_id):
                    if eid:
                        tier[eid] = last_number - r.number + 1  # deeper run -> lower tier
        final = knockout_rounds[-1].matches.order_by("bracket_pos").first()
        if final and final.report_status == "confirmed" and final.result in ("p1", "p2", "bye"):
            champion = final.entrant1_id if final.result in ("p1", "bye") else final.entrant2_id
            tier[champion] = 0
    rows.sort(key=lambda r: (r["dropped"], tier.get(r["entrant_id"], 10 ** 6), -r["points"], -r["buchholz"], r["name"]))
    return Response(rows)


def _match_role(match, user):
    if match.entrant1.user_id == user.id:
        return "p1"
    if match.entrant2 and match.entrant2.user_id == user.id:
        return "p2"
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def report_match(request, match_id):
    try:
        match = Match.objects.select_related("round__tournament", "entrant1", "entrant2").get(id=match_id)
    except Match.DoesNotExist:
        return _err("경기를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    if _match_role(match, request.user) is None:
        return _err("이 경기의 참가자가 아닙니다.", status.HTTP_403_FORBIDDEN)
    if match.report_status == "confirmed":
        return _err("이미 확정된 경기입니다.")
    reported = request.data.get("result")
    if reported not in ("win", "lose", "draw"):
        return _err("result는 win/lose/draw 중 하나여야 합니다.")
    if reported == "draw" and match.round.stage == "knockout":
        return _err("결선 토너먼트에서는 무승부가 허용되지 않습니다.")
    role = _match_role(match, request.user)
    if reported == "draw":
        match.result = "draw"
    else:  # reporter-relative -> board-relative
        won = reported == "win"
        match.result = "p1" if (role == "p1") == won else "p2"
    match.report_status = "reported"
    match.reported_by = request.user
    match.save()
    return Response({"ok": True, "result": match.result})


def _respond_to_report(request, match_id, new_status):
    try:
        match = Match.objects.select_related("entrant1", "entrant2").get(id=match_id)
    except Match.DoesNotExist:
        return _err("경기를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    if _match_role(match, request.user) is None:
        return _err("이 경기의 참가자가 아닙니다.", status.HTTP_403_FORBIDDEN)
    if match.report_status != "reported":
        return _err("보고된 경기가 아닙니다.")
    if match.reported_by_id == request.user.id:
        return _err("자신의 보고는 상대가 확인해야 합니다.", status.HTTP_403_FORBIDDEN)
    match.report_status = new_status
    match.save(update_fields=["report_status"])
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def confirm_match(request, match_id):
    return _respond_to_report(request, match_id, "confirmed")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dispute_match(request, match_id):
    return _respond_to_report(request, match_id, "disputed")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def override_match(request, match_id):
    try:
        match = Match.objects.select_related("round__tournament").get(id=match_id)
    except Match.DoesNotExist:
        return _err("경기를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    if match.round.tournament.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    result = request.data.get("result")
    if result not in ("p1", "p2", "draw"):
        return _err("result는 p1/p2/draw 중 하나여야 합니다.")
    if result == "draw" and match.round.stage == "knockout":
        return _err("결선 토너먼트에서는 무승부가 허용되지 않습니다.")
    match.result = result
    match.report_status = "confirmed"
    match.reported_by = request.user
    match.save()
    return Response({"ok": True, "result": match.result})


@api_view(["GET", "POST"])
def announcements(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if request.method == "GET":
        return Response(AnnouncementSerializer(t.announcements.all(), many=True).data)
    if not request.user.is_authenticated:
        return _err("로그인이 필요합니다.", status.HTTP_401_UNAUTHORIZED)
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    content = str(request.data.get("content") or "").strip()
    if not content:
        return _err("내용을 입력해 주세요.")
    ann = Announcement.objects.create(
        tournament=t, author=request.user, content=content,
        pinned=bool(request.data.get("pinned", False)),
    )
    return Response(AnnouncementSerializer(ann).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_announcement(request, announcement_id):
    try:
        ann = Announcement.objects.select_related("tournament").get(id=announcement_id)
    except Announcement.DoesNotExist:
        return _err("공지를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    if ann.tournament.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    ann.delete()
    return Response({"ok": True})


@api_view(["GET", "POST"])
def chat(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if request.method == "GET":
        qs = t.chat_messages.select_related("user__avatar_icon", "user__equipped_border")
        after = request.GET.get("after")
        if after and str(after).isdigit():
            qs = qs.filter(id__gt=int(after))
        return Response(ChatMessageSerializer(qs[:200], many=True).data)
    if not request.user.is_authenticated:
        return _err("로그인이 필요합니다.", status.HTTP_401_UNAUTHORIZED)
    is_host = t.host_id == request.user.id
    entrant = t.entrants.filter(user=request.user).exclude(status="kicked").first()
    if not is_host and entrant is None:
        return _err("참가자만 채팅할 수 있습니다.", status.HTTP_403_FORBIDDEN)
    content = str(request.data.get("content") or "").strip()
    if not content or len(content) > 500:
        return _err("내용은 1~500자여야 합니다.")
    msg = ChatMessage.objects.create(tournament=t, user=request.user, content=content)
    return Response(ChatMessageSerializer(msg).data, status=status.HTTP_201_CREATED)


# --- Deck submission ------------------------------------------------------

import os
import tempfile

from django.conf import settings

from .models import DeckSubmission, DeckSubmissionCard
from .scanning import scan_deck_image
from .serializers import DeckSubmissionSerializer

MAX_COPIES = 3


def _deck_response(submission):
    return Response(DeckSubmissionSerializer(submission).data)


def _own_active_entrant(t, user):
    return t.entrants.filter(user=user).exclude(status__in=["withdrawn", "kicked"]).first()


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def deck_submission(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err

    if request.method == "GET":
        entrant_id = request.GET.get("entrant_id")
        if entrant_id:
            entrant = t.entrants.filter(id=entrant_id).first()
            if not entrant:
                return _err("참가자를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
            is_owner = entrant.user_id == request.user.id
            if not (is_owner or t.host_id == request.user.id):
                return _err("열람 권한이 없습니다.", status.HTTP_403_FORBIDDEN)
        else:
            entrant = _own_active_entrant(t, request.user)
            if not entrant:
                return _err("참가 중이 아닙니다.", status.HTTP_403_FORBIDDEN)
        submission = DeckSubmission.objects.filter(entrant=entrant).first()
        if not submission:
            return _err("제출된 덱이 없습니다.", status.HTTP_404_NOT_FOUND)
        return _deck_response(submission)

    # POST: upload screenshot and (re)scan
    entrant = _own_active_entrant(t, request.user)
    if not entrant:
        return _err("참가 중이 아닙니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "recruiting":
        return _err("대회 시작 후에는 덱을 수정할 수 없습니다.")
    image = request.FILES.get("image")
    if not image:
        return _err("image 파일이 필요합니다.")

    submission, _ = DeckSubmission.objects.get_or_create(entrant=entrant)
    submission.image = image
    submission.save()

    with tempfile.TemporaryDirectory(prefix="tourdeck_") as work_dir:
        image_path = os.path.join(work_dir, "input.jpg")
        with open(image_path, "wb") as f:
            for chunk in submission.image.chunks():
                f.write(chunk)
        detections = scan_deck_image(image_path, work_dir)

    from card.models import Card
    counts = {}
    best_conf = {}
    unmatched = 0
    detections = [(str(cid), float(conf)) for cid, conf in detections]
    cards_by_scanner_id = {c.card_id: c for c in Card.objects.filter(card_id__in=[d[0] for d in detections])}
    for scanner_id, confidence in detections:
        card = cards_by_scanner_id.get(scanner_id)
        if card is None:
            unmatched += 1
            continue
        counts[card.id] = min(counts.get(card.id, 0) + 1, MAX_COPIES)
        best_conf[card.id] = max(best_conf.get(card.id, 0.0), float(confidence))

    submission.cards.all().delete()
    DeckSubmissionCard.objects.bulk_create([
        DeckSubmissionCard(submission=submission, card_id=cid, quantity=qty,
                           confidence=best_conf[cid], source="auto")
        for cid, qty in counts.items()
    ])
    submission.unmatched_count = unmatched
    submission.save(update_fields=["unmatched_count"])
    return _deck_response(submission)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def deck_card_add(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    entrant = _own_active_entrant(t, request.user)
    if not entrant:
        return _err("참가 중이 아닙니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "recruiting":
        return _err("대회 시작 후에는 덱을 수정할 수 없습니다.")
    try:
        quantity = int(request.data.get("quantity", 1))
    except (TypeError, ValueError):
        return _err("quantity가 올바르지 않습니다.")
    if not (1 <= quantity <= MAX_COPIES):
        return _err(f"수량은 1~{MAX_COPIES}장이어야 합니다.")
    from card.models import Card
    card = Card.objects.filter(id=request.data.get("card_id")).first()
    if not card:
        return _err("카드를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    submission, _ = DeckSubmission.objects.get_or_create(entrant=entrant)
    DeckSubmissionCard.objects.update_or_create(
        submission=submission, card=card,
        defaults={"quantity": quantity, "confidence": None, "source": "manual"},
    )
    return _deck_response(submission)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def deck_card_remove(request, tournament_id, row_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    entrant = _own_active_entrant(t, request.user)
    if not entrant:
        return _err("참가 중이 아닙니다.", status.HTTP_403_FORBIDDEN)
    if t.status != "recruiting":
        return _err("대회 시작 후에는 덱을 수정할 수 없습니다.")
    row = DeckSubmissionCard.objects.filter(id=row_id, submission__entrant=entrant).first()
    if not row:
        return _err("카드를 찾을 수 없습니다.", status.HTTP_404_NOT_FOUND)
    row.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_cover(request, tournament_id):
    t, err = _get_tournament(tournament_id)
    if err:
        return err
    if t.host_id != request.user.id:
        return _err("주최자만 가능합니다.", status.HTTP_403_FORBIDDEN)
    image = request.FILES.get("cover_image")
    if image:
        cover_err = _cover_error(image)
        if cover_err:
            return _err(cover_err)
        t.cover_image = image
    else:
        t.cover_image = None
    t.save(update_fields=["cover_image"])
    return Response(TournamentDetailSerializer(t, context={"show_uid": True}).data)
