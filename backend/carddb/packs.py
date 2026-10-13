"""The pack simulator (엘리스 2026-10-12): the packs one can open and the cards in each; buying them with gems, drawn on
the server (pack_draw), for the thrill alone: the cards are not kept (엘리스 10/13)."""
import os
import random
from datetime import timedelta
from collections import defaultdict

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import Http404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from user.gems import NotEnoughGems, change_gems

from . import dex
from .display import display_name
from .face import face_thumb_url, face_url
from .models import Card, MdPack, MdPackCard, MdPackVersion, MdPrint, PackTally
from .pack_draw import GEMS_PER_PACK, draw_pack, draw_ten


OPENABLE = [MdPack.Kind.NORMAL, MdPack.Kind.SECRET, MdPack.Kind.SELECTION]
MASTER_PACK = "Master Pack"
PACK_IMAGE_DIR = "md_ui/packs"   # the game's pack pictures, by their file name (MdPack.cover); hd/ for the opening

_cache = {"key": None, "packs": None, "cards": {}, "pickups": None, "lineups": {}}


def _key():
    agg = MdPackCard.objects.aggregate(n=Count("id"), last=Max("id"))
    versions = MdPackVersion.objects.aggregate(n=Count("id"), last=Max("id"), at=Max("updated"))
    try:
        pictures = os.stat(os.path.join(settings.MEDIA_ROOT, PACK_IMAGE_DIR)).st_mtime
    except OSError:
        pictures = None
    return (MdPack.objects.count(), agg["n"], agg["last"], versions["n"], versions["last"], versions["at"], pictures,
            _today())


def _today():
    return (timezone.localtime() - timedelta(hours=3)).date()   # Master Duel's day turns at 03:00


def _fresh():
    key = _key()
    if _cache["key"] != key:
        _cache.update(key=key, packs=None, cards={}, pickups=None, lineups={})


def _image(pack, hd=False, cover=None):
    cover = cover or pack.cover
    if not cover:
        return None
    rel = f"{PACK_IMAGE_DIR}/{'hd/' if hd else ''}{cover}.webp"
    return settings.MEDIA_URL + rel if os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)) else None


def _row(pack, counts=None):
    row = {"id": pack.id, "kind": pack.kind, "name": pack.name_ko or pack.name_en, "name_en": pack.name_en,
           "released": pack.released.isoformat() if pack.released else None,
           "changed": pack.changed.isoformat() if pack.changed else None, "image": _image(pack),
           "master": pack.name_en == MASTER_PACK}
    if counts is not None:
        row["counts"] = counts
    return row


@api_view(["GET"])
@permission_classes([AllowAny])
def packs(request):
    """The packs one can open (master, secret and selection packs) and the versions campaigns and older lineups sold
    of them, newest first (today's lineup from its last change), with how many cards of each rarity and how many came
    in a new art or an 오버프레임."""
    _fresh()
    if _cache["packs"] is None:
        rarities = ("UR", "SR", "R", "N")
        rows = (MdPack.objects.filter(kind__in=OPENABLE)
                .annotate(**{r: Count("cards", filter=Q(cards__rarity=r)) for r in rarities}).order_by("-released", "name_en"))
        # the cards a pack brought in a new art or an 오버프레임 (엘리스 10/13: to pick those packs out)
        def count(prints):
            out = {"new_art": 0, "overframe": 0}
            for md_id in prints:
                out["overframe" if dex._overframe(md_id) else "new_art"] += 1
            return out

        usual = defaultdict(set)
        for pack_id, md_id in MdPackCard.objects.filter(md_print__is_alt_art=True).values_list("pack_id", "md_print_id"):
            usual[pack_id].add(md_id)
        rows = list(rows)
        # each campaign's version and each older lineup of a pack shows as a pack of its own, at the days it was sold,
        # under its cover then (엘리스 10/13: "표지별로 다른 카드팩마냥")
        versions = list(MdPackVersion.objects.filter(pack_id__in=[p.id for p in rows]).select_related("pack"))
        # today's lineup came in a campaign's art from the day it began: the usual pack dates from the day it first
        # sold without, and waits out a campaign still running (엘리스 10/13)
        dressed = defaultdict(list)
        for v in versions:
            if v.swaps and not v.missing and not v.extra:
                dressed[v.pack_id].append((v.start, v.end))
        listed, by_id = [], {}
        for p in rows:
            row = by_id[p.id] = {**_row(p, {r: getattr(p, r) for r in rarities}), "version": None, "period": None,
                                 "featured": [], "arts": count(usual[p.id])}
            since = p.changed or p.released
            for start, end in sorted(dressed[p.id]):
                if since and start <= since < end:
                    since = end
            if since:
                row["released"] = since.isoformat()
            if not since or since <= _today():
                listed.append(row)
        names = {m.md_id: display_name(m.card) for m in MdPrint.objects.filter(
            md_id__in={a for v in versions for a in v.swaps.values()}).select_related("card")}
        held = dict(((pack_id, md_id), rarity) for pack_id, md_id, rarity in MdPackCard.objects.filter(
            pack_id__in={v.pack_id for v in versions if v.missing}).values_list("pack_id", "md_print_id", "rarity"))
        for v in versions:
            arts = sorted(set(v.swaps.values()))
            counts = dict(by_id[v.pack_id]["counts"])   # an older lineup: without the cards added since, with those removed
            for md_id in v.missing:
                if (v.pack_id, md_id) in held:
                    counts[held[(v.pack_id, md_id)]] -= 1
            for rarity in v.extra.values():
                counts[rarity] = counts.get(rarity, 0) + 1
            listed.append({**by_id[v.pack_id], "version": v.id, "released": v.start.isoformat(), "counts": counts,
                           "period": [v.start.isoformat(), v.end.isoformat()],
                           "image": _image(v.pack, cover=v.cover) or by_id[v.pack_id]["image"],
                           "featured": [names[a] for a in arts if a in names], "arts": count(arts)})
        listed.sort(key=lambda r: r["name_en"])
        listed.sort(key=lambda r: r["released"] or "", reverse=True)
        _cache["packs"] = listed
    return Response({"packs": _cache["packs"]})


class _Pickup:
    __slots__ = ("card", "name", "norms", "cho", "packs")


def _pickups():
    """The cards packs are searched by (엘리스 10/13 "팩 수록 카드 X 픽업 카드 O"): a secret pack's pickup cards and a
    selection pack's own, not the master pack's (it holds nearly every card); each card once, its names made
    searchable as the card dex makes them, with the packs it is in."""
    _fresh()
    if _cache["pickups"] is None:
        in_packs, released = {}, {}
        for pack_id, card_id, day in (MdPackCard.objects.filter(pack__kind__in=OPENABLE).exclude(pack__name_en=MASTER_PACK)
                                      .values_list("pack_id", "md_print__card_id", "pack__released")):
            in_packs.setdefault(card_id, set()).add(pack_id)
            released[pack_id] = day.toordinal() if day else 0
        # and the cards an older lineup held, removed since
        gone = defaultdict(set)
        for pack_id, extra, day in (MdPackVersion.objects.filter(pack__kind__in=OPENABLE).exclude(extra={})
                                    .values_list("pack_id", "extra", "pack__released")):
            for md_id in extra:
                gone[int(md_id)].add(pack_id)
            released.setdefault(pack_id, day.toordinal() if day else 0)
        for md_id, card_id in MdPrint.objects.filter(md_id__in=gone).values_list("md_id", "card_id"):
            in_packs.setdefault(card_id, set()).update(gone[md_id])
        rows = []
        for card in Card.objects.filter(id__in=in_packs):
            r = _Pickup()
            r.card, r.name = card.id, display_name(card)
            r.packs = sorted(in_packs[card.id], key=lambda p: (-released[p], p))   # newest first
            r.norms = [dex._norm(n) for n in (card.name_ko, card.name_ja, card.name_en) if n]
            r.cho = dex.choseong(dex._norm(card.name_ko))
            rows.append(r)
        _cache["pickups"] = rows
    return _cache["pickups"]


@api_view(["GET"])
@permission_classes([AllowAny])
def pack_search(request):
    """Packs by their pickup cards: the packs holding the cards that match the query (as the card dex matches: exact,
    then the start, then anywhere; or 초성), the best match first, each with how many of its cards match and the
    names of the first three."""
    q = request.query_params.get("q") or ""
    if not "".join(q.split()):
        return Response({"packs": []})
    found = {}
    for r in dex._rank(_pickups(), q):
        for pack_id in r.packs:
            hit = found.setdefault(pack_id, {"id": pack_id, "cards": [], "count": 0})
            hit["count"] += 1
            if len(hit["cards"]) < 3:
                hit["cards"].append(r.name)
    return Response({"packs": list(found.values())})


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
        row["versions"], _cache["lineups"][pack_id] = _versions(p, row["cards"])
        if p.kind == MdPack.Kind.SECRET:
            master = MdPack.objects.filter(name_en=MASTER_PACK, kind=MdPack.Kind.NORMAL).first()
            row["master_pack"] = master.id if master else None
        _cache["cards"][pack_id] = row
    return _cache["cards"][pack_id]


def _versions(pack, cards):
    """The pack as campaigns and its older lineups sold it (MdPackVersion): each version's days, cover, the cards that
    came in their campaign art, the cards it held that were removed since and how many of today's it did not hold yet,
    and its whole lineup — today's without the cards added since, with those removed since, and those cards in that
    art (a card with no face drawn is left out, and an art with none keeps the usual one)."""
    versions = list(pack.versions.all())
    prints = {p.md_id: p for p in MdPrint.objects.filter(
        md_id__in={a for v in versions for a in v.swaps.values()} | {int(m) for v in versions for m in v.extra}
    ).select_related("card")}

    def face(p, rarity, **more):
        return {"print": p.md_id, "card": p.card_id, "name": display_name(p.card), "rarity": rarity,
                "thumb": face_thumb_url(p.md_id), "face": face_url(p.md_id), **more}

    rows, lineups = [], {}
    for v in versions:
        swaps = {int(base): art for base, art in v.swaps.items()}
        missing = set(v.missing) & {c["print"] for c in cards}
        gone = [face(prints[int(m)], rarity) for m, rarity in v.extra.items()
                if int(m) in prints and face_thumb_url(int(m))]
        lineup, shown = [], []
        for c in [c for c in cards if c["print"] not in missing] + gone:
            art = prints.get(swaps.get(c["print"]))
            if art and face_thumb_url(art.md_id):
                # the art at its own rarity: 키스킬's SR comes as a UR in its campaign art (엘리스 10/13)
                c = face(art, art.rarity or c["rarity"], base=c["print"])
                shown.append(c)
            lineup.append(c)
        if shown or gone or missing:
            rows.append({"id": v.id, "start": v.start.isoformat(), "end": v.end.isoformat(),
                         "image": _image(pack, cover=v.cover), "image_hd": _image(pack, hd=True, cover=v.cover),
                         "arts": shown, "gone": gone, "later": len(missing), "cards": lineup})
            lineups[v.id] = lineup
    return rows, lineups


@api_view(["GET"])
@permission_classes([AllowAny])
def pack(request, pack_id):
    """A pack and its cards, each at the rarity it comes in there, with its face, and the versions campaigns sold of
    it; a secret pack names the master pack its first four cards come from."""
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


class OpenThrottle(SimpleRateThrottle):
    """Per address, members and guests alike: far more packs than a person opens, far fewer than a script wants."""
    rate = "600/hour"

    def get_cache_key(self, request, view):
        return f"throttle_pack_open_{self.get_ident(request)}"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([OpenThrottle])
def open_pack(request, pack_id):
    """Buy one or ten packs with gems (GEMS_PER_PACK a pack): the server draws them (pack_draw) and keeps a member's
    tally of the pack (and the UR owed after ten without one); the cards, the gems left and the tally. The cards are
    not kept: the beta opens packs for the thrill alone, free and open to guests (엘리스 2026-10-13). A guest's tally
    lives in their browser, which says whether a UR is owed (`owed`); theirs is this opening's alone."""
    try:
        count = int(request.data.get("count", 1))
    except (TypeError, ValueError):
        count = 0
    if count not in (1, 10):
        return Response({"error": "1팩 또는 10팩만 살 수 있습니다."}, status=400)
    row = _detail(pack_id)
    if row is None:
        raise Http404
    cards = row["cards"]
    version = request.data.get("version")
    if version not in (None, ""):   # the pack as a campaign sold it
        cards = _cache["lineups"].get(pack_id, {}).get(int(version)) if str(version).isdigit() else None
        if cards is None:
            return Response({"error": "그 시기의 팩을 찾지 못했습니다."}, status=400)
    pools = {"main": _pool(cards), "master": None}
    if row["kind"] == MdPack.Kind.SECRET:
        master = _detail(row.get("master_pack")) if row.get("master_pack") else None
        if not master:
            return Response({"error": "마스터 팩을 찾지 못했습니다."}, status=503)
        pools["master"] = _pool(master["cards"])
    if not cards:
        return Response({"error": "이 팩에는 열 수 있는 카드가 없습니다."}, status=400)
    user = request.user
    if not user.is_authenticated:
        if GEMS_PER_PACK:
            return Response({"error": "로그인하면 팩을 열 수 있습니다."}, status=401)
        owed = request.data.get("owed") is True
        packs, owed = ([draw_pack(pools, _rng)], owed) if count == 1 else draw_ten(pools, owed, _rng)
        flat = [c for p in packs for c in p]
        return Response({
            "packs": [[{**c["card"], "rarity": c["rarity"], "finish": c["finish"]} for c in p] for p in packs],
            "gems": 0, "tally": {"gems": 0, "packs": count, "ur": sum(c["rarity"] == "UR" for c in flat),
                                 "sr": sum(c["rarity"] == "SR" for c in flat), "owed": owed},
        })
    with transaction.atomic():
        tally, _ = PackTally.objects.get_or_create(user=user, pack_id=pack_id)
        gems = user.gems
        if GEMS_PER_PACK:
            try:
                gems = change_gems(user, -GEMS_PER_PACK * count, kind="pack_purchase", note=f"{row['name']} {count}팩")
            except NotEnoughGems as e:
                return Response({"error": "젬이 부족합니다.", "gems": e.held}, status=400)
        if count == 1:
            packs, owed = [draw_pack(pools, _rng)], tally.owed
        else:
            packs, owed = draw_ten(pools, tally.owed, _rng)
        flat = [c for p in packs for c in p]
        tally.gems += GEMS_PER_PACK * count
        tally.packs += count
        tally.ur += sum(c["rarity"] == "UR" for c in flat)
        tally.sr += sum(c["rarity"] == "SR" for c in flat)
        tally.owed = owed
        tally.save()
    return Response({
        "packs": [[{**c["card"], "rarity": c["rarity"], "finish": c["finish"]} for c in p] for p in packs],
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
