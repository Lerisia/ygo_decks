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
        # a figure on the wrong art gets under 10 inliers at some odd angle; a small dark figure on its own art 50;
        # a true fit's error is 0.2–0.6 px, 1.1 on a busy art (RANSAC's draw), never near 2
        return self.inliers >= 30 and self.error <= 1.5 and abs(self.rotation) <= 1.0 and 0.3 <= self.scale <= 4


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


def _laid(figure, M, base, out):
    """The figure (BGRA, any square size) warped onto the art's enlarged copy `base` by M (ALIGN px -> ART px):
    premultiplied colour and alpha, float, the base's shape."""
    T = np.hstack([M[:, :2] * (ALIGN / figure.shape[0]), M[:, 2:]]) * (out / ART)
    height, width = base.shape[:2]
    f = figure.astype(np.float32)
    layer = np.dstack([f[:, :, :3] * (f[:, :, 3:4] / 255), f[:, :, 3:4]])   # premultiplied: resampling darkens no edge
    shrink = float(np.hypot(T[0, 0], T[1, 0]))
    if shrink < 1:   # bring it near the output's scale first; warpAffine cannot average pixels away
        layer = cv2.resize(layer, None, fx=shrink, fy=shrink, interpolation=cv2.INTER_AREA)
        T = np.hstack([T[:, :2] / shrink, T[:, 2:]])
    warped = cv2.warpAffine(layer, T, (width, height), flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0, 0))
    return np.clip(warped[:, :, :3], 0, 255), np.clip(warped[:, :, 3:4] / 255, 0, 1)


def _blur(image, k):
    return cv2.GaussianBlur(image, (0, 0), 4 * k)


def _toned(base, colour, alpha, k):
    """The figure's colour with the art's smooth shift laid on it: a haze, a tint or a light the art paints over
    the monster goes on the sharp figure instead of leaving the blurred art in its place (엘리스 10/15: 라이징
    리벨리온 팔콘 "묘하게 흐리지 않나요"). Only where the art and the figure draw the same thing (their edges
    correlate) or the shift is slight; a thing the art puts in front of the monster (an island, a hand) stays."""
    blur = lambda im, s: cv2.GaussianBlur(im, (0, 0), s * k)
    m = (alpha[:, :, 0] > 0.95).astype(np.float32)
    m3 = m[:, :, None]
    near = np.maximum(blur(m, 4), 1e-3)[:, :, None]
    gap = (blur(base * m3, 4) / near - blur(colour * m3, 4) / near) * m3
    shift = blur(gap, 16) / np.maximum(blur(m, 16), 1e-3)[:, :, None]
    art_edges = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    fig_edges = cv2.cvtColor(np.clip(colour, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    art_edges = blur(art_edges, 2) - blur(art_edges, 6)
    fig_edges = blur(fig_edges, 2) - blur(fig_edges, 6)
    mean = lambda im: blur(im, 20)
    spread = (mean(art_edges ** 2) - mean(art_edges) ** 2) * (mean(fig_edges ** 2) - mean(fig_edges) ** 2)
    same = (mean(art_edges * fig_edges) - mean(art_edges) * mean(fig_edges)) / np.sqrt(np.maximum(spread, 1e-3))
    allowed = ((same > 0.3) | (np.abs(shift).mean(axis=2) < 20)).astype(np.float32)
    return np.clip(colour + shift * blur(allowed, 2)[:, :, None] * alpha, 0, 255)


def _finished(base, colour, alpha, out):
    """The laid figure, toned like the art, over the art where the two agree, and the figures of merit."""
    k = out / 1024
    colour = _toned(base, colour, alpha, k)
    whole = base * (1 - alpha) + colour
    differs = np.abs(_blur(whole, k) - _blur(base, k)).mean(axis=2)
    solid = alpha[:, :, 0] > 0.95
    covered = float((solid & (differs > 40)).sum() / max(solid.sum(), 1))
    gap = float(differs[solid].mean()) if solid.any() else 255.0
    agree = (differs < 30).astype(np.float32)
    agree = cv2.erode(agree, np.ones((int(11 * k) | 1,) * 2, np.uint8))
    agree = cv2.GaussianBlur(agree, (0, 0), 1.5 * k)[:, :, None]
    picture = base * (1 - alpha * agree) + colour * agree
    return picture.clip(0, 255).astype(np.uint8), covered, float((alpha > 0.5).mean()), gap


def compose(figure, M, art, out=OUT):
    """The figure (BGRA, any square size) laid on the art by M (ALIGN px -> ART px), the art's shape with its longer
    side `out` px: the picture (BGR), the share of the figure the art covers with something else, the share of the
    picture the figure fills, and how far the figure is from the art on average where it is solid (the gap: a
    figure wearing the wrong face scores higher)."""
    base = enlarged(art, out).astype(np.float32)
    return _finished(base, *_laid(figure, M, base, out), out)


def compose_looks(figures, M, art, out=OUT):
    """Several renders of the same pose in different looks (eyes shut or open, a slot faded in or not), laid on the
    art together. Where the looks differ from one another, each connected patch of difference is taken whole from
    the look nearest the art over that patch: the open eyes win the face (a face is one patch, so its chin line is
    not stitched from two faces, 2026-10-15 아폴로우사), the rest pose wins a patch where a later look adds what the
    art has not. Returns what `compose` does, then each look's share of the solid figure."""
    k = out / 1024
    base = enlarged(art, out).astype(np.float32)
    laid = [_laid(f, M, base, out) for f in figures]
    wholes = [base * (1 - a) + c for c, a in laid]
    soft = [cv2.GaussianBlur(w, (0, 0), 2 * k) for w in wholes]
    base_soft = cv2.GaussianBlur(base, (0, 0), 2 * k)
    far = np.stack([np.where(a[:, :, 0] > 0.95, np.abs(sw - base_soft).mean(axis=2), 255.0) for sw, (_, a) in zip(soft, laid)])
    spread = (np.max(soft, axis=0) - np.min(soft, axis=0)).max(axis=2)   # where the looks disagree among themselves
    count, patches = cv2.connectedComponents((spread > 10).astype(np.uint8), connectivity=8)
    choice = np.zeros(base.shape[:2], np.int32)
    if count > 1:
        sums = np.stack([np.bincount(patches.ravel(), weights=f.ravel(), minlength=count) for f in far])   # look × patch
        best = sums.argmin(axis=0)
        best[0] = 0
        choice = best[patches]
    weights = [cv2.GaussianBlur((choice == i).astype(np.float32), (0, 0), 3 * k)[:, :, None] for i in range(len(laid))]
    total = np.maximum(sum(weights), 1e-6)
    colour = sum(w * c for w, (c, _) in zip(weights, laid)) / total
    alpha = sum(w * a for w, (_, a) in zip(weights, laid)) / total
    solid = alpha[:, :, 0] > 0.95
    shares = [round(float(((choice == i) & solid).sum() / max(solid.sum(), 1)), 3) for i in range(len(laid))]
    return (*_finished(base, colour, alpha, out), shares)


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


# moments of the animation whose look (eyes open, slots faded in) the rest pose is tried with, besides its own;
# the very start and end are left out, where most cut-ins are faded away
LOOKS = (None, 0.15, 0.35, 0.55, 0.75, 0.95)


def make(md_id, render, out_dir):
    """One print's illustration, `render(size, look)` drawing its cut-in at rest on a transparent square of that
    size (BGRA), wearing the animation's look at `look` (0..1) or its own (None). The look nearest the art wins:
    the rest pose often has the eyes shut, and the art the open ones (엘리스 10/15: "얼굴이 흐릿해요"). The row says
    what came of it; one that fits has its picture at out_dir/<md_id>.webp."""
    print_ = MdPrint.objects.select_related("card").filter(md_id=md_id).first()
    row = {"md_id": md_id, "name": illust_name(print_) if print_ else ""}
    if print_ is None:
        return row | {"verdict": "no_print"}
    path = art_file(md_id)
    if path is None:
        return row | {"verdict": "no_art"}
    art = cv2.imread(str(path))
    figure = render(DRAW, None)
    found = align(cv2.resize(figure, (ALIGN, ALIGN), interpolation=cv2.INTER_AREA), art)
    if found is not None:
        row |= {"inliers": found.inliers, "error": round(found.error, 2), "scale": round(found.scale, 4), "rotation": round(found.rotation, 2)}
    if found is None or not found.fits():
        return row | {"verdict": "unaligned"}
    # about one drawn pixel per shown pixel: a figure the art shows larger than the first render is drawn again
    want = int(min(4096, max(OUT, round(DRAW * found.scale / 256) * 256)))
    size = max(want, DRAW)
    figures = [figure if look is None and size == DRAW else render(size, look) for look in LOOKS]
    picture, covered, cover, gap, shares = compose_looks(figures, found.M, art)
    file = Path(out_dir, f"{md_id}.webp")
    cv2.imwrite(str(file), picture, [cv2.IMWRITE_WEBP_QUALITY, 92])
    return row | {"verdict": "clean" if covered <= CLEAN else "check", "covered": round(covered, 4), "cover": round(cover, 3),
                  "looks": dict(zip(map(str, LOOKS), shares)), "gap": round(gap, 2), "file": str(file)}


class PoseRenderer:
    """Draws cut-ins at rest in a headless browser with the site's own Spine player (frontend/src/tools/cutinPose.ts,
    bundled into `work` on entry). The page is served from disk, the media folder under /media/. The browser lives
    on its own thread: Playwright's event loop on the main thread would have Django refuse every query."""
    ORIGIN = "http://cutin.local"

    def __init__(self, work):
        self.work = Path(work)

    PATIENCE = 600   # seconds a drawing may take before the browser is given up on

    def __enter__(self):
        subprocess.run([str(FRONTEND / "node_modules/.bin/esbuild"), str(FRONTEND / "src/tools/cutinPose.ts"), "--bundle",
                        "--format=iife", "--log-level=warning", f"--outfile={self.work / 'render.js'}"], check=True)
        (self.work / "index.html").write_text('<!doctype html><meta charset="utf-8"><script src="/render.js"></script>')
        self._launch()
        return self

    def __exit__(self, *exc):
        self._stop()

    def _launch(self):
        self.requests, self.replies = queue.Queue(), queue.Queue()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self._reply()   # the page is up, or the launch failed

    def _stop(self):
        self.requests.put(None)
        self.thread.join(timeout=30)

    def _reply(self):
        try:
            reply = self.replies.get(timeout=self.PATIENCE)
        except queue.Empty:
            raise RuntimeError("the browser stopped answering") from None
        if isinstance(reply, Exception):
            raise reply
        return reply

    @staticmethod
    def _browser_gone(e):
        return isinstance(e, RuntimeError) or any(s in str(e) for s in ("Connection closed", "Target closed", "has been closed", "crashed"))

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
                try:
                    browser.close()
                except Exception:   # noqa: BLE001 — already gone
                    pass
        except Exception as e:   # noqa: BLE001
            self.replies.put(e)

    def _serve(self, route):
        path = urlparse(route.request.url).path
        file = Path(settings.MEDIA_ROOT, path[len("/media/"):]) if path.startswith("/media/") else self.work / path.lstrip("/")
        if file.is_file():
            route.fulfill(path=str(file))
        else:
            route.fulfill(status=404)

    def _draw(self, page, md_id, version, size, look):
        failure = None
        arg = json.dumps({"anim": look[0], "t": look[1]}) if look else "undefined"
        for attempt in range(3):
            if attempt:   # a fresh page: a decode the browser refused, or an empty drawing, after many cut-ins
                page.goto(f"{self.ORIGIN}/index.html")
            try:
                png = page.evaluate(f"renderCutinPose('/media/md_ui/cutin/{md_id}', {version}, {size}, {arg}).then((r) => r.png)")
            except Exception as e:   # noqa: BLE001
                failure = e
                continue
            image = cv2.imdecode(np.frombuffer(base64.b64decode(png.split(",", 1)[1]), np.uint8), cv2.IMREAD_UNCHANGED)
            # a look may well show nothing (the figure faded out at that moment); the rest pose never does
            if image is not None and image.shape[2] == 4 and (look or image[:, :, 3].any()):
                return image
            failure = RuntimeError(f"cut-in {md_id} drew nothing at {size} px")
        raise failure

    def render(self, md_id, version, size, look=None):
        """The print's cut-in at rest, fitted on a transparent `size` px square: BGRA. `look` = (animation name,
        0..1) dresses it in what that moment of the animation shows. A browser that died or stopped answering
        (2026-10-15: a night's run hung at card 463) is replaced and the drawing asked for once more."""
        self.requests.put((md_id, version, size, look))
        try:
            return self._reply()
        except Exception as e:   # noqa: BLE001
            if not self._browser_gone(e):
                raise
            self._stop()
            self._launch()
            self.requests.put((md_id, version, size, look))
            return self._reply()
