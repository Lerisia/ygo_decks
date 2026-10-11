"""Which card a picture is (엘리스 2026-10-12): a ConvNeXt-Tiny turns the whole card into a 512-number fingerprint, and
the nearest fingerprint in the gallery (every Master Duel print's face, drawn with its text) names the print and so
the card. A new card needs only its face added to the gallery (manage.py build_card_gallery), never retraining.
Below UNKNOWN the picture is taken for no card at all: other games' cards, memes, pictures past reading.

The model is trained on the PC (storage/scanner/train/train_card_id.py): Net and the input here must stay as there.
Files, not in the repo: card/card_id.pt (the weights) and card/card_gallery.pt ({md_ids, card_ids, emb}).
"""
import os
import threading
from collections import namedtuple
from functools import lru_cache

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision
from django.conf import settings
from PIL import Image

W, H = 160, 224                     # the input: a card's shape
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
UNKNOWN = 0.5                       # below this similarity, no card (10/11: what fell below was not a card)
FACE_SIZE = (352, 512)              # the gallery's faces, as the training's
THREADS = 4                         # the rest of the CPU stays with the site

Match = namedtuple("Match", "card_id md_id similarity")
_lock = threading.Lock()


def model_path():
    return os.path.join(settings.BASE_DIR, "card", "card_id.pt")


def gallery_path():
    return os.path.join(settings.BASE_DIR, "card", "card_gallery.pt")


class Net(nn.Module):
    def __init__(self, dim=512):
        super().__init__()
        self.features = torchvision.models.convnext_tiny(weights=None).features
        self.norm = nn.LayerNorm(768)
        self.fc = nn.Linear(768, dim)
        self.bn = nn.BatchNorm1d(dim)

    def forward(self, x):
        f = self.features(x).mean((2, 3))
        return F.normalize(self.bn(self.fc(self.norm(f))), dim=1)


def tensor(img):
    """A picture as the model takes it: RGB, resized to the input, normalised."""
    img = img.convert("RGB").resize((W, H), Image.BILINEAR)
    t = torch.frombuffer(bytearray(img.tobytes()), dtype=torch.uint8).view(H, W, 3).permute(2, 0, 1)
    return (t.float() / 255 - MEAN) / STD


def shrunk(img, width=80):
    """A face as small as cards are in uploads, then back up: the gallery's second view of each print."""
    img = img.convert("RGB")
    return img.resize((width, int(width * img.height / img.width)), Image.BILINEAR)


@lru_cache(maxsize=1)
def _model():
    torch.set_num_threads(min(THREADS, os.cpu_count() or 1))
    net = Net()
    net.load_state_dict(torch.load(model_path(), map_location="cpu", weights_only=True)["net"])
    return net.eval()


_held = {}


def _gallery():
    """The gallery, read again whenever its file changes (build_card_gallery runs apart from the site's processes)."""
    mtime = os.stat(gallery_path()).st_mtime_ns
    if _held.get("mtime") != mtime:
        g = torch.load(gallery_path(), map_location="cpu", weights_only=True)
        _held.update(mtime=mtime, gallery=([int(x) for x in g["md_ids"]], [int(x) for x in g["card_ids"]], g["emb"]))
    return _held["gallery"]


def forget():
    """Read the model and the gallery again on next use."""
    _model.cache_clear()
    _held.clear()


@torch.no_grad()
def fingerprints(images, batch=32):
    """The model's fingerprints (unit vectors) of PIL images."""
    if not images:
        return torch.zeros(0, 512)
    net = _model()
    out = []
    with _lock:
        for i in range(0, len(images), batch):
            out.append(net(torch.stack([tensor(im) for im in images[i:i + batch]])))
    return torch.cat(out)


def face_fingerprints(faces):
    """A print's gallery fingerprint: its face as it is and shrunk to upload size, averaged."""
    return F.normalize(fingerprints(faces) + fingerprints([shrunk(f) for f in faces]), dim=1)


def nearest(queries, md_ids, card_ids, emb):
    """Each query's nearest print: a Match, its card None below UNKNOWN."""
    if not len(queries):
        return []
    best = (queries @ emb.T).max(dim=1)
    out = []
    for sim, i in zip(best.values.tolist(), best.indices.tolist()):
        known = sim >= UNKNOWN
        out.append(Match(card_ids[i] if known else None, md_ids[i] if known else None, round(sim, 4)))
    return out


def identify(images):
    """Which card each picture (a whole card, as the detector cuts it) is: [Match]."""
    return nearest(fingerprints(images), *_gallery())
