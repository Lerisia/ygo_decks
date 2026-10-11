import json
import multiprocessing as mp
import os

from django.conf import settings
from django.core.management.base import BaseCommand

_model = None


def _work(args):
    name, path, given = args
    global _model
    import torch
    from PIL import Image, ImageFile
    from card import scan_layout
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    if _model is None and given is None:
        torch.set_num_threads(4)
        from ultralytics import YOLO
        from card.crop import model_path
        _model = YOLO(model_path)
    try:
        img = Image.open(path)
        img.load()
        img = img.convert("RGB")
    except Exception as e:
        return {"upload": name, "error": str(e)[:100]}
    if given is not None:   # found already (the training PC's GPU runs the detector in minutes)
        boxes, confs = given["boxes"], given["confs"]
    else:
        r = _model.predict(img, conf=0.5, verbose=False)[0]
        boxes = r.boxes.xyxy.cpu().numpy().tolist()
        confs = [round(float(c), 3) for c in r.boxes.conf.cpu().numpy()]
    out = scan_layout.layout(img, boxes)
    return {"upload": name, "w": img.width, "h": img.height, "confs": confs, **out}


class Command(BaseCommand):
    help = ("Label the kept uploads for the detector's training: the current detector's card boxes plus the sections, "
            "headings and deck panel worked out from them (card.scan_layout), one JSON line per upload; resumable.")

    def add_arguments(self, parser):
        parser.add_argument("--out", default="/home/elyss/storage/scanner/pseudo/labels.jsonl")
        parser.add_argument("--workers", type=int, default=5)
        parser.add_argument("--limit", type=int, default=0)
        parser.add_argument("--boxes", default="", help="JSONL of card boxes found elsewhere (upload, boxes, confs)")

    def handle(self, *args, **opts):
        os.makedirs(os.path.dirname(opts["out"]), exist_ok=True)
        done = set()
        if os.path.exists(opts["out"]):
            with open(opts["out"]) as f:
                done = {json.loads(line)["upload"] for line in f if line.strip()}
        given = {}
        if opts["boxes"]:
            with open(opts["boxes"]) as f:
                for line in f:
                    r = json.loads(line)
                    if "boxes" in r:
                        given[r["upload"]] = r
        todo = []
        for name in sorted(os.listdir(settings.MEDIA_ROOT)):
            path = os.path.join(settings.MEDIA_ROOT, name, "input.jpg")
            if name.startswith("upload_") and name not in done and os.path.exists(path):
                if opts["boxes"] and name not in given:
                    continue
                todo.append((name, path, given.get(name)))
        if opts["limit"]:
            todo = todo[:opts["limit"]]
        self.stdout.write(f"{len(done)} done, {len(todo)} to go")
        with mp.get_context("spawn").Pool(opts["workers"]) as pool, open(opts["out"], "a") as f:
            for i, row in enumerate(pool.imap_unordered(_work, todo, chunksize=4), 1):
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                if i % 200 == 0:
                    f.flush()
                    self.stdout.write(f"{i}/{len(todo)}")
        self.stdout.write("finished")
