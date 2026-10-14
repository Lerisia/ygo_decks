"""Illustrations for the icon pool from the summon cut-ins (엘리스 2026-10-15: "라투디는 초고화질이라 아이콘을 만들기
적합"). A cut-in's figure at rest is the card's monster as the art draws it: laid on the art it lies within half a
pixel, with no turn. So the figure, drawn large, replaces the art's monster where the two agree, and what the art
paints in front of the monster (spray, flames, light) stays as drawn. The art itself is only 512 px; the figure is
the sharp part. "모양을 잘 맞춰봐요. 안 맞으면 못 하는 거고": a figure that does not lie on its art is left out."""
import base64
import json
import queue
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
from django.conf import settings
from django.core.files.base import ContentFile

from avatar.models import CustomIllust
from carddb.models import MdArt, MdPrint

OUT = 2048      # the illustration's longer side (a pendulum monster's art is taller than wide)
ALIGN = 1536    # the render matched against the art
ART = 1024      # the art's longer side, enlarged, for the matching: its features at a scale nearer the render's
DRAW = 3072     # the first render; a figure the art shows larger is drawn again, up to 4096
CLEAN = 0.03    # a figure the art covers this little goes into the pool unseen; more, and someone looks first
KEY = "cutin:{}"   # CustomIllust.source_tweet_id of the illustration made from a print's cut-in
INDEX = "md_ui/cutin/index.json"
FRONTEND = Path(settings.BASE_DIR).parent / "frontend"


def index():
    """Every cut-in the card book plays, by print id: its animation name and version."""
    return json.loads(Path(settings.MEDIA_ROOT, INDEX).read_text())


@dataclass
class Alignment:
    """A similarity from the ALIGN-px render to the ART-px art."""
    M: np.ndarray
    inliers: int
    error: float      # mean, in the art's own pixels
    scale: float
    rotation: float   # degrees

    def fits(self):
        # a figure on the wrong art gets under 10 inliers at some odd angle; a small dark figure on its own art 50
        return self.inliers >= 30 and self.error <= 1.0 and abs(self.rotation) <= 1.0 and 0.3 <= self.scale <= 4


def enlarged(art, side):
    """The art with its longer side `side` px, its shape kept."""
    h, w = art.shape[:2]
    k = side / max(h, w)
    return cv2.resize(art, (round(w * k), round(h * k)), interpolation=cv2.INTER_CUBIC if k < 2.5 else cv2.INTER_LANCZOS4)


def align(figure, art):
    """Where the figure (BGRA, ALIGN px square) lies on the art (BGR), from matching features, or None."""
    big = enlarged(art, ART)
    sift = cv2.SIFT_create(nfeatures=6000)
    art_points, art_descs = sift.detectAndCompute(cv2.cvtColor(big, cv2.COLOR_BGR2GRAY), None)
    alpha = figure[:, :, 3]
    solid = (figure[:, :, :3] * (alpha[:, :, None] / 255.0)).astype(np.uint8)
    points, descs = sift.detectAndCompute(cv2.cvtColor(solid, cv2.COLOR_BGR2GRAY), (alpha > 200).astype(np.uint8) * 255)
    if descs is None or art_descs is None or len(points) < 10 or len(art_points) < 10:
        return None
    good = [pair[0] for pair in cv2.BFMatcher().knnMatch(descs, art_descs, k=2) if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance]
    if len(good) < 6:
        return None
    src = np.float32([points[m.queryIdx].pt for m in good])
    dst = np.float32([art_points[m.trainIdx].pt for m in good])
    M, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=5000)
    if M is None:
        return None
    inliers = inliers.ravel().astype(bool)
    error = np.linalg.norm((src[inliers] @ M[:, :2].T + M[:, 2]) - dst[inliers], axis=1).mean() * max(art.shape[:2]) / ART
    return Alignment(M, int(inliers.sum()), float(error), float(np.hypot(M[0, 0], M[1, 0])), float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))))


def compose(figure, M, art, out=OUT):
    """The figure (BGRA, any square size) laid on the art by M (ALIGN px -> ART px), the art's shape with its longer
    side `out` px: the picture (BGR), the share of the figure the art covers with something else, and the share of
    the picture the figure fills."""
    k = out / 1024
    T = np.hstack([M[:, :2] * (ALIGN / figure.shape[0]), M[:, 2:]]) * (out / ART)
    base = enlarged(art, out).astype(np.float32)
    height, width = base.shape[:2]
    f = figure.astype(np.float32)
    layer = np.dstack([f[:, :, :3] * (f[:, :, 3:4] / 255), f[:, :, 3:4]])   # premultiplied: resampling darkens no edge
    shrink = float(np.hypot(T[0, 0], T[1, 0]))
    if shrink < 1:   # bring it near the output's scale first; warpAffine cannot average pixels away
        layer = cv2.resize(layer, None, fx=shrink, fy=shrink, interpolation=cv2.INTER_AREA)
        T = np.hstack([T[:, :2] / shrink, T[:, 2:]])
    warped = cv2.warpAffine(layer, T, (width, height), flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0, 0))
    alpha = np.clip(warped[:, :, 3:4] / 255, 0, 1)
    colour = np.clip(warped[:, :, :3], 0, 255)
    whole = base * (1 - alpha) + colour
    blur = lambda im: cv2.GaussianBlur(im, (0, 0), 4 * k)
    differs = np.abs(blur(whole) - blur(base)).mean(axis=2)
    solid = alpha[:, :, 0] > 0.95
    covered = float((solid & (differs > 40)).sum() / max(solid.sum(), 1))
    agree = (differs < 30).astype(np.float32)
    agree = cv2.erode(agree, np.ones((int(11 * k) | 1,) * 2, np.uint8))
    agree = cv2.GaussianBlur(agree, (0, 0), 1.5 * k)[:, :, None]
    picture = base * (1 - alpha * agree) + colour * agree
    return picture.clip(0, 255).astype(np.uint8), covered, float((alpha > 0.5).mean())


def art_file(md_id):
    """The art the cut-in was drawn from: the version OCG and TCG share, else the OCG's (the Japanese client's)."""
    arts = {a.version: a for a in MdArt.objects.filter(md_print_id=md_id)}
    for version in ("common", "ocg", "tcg"):
        if version in arts:
            return Path(settings.MEDIA_ROOT, arts[version].image.name)
    return None


def illust_name(print_):
    name = print_.card.name_ko or print_.card.name_ja
    return f"{name}{' 다른 일러스트' if print_.is_alt_art else ''} (고화질)"


def save_illust(print_, data, replace=False):
    """The print's illustration in the icon pool (made once; `replace` draws it again): the row and whether it is new."""
    key = KEY.format(print_.md_id)
    obj = CustomIllust.objects.filter(source_tweet_id=key).first()
    if obj and not replace:
        return obj, False
    created = obj is None
    obj = obj or CustomIllust(source_tweet_id=key)
    obj.name = illust_name(print_)[:100]
    if obj.image:
        obj.image.delete(save=False)
    obj.image.save(f"cutin_{print_.md_id}.webp", ContentFile(data), save=False)
    obj.save()
    return obj, created


def make(md_id, render, out_dir):
    """One print's illustration, `render(size)` drawing its cut-in at rest on a transparent square of that size
    (BGRA). The row says what came of it; one that fits has its picture at out_dir/<md_id>.webp."""
    print_ = MdPrint.objects.select_related("card").filter(md_id=md_id).first()
    row = {"md_id": md_id, "name": illust_name(print_) if print_ else ""}
    if print_ is None:
        return row | {"verdict": "no_print"}
    path = art_file(md_id)
    if path is None:
        return row | {"verdict": "no_art"}
    art = cv2.imread(str(path))
    figure = render(DRAW)
    found = align(cv2.resize(figure, (ALIGN, ALIGN), interpolation=cv2.INTER_AREA), art)
    if found is not None:
        row |= {"inliers": found.inliers, "error": round(found.error, 2), "scale": round(found.scale, 4), "rotation": round(found.rotation, 2)}
    if found is None or not found.fits():
        return row | {"verdict": "unaligned"}
    # about one drawn pixel per shown pixel: a figure the art shows larger than the first render is drawn again
    want = int(min(4096, max(OUT, round(DRAW * found.scale / 256) * 256)))
    if want > DRAW:
        figure = render(want)
    picture, covered, cover = compose(figure, found.M, art)
    file = Path(out_dir, f"{md_id}.webp")
    cv2.imwrite(str(file), picture, [cv2.IMWRITE_WEBP_QUALITY, 92])
    return row | {"verdict": "clean" if covered <= CLEAN else "check", "covered": round(covered, 4), "cover": round(cover, 3), "file": str(file)}


class PoseRenderer:
    """Draws cut-ins at rest in a headless browser with the site's own Spine player (frontend/src/tools/cutinPose.ts,
    bundled into `work` on entry). The page is served from disk, the media folder under /media/. The browser lives
    on its own thread: Playwright's event loop on the main thread would have Django refuse every query."""
    ORIGIN = "http://cutin.local"

    def __init__(self, work):
        self.work = Path(work)

    def __enter__(self):
        subprocess.run([str(FRONTEND / "node_modules/.bin/esbuild"), str(FRONTEND / "src/tools/cutinPose.ts"), "--bundle",
                        "--format=iife", "--log-level=warning", f"--outfile={self.work / 'render.js'}"], check=True)
        (self.work / "index.html").write_text('<!doctype html><meta charset="utf-8"><script src="/render.js"></script>')
        self.requests, self.replies = queue.Queue(), queue.Queue()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self._reply()   # the page is up, or the launch failed
        return self

    def __exit__(self, *exc):
        self.requests.put(None)
        self.thread.join()

    def _reply(self):
        reply = self.replies.get()
        if isinstance(reply, Exception):
            raise reply
        return reply

    def _run(self):
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=["--ignore-gpu-blocklist", "--enable-webgl"])
                page = browser.new_page(viewport={"width": 300, "height": 300})
                page.route(f"{self.ORIGIN}/**", self._serve)
                page.goto(f"{self.ORIGIN}/index.html")
                self.replies.put(True)
                while (request := self.requests.get()) is not None:
                    try:
                        self.replies.put(self._draw(page, *request))
                    except Exception as e:   # noqa: BLE001 — handed to the caller's thread
                        self.replies.put(e)
                browser.close()
        except Exception as e:   # noqa: BLE001
            self.replies.put(e)

    def _serve(self, route):
        path = urlparse(route.request.url).path
        file = Path(settings.MEDIA_ROOT, path[len("/media/"):]) if path.startswith("/media/") else self.work / path.lstrip("/")
        if file.is_file():
            route.fulfill(path=str(file))
        else:
            route.fulfill(status=404)

    def _draw(self, page, md_id, version, size):
        failure = None
        for attempt in range(3):
            if attempt:   # a fresh page: a decode the browser refused, or an empty drawing, after many cut-ins
                page.goto(f"{self.ORIGIN}/index.html")
            try:
                png = page.evaluate(f"renderCutinPose('/media/md_ui/cutin/{md_id}', {version}, {size}).then((r) => r.png)")
            except Exception as e:   # noqa: BLE001
                failure = e
                continue
            image = cv2.imdecode(np.frombuffer(base64.b64decode(png.split(",", 1)[1]), np.uint8), cv2.IMREAD_UNCHANGED)
            if image is not None and image.shape[2] == 4 and image[:, :, 3].any():
                return image
            failure = RuntimeError(f"cut-in {md_id} drew nothing at {size} px")
        raise failure

    def render(self, md_id, version, size):
        """The print's cut-in at rest, fitted on a transparent `size` px square: BGRA."""
        self.requests.put((md_id, version, size))
        return self._reply()
