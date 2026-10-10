"""Small square card thumbnails for the tracker overlay, cut from the Master Duel art on first request and cached
under media/card_thumbs_md/. Kept out of views.py so this endpoint never imports the classifier stack."""
import os

from django.conf import settings
from django.http import JsonResponse, Http404, HttpResponseRedirect
from PIL import Image

from carddb.display import art_path

SIZE = 48


def card_thumb(request, konami_id):
    # Only the tracker asks for these, and only a build the site still supports gets them (?v=<its version>): builds up
    # to 0.6.11 never said who they were, so a build the site has refused loses the pictures in its card lists too.
    from tracker import version as ver
    if ver.is_outdated(request.GET.get("v") or "", ver.MIN_SUPPORTED):
        return JsonResponse({"error": "새 버전으로 업데이트해 주세요. 이 버전은 더 이상 쓸 수 없습니다.", "min_supported": ver.MIN_SUPPORTED}, status=426)
    from carddb.models import MdPrint
    base = MdPrint.objects.filter(md_id=konami_id).values_list("card_id", flat=True).first() or konami_id
    src = art_path(base)
    if not src:
        raise Http404
    out_dir = os.path.join(settings.MEDIA_ROOT, "card_thumbs_md")
    name = f"{base}_{SIZE}.jpg"
    out = os.path.join(out_dir, name)
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
        os.makedirs(out_dir, exist_ok=True)
        try:
            with Image.open(src) as im:
                im = im.convert("RGB")
                w, h = im.size
                s = min(w, h)
                im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((SIZE, SIZE), Image.LANCZOS)
                im.save(out, "JPEG", quality=82)
        except (OSError, ValueError):
            raise Http404
    return HttpResponseRedirect(f"{settings.MEDIA_URL}card_thumbs_md/{name}")
