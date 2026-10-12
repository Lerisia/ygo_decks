"""The pack simulator's data (엘리스 2026-10-12): the packs one can open and the cards in each. The draw itself runs in
the browser (frontend utils/packDraw.ts)."""
import os

from django.conf import settings
from django.db.models import Count, Max, Q
from django.http import Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .display import display_name
from .face import face_thumb_url, face_url
from .models import MdPack, MdPackCard

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


@api_view(["GET"])
@permission_classes([AllowAny])
def pack(request, pack_id):
    """A pack and its cards, each at the rarity it comes in there, with its face; a secret pack names the master pack
    its first four cards come from."""
    _fresh()
    if pack_id not in _cache["cards"]:
        p = MdPack.objects.filter(id=pack_id, kind__in=OPENABLE).first()
        if not p:
            raise Http404
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
    return Response(_cache["cards"][pack_id])
