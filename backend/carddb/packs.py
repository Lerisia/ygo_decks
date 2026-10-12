"""The pack simulator (엘리스 2026-10-12): the packs one can open and the cards in each; buying them with gems, drawn on
the server (pack_draw), into the user's 카드 모음 (엘리스 10/13)."""
import os
import random
from collections import Counter

from django.conf import settings
from django.db import transaction
from django.db.models import Count, F, Max, Q, Sum
from django.http import Http404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from user.gems import NotEnoughGems, change_gems

from .display import display_name
from .face import face_thumb_url, face_url
from .models import MdPack, MdPackCard, PackPull, PackTally
from .pack_draw import GEMS_PER_PACK, draw_pack, draw_ten

RARITY_RANK = {"N": 0, "R": 1, "SR": 2, "UR": 3}

OPENABLE = [MdPack.Kind.NORMAL, MdPack.Kind.SECRET, MdPack.Kind.SELECTION]
MASTER_PACK = "Master Pack"
PACK_IMAGE_DIR = "md_ui/packs"   # the game's pack pictures, by their file name (MdPack.cover); hd/ for the opening

_cache = {"key": None, "packs": None, "cards": {}}


def _key():
    agg = MdPackCard.objects.aggregate(n=Count("id"), last=Max("id"))
    try:
        pictures = os.stat(os.path.join(settings.MEDIA_ROOT, PACK_IMAGE_DIR)).st_mtime
    except OSError:
        pictures = None
    return (MdPack.objects.count(), agg["n"], agg["last"], pictures)


def _fresh():
    key = _key()
    if _cache["key"] != key:
        _cache.update(key=key, packs=None, cards={})


def _image(pack, hd=False):
    if not pack.cover:
        return None
    rel = f"{PACK_IMAGE_DIR}/{'hd/' if hd else ''}{pack.cover}.webp"
    return settings.MEDIA_URL + rel if os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)) else None


def _row(pack, counts=None):
    row = {"id": pack.id, "kind": pack.kind, "name": pack.name_ko or pack.name_en, "name_en": pack.name_en,
           "released": pack.released.isoformat() if pack.released else None, "image": _image(pack),
           "master": pack.name_en == MASTER_PACK}
    if counts is not None:
        row["counts"] = counts
    return row


@api_view(["GET"])
@permission_classes([AllowAny])
def packs(request):
    """The packs one can open (master, secret and selection packs), newest first, with how many cards of each rarity."""
    _fresh()
    if _cache["packs"] is None:
        rarities = ("UR", "SR", "R", "N")
        rows = (MdPack.objects.filter(kind__in=OPENABLE)
                .annotate(**{r: Count("cards", filter=Q(cards__rarity=r)) for r in rarities}).order_by("-released", "name_en"))
        _cache["packs"] = [_row(p, {r: getattr(p, r) for r in rarities}) for p in rows]
    return Response({"packs": _cache["packs"]})


def _detail(pack_id):
    """A pack and its cards (each at the rarity it comes in there, with its face), kept until the packs change; None
    for no such openable pack."""
    _fresh()
    if pack_id not in _cache["cards"]:
        p = MdPack.objects.filter(id=pack_id, kind__in=OPENABLE).first()
        if not p:
            return None
        cards = [{"print": e.md_print_id, "card": e.md_print.card_id, "name": display_name(e.md_print.card),
                  "rarity": e.rarity, "thumb": face_thumb_url(e.md_print_id), "face": face_url(e.md_print_id)}
                 for e in p.cards.select_related("md_print__card")]
        row = _row(p)
        row["image_hd"] = _image(p, hd=True)
        row["cards"] = [c for c in cards if c["thumb"]]
        if p.kind == MdPack.Kind.SECRET:
            master = MdPack.objects.filter(name_en=MASTER_PACK, kind=MdPack.Kind.NORMAL).first()
            row["master_pack"] = master.id if master else None
        _cache["cards"][pack_id] = row
    return _cache["cards"][pack_id]


@api_view(["GET"])
@permission_classes([AllowAny])
def pack(request, pack_id):
    """A pack and its cards, each at the rarity it comes in there, with its face; a secret pack names the master pack
    its first four cards come from."""
    row = _detail(pack_id)
    if row is None:
        raise Http404
    return Response(row)


def _pool(cards):
    pool = {"UR": [], "SR": [], "R": [], "N": []}
    for c in cards:
        pool[c["rarity"]].append(c)
    return pool


def _tally_row(t):
    return {"gems": t.gems, "packs": t.packs, "ur": t.ur, "sr": t.sr, "owed": t.owed} if t else \
        {"gems": 0, "packs": 0, "ur": 0, "sr": 0, "owed": False}


_rng = random.SystemRandom().random


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def open_pack(request, pack_id):
    """Buy one or ten packs with gems (100 a pack): the server draws them (pack_draw), the cards go to the user's
    collection, and the pack's tally (and the UR owed after ten without one) is kept; the cards, each marked new when
    the user had never pulled that print, the gems left and the tally."""
    try:
        count = int(request.data.get("count", 1))
    except (TypeError, ValueError):
        count = 0
    if count not in (1, 10):
        return Response({"error": "1팩 또는 10팩만 살 수 있습니다."}, status=400)
    row = _detail(pack_id)
    if row is None:
        raise Http404
    pools = {"main": _pool(row["cards"]), "master": None}
    if row["kind"] == MdPack.Kind.SECRET:
        master = _detail(row.get("master_pack")) if row.get("master_pack") else None
        if not master:
            return Response({"error": "마스터 팩을 찾지 못했습니다."}, status=503)
        pools["master"] = _pool(master["cards"])
    if not row["cards"]:
        return Response({"error": "이 팩에는 열 수 있는 카드가 없습니다."}, status=400)
    user = request.user
    with transaction.atomic():
        tally, _ = PackTally.objects.get_or_create(user=user, pack_id=pack_id)
        try:
            gems = change_gems(user, -GEMS_PER_PACK * count, kind="pack_purchase", note=f"{row['name']} {count}팩")
        except NotEnoughGems as e:
            return Response({"error": "젬이 부족합니다.", "gems": e.held}, status=400)
        if count == 1:
            packs, owed = [draw_pack(pools, _rng)], tally.owed
        else:
            packs, owed = draw_ten(pools, tally.owed, _rng)
        flat = [c for p in packs for c in p]
        prints = {c["card"]["print"] for c in flat}
        had = set(PackPull.objects.filter(user=user, md_print_id__in=prints).values_list("md_print_id", flat=True))
        want = Counter((c["card"]["print"], c["finish"]) for c in flat)
        rarity = {c["card"]["print"]: c["rarity"] for c in flat}
        rows = {(p.md_print_id, p.finish): p for p in PackPull.objects.filter(user=user, md_print_id__in=prints)}
        now = timezone.now()
        for (pid, finish), n in want.items():
            if (pid, finish) in rows:
                PackPull.objects.filter(pk=rows[(pid, finish)].pk).update(count=F("count") + n, last_at=now)
            else:
                PackPull.objects.create(user=user, md_print_id=pid, finish=finish, rarity=rarity[pid], count=n)
        tally.gems += GEMS_PER_PACK * count
        tally.packs += count
        tally.ur += sum(c["rarity"] == "UR" for c in flat)
        tally.sr += sum(c["rarity"] == "SR" for c in flat)
        tally.owed = owed
        tally.save()
    return Response({
        "packs": [[{**c["card"], "rarity": c["rarity"], "finish": c["finish"], "new": c["card"]["print"] not in had}
                   for c in p] for p in packs],
        "gems": gems, "tally": _tally_row(tally),
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def pack_mine(request, pack_id):
    """The signed-in user's gems and their tally for this pack (nothing for a guest)."""
    if not request.user.is_authenticated:
        return Response({"signed_in": False, "gems": 0, "tally": _tally_row(None)})
    t = PackTally.objects.filter(user=request.user, pack_id=pack_id).first()
    return Response({"signed_in": True, "gems": request.user.gems, "tally": _tally_row(t)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def collection(request):
    """The user's 카드 모음: every print pulled, how many in each finish, the rarity it came in and when, with a summary."""
    user = request.user
    by_print = {}
    for p in PackPull.objects.filter(user=user).select_related("md_print__card"):
        row = by_print.setdefault(p.md_print_id, {
            "print": p.md_print_id, "card": p.md_print.card_id, "name": display_name(p.md_print.card), "rarity": p.rarity,
            "thumb": face_thumb_url(p.md_print_id), "face": face_url(p.md_print_id), "basic": 0, "shine": 0, "royal": 0,
            "first": p.first_at, "last": p.last_at})
        row[p.finish] += p.count
        row["first"] = min(row["first"], p.first_at)
        row["last"] = max(row["last"], p.last_at)
        if RARITY_RANK[p.rarity] > RARITY_RANK[row["rarity"]]:
            row["rarity"] = p.rarity
    cards = sorted(by_print.values(), key=lambda r: r["last"], reverse=True)
    for r in cards:
        r["first"], r["last"] = r["first"].isoformat(), r["last"].isoformat()
    tallies = PackTally.objects.filter(user=user).aggregate(gems=Sum("gems"), packs=Sum("packs"))
    return Response({
        "gems": user.gems,
        "summary": {"kinds": len(cards), "total": sum(r["basic"] + r["shine"] + r["royal"] for r in cards),
                    "ur": sum(r["rarity"] == "UR" for r in cards), "sr": sum(r["rarity"] == "SR" for r in cards),
                    "shine": sum(r["shine"] for r in cards), "royal": sum(r["royal"] for r in cards),
                    "gems_spent": tallies["gems"] or 0, "packs": tallies["packs"] or 0},
        "cards": cards,
    })
