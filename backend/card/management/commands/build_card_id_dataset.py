"""Training data for the scanner's card identifier (엘리스 2026-10-11): which card a box holds is told by an embedding
(the box's fingerprint against every print's, so a new card only needs its own), and its 가공 (베이직 / 샤인 / 로얄) by a
small classifier.

<out>/faces/<md_id>.webp      every print's face with its Korean text, 352×512 (the 베이직 look, and what the finishes
                               are drawn over)
<out>/render_jobs.jsonl       the 샤인 / 로얄 pictures to draw: mdpipeline/finish_render.py <bundle> <jobs> <out>/renders
                               (a few moments and lights each; 로얄 only for SR and UR, as in the game)
<out>/real/<record>_<k>.jpg   card boxes cut from real uploads, named by the current scanner when it was sure
<out>/prints.csv              md_id, card_id, name, rarity, frame, overframe, split: "unseen" prints (about 2%, whole cards) are
                               left out of training, to measure how new cards are told
<out>/real.csv                path, card_id, md_id, record, confidence, split: train / val (one upload in ten) / unseen
"""
import csv
import hashlib
import json
import math
import multiprocessing
import os
import random
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connections
from PIL import Image

from card.models import CardDetection, ScanSample
from carddb.dex import _finish, _overframe
from carddb.display import art_names
from carddb.face import draw_face
from carddb.models import Card, MdPrint

FACE_SIZE = (352, 512)
RENDERS = 3            # per finish and print
ROYAL_RARITIES = {"SR", "UR"}   # N and R cards come in 베이직 and 샤인 only (엘리스 10/11)
MIN_CONFIDENCE = 0.95
REAL_PER_CARD = 40


def _unseen(card_id):
    return int(hashlib.md5(str(card_id).encode()).hexdigest(), 16) % 50 == 0


def _face(job):
    card, md_id, out = job
    path = os.path.join(out, "faces", f"{md_id}.webp")
    if not os.path.exists(path):
        draw_face(card, with_text=True, art_id=md_id).resize(FACE_SIZE, Image.LANCZOS).save(path, quality=92)
    return md_id


def _light(rng):
    """Toward the light: anywhere from straight in front of the card down to 25° above it."""
    up, around = math.radians(rng.uniform(25, 90)), rng.uniform(0, 2 * math.pi)
    return [math.cos(up) * math.cos(around), math.cos(up) * math.sin(around), -math.sin(up)]


class Command(BaseCommand):
    help = "Build the card identifier's training data (faces with text, finish jobs, real boxes)."

    def add_arguments(self, parser):
        parser.add_argument("--out", default="/home/elyss/storage/scanner/card_id_v1")
        parser.add_argument("--workers", type=int, default=16)

    def handle(self, *args, **opts):
        out = opts["out"]
        for d in ("faces", "renders", "real"):
            os.makedirs(os.path.join(out, d), exist_ok=True)
        with_art = set(art_names())
        cards = Card.objects.in_bulk(set(Card.objects.values_list("id", flat=True)) & with_art)
        prints = [(card_id, card_id) for card_id in cards]
        prints += [(card_id, md_id) for md_id, card_id in MdPrint.objects.filter(is_alt_art=True).values_list("md_id", "card_id")
                   if card_id in cards and md_id in with_art]
        prints.sort(key=lambda p: p[1])
        rarity = dict(MdPrint.objects.exclude(rarity="").values_list("md_id", "rarity"))
        rarity_of = {md_id: rarity.get(md_id) or rarity.get(card_id, "") for card_id, md_id in prints}

        with open(os.path.join(out, "prints.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["md_id", "card_id", "name", "rarity", "frame", "overframe", "split"])
            finishes = {}
            for card_id, md_id in prints:
                card = cards[card_id]
                fin = _finish(card)
                if _overframe(md_id):
                    fin["frame"] = "overframe"
                finishes[md_id] = fin
                w.writerow([md_id, card_id, card.name_ko or card.name_ja, rarity_of[md_id], fin["frame"],
                            int(fin["frame"] == "overframe"),
                            "unseen" if _unseen(card_id) else "train"])

        connections.close_all()
        jobs = [(cards[card_id], md_id, out) for card_id, md_id in prints]
        with multiprocessing.Pool(opts["workers"]) as pool:
            for k, _ in enumerate(pool.imap_unordered(_face, jobs, chunksize=20), 1):
                if k % 2000 == 0:
                    self.stdout.write(f"{k}/{len(jobs)} faces")
        self.stdout.write(f"{len(jobs)} faces")

        jobs = 0
        with open(os.path.join(out, "render_jobs.jsonl"), "w") as f:
            for card_id, md_id in prints:
                rng = random.Random(md_id)
                fin = finishes[md_id]
                for style in ("shine", "royal") if rarity_of[md_id] in ROYAL_RARITIES else ("shine",):
                    for k in range(RENDERS):
                        f.write(json.dumps({
                            "face": os.path.join(out, "faces", f"{md_id}.webp"), "out": f"{md_id}_{style}{k}.webp",
                            "style": style, "time": round(rng.uniform(0, 120), 2), "light": _light(rng),
                            "intensity": round(rng.uniform(0.75, 1.25), 2), "attribute": fin["attribute"],
                            "level": fin["level"], "frame": fin["frame"]}) + "\n")
                        jobs += 1
        self.stdout.write(f"{jobs} finish jobs")

        tested = {int(s.split(":")[1]) for s in ScanSample.objects.values_list("source", flat=True) if s.startswith("upload:")}
        two_arts = set(MdPrint.objects.filter(is_alt_art=True).values_list("card_id", flat=True))
        found = {}
        for record, illust, card_id, conf in (CardDetection.objects.filter(confidence__gte=MIN_CONFIDENCE, new_card__isnull=False)
                                              .exclude(record_id__in=tested).exclude(new_card_id__in=two_arts)
                                              .values_list("record_id", "illust_image", "new_card_id", "confidence")):
            if card_id in cards:
                found.setdefault(card_id, []).append((record, illust, conf))
        rows = []
        for card_id, hits in found.items():
            rng = random.Random(card_id)
            rng.shuffle(hits)
            for record, illust, conf in hits[:REAL_PER_CARD]:
                src = os.path.join(settings.MEDIA_ROOT, illust.replace("/illusts/", "/cards/").replace("illust_", "card_"))
                if not os.path.exists(src):
                    continue
                name = f"{record}_{os.path.basename(src)[5:]}"
                shutil.copyfile(src, os.path.join(out, "real", name))
                split = "unseen" if _unseen(card_id) else "val" if record % 10 == 0 else "train"
                rows.append([f"real/{name}", card_id, card_id, record, round(conf, 4), split])
        with open(os.path.join(out, "real.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["path", "card_id", "md_id", "record", "confidence", "split"])
            w.writerows(rows)
        self.stdout.write(f"{len(rows)} real boxes of {len(found)} cards")
