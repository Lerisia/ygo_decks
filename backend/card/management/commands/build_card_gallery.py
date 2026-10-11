"""The card identifier's gallery (card/identify.py): a fingerprint for every Master Duel print, from its face drawn with
its Korean text as the model learnt them. Run after new cards come in: only prints the gallery lacks are drawn and
added (--all draws every one again, after a new model). Prints gone from the site leave the gallery too."""
import os

import torch
from django.core.management.base import BaseCommand
from PIL import Image

from card import identify
from carddb.face import draw_face
from carddb.models import MdPrint, has_art

BATCH = 32   # faces held at once: all of them would not fit in memory


class Command(BaseCommand):
    help = "Add the prints the card identifier's gallery lacks (or, with --all, draw it again)."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="every print again (after a new model)")

    def handle(self, *args, **opts):
        if not os.path.exists(identify.model_path()):
            self.stdout.write("gallery: no identifier model here, left alone")
            return
        path = identify.gallery_path()
        have = {"md_ids": [], "card_ids": [], "emb": torch.zeros(0, 512)}
        if os.path.exists(path) and not opts["all"]:
            have = torch.load(path, map_location="cpu", weights_only=True)
        prints = dict(MdPrint.objects.filter(has_art("md_id")).values_list("md_id", "card_id"))
        keep = [i for i, m in enumerate(have["md_ids"]) if int(m) in prints]
        md_ids = [int(have["md_ids"][i]) for i in keep]
        card_ids = [prints[m] for m in md_ids]   # a print moved to another card follows it
        embs = [have["emb"][keep]] if keep else []
        todo = sorted(set(prints) - set(md_ids))
        cards = {p.md_id: p.card for p in MdPrint.objects.filter(md_id__in=todo).select_related("card")}
        for i in range(0, len(todo), BATCH):
            chunk = todo[i:i + BATCH]
            faces = [draw_face(cards[m], with_text=True, art_id=m).resize(identify.FACE_SIZE, Image.LANCZOS) for m in chunk]
            embs.append(identify.face_fingerprints(faces))
            md_ids += chunk
            card_ids += [cards[m].id for m in chunk]
            self.stdout.write(f"{min(i + BATCH, len(todo))}/{len(todo)}")
        gone = len(have["md_ids"]) - len(keep)
        if not todo and not gone and not opts["all"] and os.path.exists(path) and card_ids == [int(c) for c in have["card_ids"]]:
            self.stdout.write(f"gallery: {len(md_ids)} prints, nothing new")
            return
        emb = torch.cat(embs) if embs else torch.zeros(0, 512)
        tmp = path + ".tmp"
        torch.save({"md_ids": md_ids, "card_ids": card_ids, "emb": emb}, tmp)
        os.replace(tmp, path)
        identify.forget()
        self.stdout.write(f"gallery: {len(md_ids)} prints ({len(todo)} added, {gone} gone)")
