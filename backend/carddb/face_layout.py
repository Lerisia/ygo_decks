"""Operators' card-face layout page (/dev/cardlayout, 참혈 2026-10-14): the letters' layout as face.py draws them, the
face of a print with every letter left off, its letters, and the free fonts and kind icons in the face assets, so the
browser can set the letters itself while the layout is tuned. Nothing is written: the faces drawn stay as they are."""
import os
import re
from functools import lru_cache

from django.conf import settings
from django.core.cache import cache
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from . import face
from .dex import _overframe
from .models import MdPrint

# one print of each kind (read off the card book 10/14); a missing one is left out
SAMPLES = [
    ("일반", 4007), ("효과", 12950), ("의식", 4737), ("융합", 6344), ("싱크로", 7734), ("엑시즈", 9575), ("링크", 13036),
    ("펜듈럼", 11213), ("엑시즈 펜듈럼", 11835), ("마법", 13619), ("일반 마법", 4844), ("함정", 5740),
    ("오버프레임", 22789), ("긴 이름", 10936), ("대체 글자", 7331),
]
FONT_FILE = re.compile(r"^[\w.-]+\.(otf|ttf)$")
BARE_TTL = 600


@lru_cache(maxsize=32)
def _font_info(path, mtime):
    from fontTools.ttLib import TTFont
    f = TTFont(path, lazy=True)
    names = f["name"]
    info = {
        "file": os.path.basename(path),
        "family": names.getDebugName(16) or names.getDebugName(1) or "",
        "style": names.getDebugName(17) or names.getDebugName(2) or "",
        "weight": f["OS/2"].usWeightClass, "upm": f["head"].unitsPerEm,
        "ascender": f["hhea"].ascent, "descender": f["hhea"].descent, "bytes": os.path.getsize(path),
        "instances": {},
    }
    if "fvar" in f:
        axes = {a.axisTag: (a.minValue, a.maxValue) for a in f["fvar"].axes}
        info["weight_range"] = list(axes.get("wght", (info["weight"], info["weight"])))
        for inst in f["fvar"].instances:
            if "wght" in inst.coordinates:
                info["instances"][names.getDebugName(inst.subfamilyNameID)] = inst.coordinates["wght"]
    return info


def _fonts():
    """The free fonts in the face assets with what the browser needs to set them as PIL does: FreeType puts a line's
    middle and top from hhea (ascender, descender), rounded out to whole pixels."""
    root = settings.CARD_FACE_ASSETS
    try:
        files = sorted(n for n in os.listdir(root) if FONT_FILE.match(n))
    except OSError:
        return []
    return [_font_info(os.path.join(root, n), os.path.getmtime(os.path.join(root, n))) for n in files]


def _print(md_id):
    return get_object_or_404(MdPrint.objects.select_related("card"), md_id=md_id)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def layout(request):
    found = dict(MdPrint.objects.filter(md_id__in=[m for _, m in SAMPLES]).values_list("md_id", "card__name_ko"))
    return Response({
        "layout": face.LAYOUT, "size": [face.W, face.H], "no_line_start": "".join(sorted(face.NO_LINE_START)),
        "fonts": _fonts(),
        "samples": [{"label": label, "id": m, "name": found[m]} for label, m in SAMPLES if m in found],
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def letters(request, md_id):
    """Every string face.py sets on the print's face, as it sets them."""
    p = _print(md_id)
    c = p.card
    frame = face.frame_key(c)
    monster, pendulum = c.category == "monster", frame.endswith("_pendulum")
    texts = c.texts.filter(lang="ko").first()
    pend, body, normal_monster = face.card_text_parts(c, texts) if texts else ("", "", False)
    label, icon = (None, None) if monster else face.spell_trap_label(c)
    name = c.name_ko or c.name_ja
    return Response({
        "id": p.md_id, "card_id": c.id, "name": name, "category": c.category, "frame": frame,
        "overframe": _overframe(p.md_id), "pendulum": pendulum, "link": frame == "link",
        "type_line": face.type_line(c) if monster else None,
        "stats": face.stat_pieces(c, frame == "link") if monster else None,
        "spell_trap": None if monster else {"label": label, "icon": icon},
        "pendulum_scale": str(c.pendulum_scale) if pendulum and c.pendulum_scale is not None else None,
        "effect": body, "pendulum_effect": pend if pendulum else "", "normal_monster": normal_monster,
        "needs_fallback": face.needs_fallback(name or ""),
        "face_url": face.face_url(p.md_id),
        "prints": [{"id": m, "alt": alt, "overframe": _overframe(m)}
                   for m, alt in c.md_prints.order_by("is_alt_art", "md_id").values_list("md_id", "is_alt_art")],
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def bare(request, md_id):
    """The print's face with no letters (PNG), kept a few minutes in memory: drawing one takes a tenth of a second."""
    p = _print(md_id)
    key = f"face_bare:{p.md_id}:{face.signature(p.card, p.md_id)}"
    png = cache.get(key)
    if png is None:
        import io
        buf = io.BytesIO()
        face.draw_face(p.card, art_id=p.md_id, letters=False).save(buf, "PNG", compress_level=3)
        png = buf.getvalue()
        cache.set(key, png, BARE_TTL)
    res = HttpResponse(png, content_type="image/png")
    res["Cache-Control"] = "private, max-age=600"
    return res


@api_view(["GET"])
@permission_classes([IsAdminUser])
def asset(request, name):
    """A free font file of the face assets, or a spell / trap kind icon."""
    icons = {f"GUI_T_Icon1_Icon{v}.png" for v in face.KIND_ICON.values()}
    if not (FONT_FILE.match(name) or name in icons):
        raise Http404
    path = os.path.join(settings.CARD_FACE_ASSETS, name)
    if not os.path.isfile(path):
        raise Http404
    res = FileResponse(open(path, "rb"), content_type="image/png" if name.endswith(".png") else "font/" + name[-3:])
    res["Cache-Control"] = "private, max-age=86400"
    return res
