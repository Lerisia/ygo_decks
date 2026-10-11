import hashlib
import json
import multiprocessing as mp
import os
import random

from django.conf import settings
from django.core.management.base import BaseCommand

from card import scan_dataset as sd

MAX_SIDE = 1280
SIZES = [(640, 480), (480, 640), (800, 600), (600, 800), (1024, 768), (400, 580), (580, 400), (1280, 720), (720, 1280)]


def _save(out, split, name, img, labels):
    if max(img.size) > MAX_SIDE:
        k = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), sd.Image.LANCZOS)
        labels = [(c, tuple(v * k for v in b)) for c, b in labels]
    img.convert("RGB").save(os.path.join(out, "images", split, name + ".jpg"), quality=92)
    with open(os.path.join(out, "labels", split, name + ".txt"), "w") as f:
        f.write("\n".join(sd.yolo_lines(labels, img.width, img.height)))


def _card_h(boxes):
    return sorted(b[3] - b[1] for b in boxes)[len(boxes) // 2] if boxes else None


def _open(path):
    img = sd.Image.open(path)
    img.load()
    return img.convert("RGB")


def _task(task):
    """One training picture (or a few) from a task tuple; returns how many were written."""
    kind, out, split, name, seed, data = task
    rng = random.Random(seed)
    if kind == "real":
        row, path = data
        _save(out, split, name, _open(path), sd.real_labels(row))
        return 1
    if kind == "shrunk":   # a whole real picture shrunk and recompressed like a thumbnail passed around
        row, path = data
        img = _open(path)
        small = sd.degrade(img, rng, rng.choice([96, 128, 200, 300, 480]), card_h=_card_h(row["cards"]))
        k = small.width / img.width
        _save(out, split, name, small, [(c, tuple(v * k for v in b)) for c, b in sd.real_labels(row)])
        return 1
    if kind == "window":
        row, path = data
        img = _open(path)
        window = sd.pick_window(rng, row["cards"], img.width, img.height)
        labels = sd.window_labels(sd.real_labels(row), window)
        crop = img.crop(tuple(round(v) for v in window))
        small = sd.degrade(crop, rng, card_h=_card_h(row["cards"]))
        k = small.width / crop.width
        _save(out, split, name, small, [(c, tuple(v * k for v in b)) for c, b in labels])
        return 1
    if kind == "composed":
        faces, bg = data
        size = rng.choice(SIZES)
        if bg and rng.random() < 0.6:
            row, path = bg
            background = sd.background_crop(_open(path), row["cards"], rng, size) or sd.plain_background(rng, size)
        else:
            background = sd.plain_background(rng, size)
        img, labels = sd.compose_cards([_open(f) for f in faces], background, rng)
        small = sd.degrade(img, rng, rng.choice([128, 200, 300, 480, 640, 800, 1024]),
                           card_h=_card_h([b for _, b in labels]) if labels else None)
        k = small.width / img.width
        _save(out, split, name, small, [(c, tuple(v * k for v in b)) for c, b in labels])
        return 1
    if kind == "negative":
        face, bg = data
        size = rng.choice(SIZES)
        row, path = bg
        background = sd.background_crop(_open(path), row["cards"], rng, size) or sd.plain_background(rng, size)
        if rng.random() < 0.5:   # a card's picture without its frame is not a card
            art = sd.frameless_art(_open(face), rng)
            background.paste(art, (rng.randrange(max(1, size[0] - art.width)), rng.randrange(max(1, size[1] - art.height))))
        _save(out, split, name, sd.degrade(background, rng), [])
        return 1
    raise ValueError(kind)


class Command(BaseCommand):
    help = ("Build the detector's YOLO training set from scan_pseudo_labels: real uploads it is sure of, windows and "
            "thumbnails cut from them, composed card faces and pictures with no card; the test set's pictures stay out.")

    def add_arguments(self, parser):
        parser.add_argument("--labels", default="/home/elyss/storage/scanner/pseudo/labels.jsonl")
        parser.add_argument("--out", default="/home/elyss/storage/scanner/dataset_v1")
        parser.add_argument("--remote-root", default="I:/yugioh_ai_training/yolo/datasets/scan_v1",
                            help="where the set will sit on the training PC (data.yaml's path)")
        parser.add_argument("--windows", type=int, default=8000)
        parser.add_argument("--shrunk", type=int, default=800)
        parser.add_argument("--composed", type=int, default=5000)
        parser.add_argument("--negatives", type=int, default=1200)
        parser.add_argument("--val", type=float, default=0.05)
        parser.add_argument("--workers", type=int, default=16)
        parser.add_argument("--seed", type=int, default=2026)
        parser.add_argument("--test-digests", default="", help="file of the test set's picture digests (one a line) "
                            "when this database doesn't hold the test set")

    def handle(self, *args, **opts):
        from card.models import ScanSample
        rng = random.Random(opts["seed"])
        out = opts["out"]
        for split in ("train", "val"):
            os.makedirs(os.path.join(out, "images", split), exist_ok=True)
            os.makedirs(os.path.join(out, "labels", split), exist_ok=True)
        if opts["test_digests"]:
            test = set(open(opts["test_digests"]).read().split())
        else:
            test = set(ScanSample.objects.values_list("digest", flat=True))
        rows = []
        with open(opts["labels"]) as f:
            for line in f:
                r = json.loads(line)
                if "error" in r or not r.get("cards"):
                    continue
                path = os.path.join(settings.MEDIA_ROOT, r["upload"], "input.jpg")
                with open(path, "rb") as img:
                    if hashlib.sha1(img.read()).hexdigest()[:16] in test:
                        continue   # the test set (or the same picture uploaded again) never trains
                rows.append((r, path))
        sure = [x for x in rows if x[0]["sure"]]
        rng.shuffle(sure)
        n_val = max(1, int(len(sure) * opts["val"]))
        split_of = {x[0]["upload"]: ("val" if i < n_val else "train") for i, x in enumerate(sure)}
        train_sure = [x for x in sure if split_of[x[0]["upload"]] == "train"]
        faces_dir = os.path.join(settings.MEDIA_ROOT, "cards", "face")
        faces = [os.path.join(faces_dir, f) for f in os.listdir(faces_dir) if f.endswith(".webp")]
        tasks = []
        for r, path in sure:
            tasks.append(("real", out, split_of[r["upload"]], f"real_{r['upload'][7:]}", rng.random(), (r, path)))
        pools = {"window": opts["windows"], "shrunk": opts["shrunk"]}
        for kind, n in pools.items():
            for i in range(n):
                r, path = train_sure[rng.randrange(len(train_sure))]
                split = "val" if rng.random() < opts["val"] else "train"
                pick = (r, path) if split == "train" else sure[rng.randrange(n_val)]
                tasks.append((kind, out, split, f"{kind}_{i:05d}", rng.random(), pick))
        bgs = [x for x in rows if len(x[0]["cards"]) >= 3]
        for i in range(opts["composed"]):
            split = "val" if rng.random() < opts["val"] else "train"
            tasks.append(("composed", out, split, f"composed_{i:05d}", rng.random(),
                          ([faces[rng.randrange(len(faces))] for _ in range(4)], bgs[rng.randrange(len(bgs))])))
        for i in range(opts["negatives"]):
            split = "val" if rng.random() < opts["val"] else "train"
            tasks.append(("negative", out, split, f"negative_{i:05d}", rng.random(),
                          (faces[rng.randrange(len(faces))], bgs[rng.randrange(len(bgs))])))
        self.stdout.write(f"{len(rows)} labelled uploads, {len(sure)} sure ({n_val} for val), {len(tasks)} pictures to make")
        done = 0
        with mp.get_context("fork").Pool(opts["workers"]) as pool:
            for n in pool.imap_unordered(_task, tasks, chunksize=8):
                done += n
                if done % 2000 == 0:
                    self.stdout.write(f"{done}/{len(tasks)}")
        with open(os.path.join(out, "data.yaml"), "w") as f:
            f.write(f"path: {opts['remote_root']}\ntrain: images/train\nval: images/val\n"
                    f"nc: {len(sd.CLASSES)}\nnames: {json.dumps(sd.CLASSES)}\n")
        self.stdout.write(f"made {done} pictures in {out}")
