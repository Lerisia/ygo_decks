"""Small square card thumbnails for the tracker overlay, cut from the illustration on first request and cached
under media/card_thumbs/. Kept out of views.py so this endpoint never imports the classifier stack."""
import os

from django.conf import settings
from django.http import Http404, HttpResponseRedirect
from PIL import Image

from .models import Card, CardIdAlias

SIZE = 48


def card_thumb(request, konami_id):
    alias = CardIdAlias.objects.filter(md_id=konami_id).select_related("card").first()
    card = alias.card if alias else Card.objects.filter(konami_id=str(konami_id)).exclude(card_illust="").first()
    if not card or not card.card_illust:
        raise Http404
    out_dir = os.path.join(settings.MEDIA_ROOT, "card_thumbs")
    name = f"{card.konami_id}_{SIZE}.jpg"
    out = os.path.join(out_dir, name)
    if not os.path.exists(out):
        os.makedirs(out_dir, exist_ok=True)
        try:
            with Image.open(card.card_illust.path) as im:
                im = im.convert("RGB")
                w, h = im.size
                s = min(w, h)
                im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((SIZE, SIZE), Image.LANCZOS)
                im.save(out, "JPEG", quality=82)
        except (OSError, ValueError):
            raise Http404
    return HttpResponseRedirect(f"{settings.MEDIA_URL}card_thumbs/{name}")
