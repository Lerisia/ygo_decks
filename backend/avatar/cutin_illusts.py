"""Illustrations for the icon pool from the summon cut-ins (엘리스 2026-10-15: "라투디는 초고화질이라 아이콘을 만들기
적합"). A cut-in's figure at rest is the card's monster as the art draws it: laid on the art it lies within half a
pixel, with no turn. So the figure, drawn large, replaces the art's monster where the two agree, and what the art
paints in front of the monster (spray, flames, light) stays as drawn. The art itself is only 512 px; the figure is
the sharp part. "모양을 잘 맞춰봐요. 안 맞으면 못 하는 거고": a figure that does not lie on its art is left out."""
import base64
import json
import queue
import subprocess
import hashlib
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
LINES = 0.45    # how well the fine lines must coincide for the figure to count as plainly in place
BAR = 30        # how far (blurred levels) the figure may differ from the art and still replace it...
BAR_SURE = 80   # ...and where it is plainly in place
GLOW = 15       # how much brighter than the toned figure the art must be for a light to count as the art's own
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
    리벨리온 팔콘 "묘하게 흐리지 않나요"). Only where the art and the figure draw the same thing (their big shapes
    correlate) or the shift is slight; a thing the art puts in front of the monster (an island, a hand) stays.
    Returns the toned colour and the map of where the drawing matches."""
    blur = lambda im, s: cv2.GaussianBlur(im, (0, 0), s * k)
    m = (alpha[:, :, 0] > 0.95).astype(np.float32)
    m3 = m[:, :, None]
    near = np.maximum(blur(m, 4), 1e-3)[:, :, None]
    gap = (blur(base * m3, 4) / near - blur(colour * m3, 4) / near) * m3
    shift = blur(gap, 16) / np.maximum(blur(m, 16), 1e-3)[:, :, None]
    art_edges = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    fig_edges = cv2.cvtColor(np.clip(colour, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    # the big shapes (σ 12–36 at 1024 px) over a wide window: the art's blur and haze wash out anything finer
    art_edges = blur(art_edges, 12) - blur(art_edges, 36)
    fig_edges = blur(fig_edges, 12) - blur(fig_edges, 36)
    mean = lambda im: blur(im, 96)
    spread = (mean(art_edges ** 2) - mean(art_edges) ** 2) * (mean(fig_edges ** 2) - mean(fig_edges) ** 2)
    same = (mean(art_edges * fig_edges) - mean(art_edges) * mean(fig_edges)) / np.sqrt(np.maximum(spread, 1e-3))
    drawn = blur((same > 0.12).astype(np.float32), 2)
    allowed = np.maximum(drawn, (np.abs(shift).mean(axis=2) < 20).astype(np.float32))
    return np.clip(colour + shift * blur(allowed, 2)[:, :, None] * alpha, 0, 255), drawn


def _lines_match(base, colour, k):
    """How well the fine lines (4–12 px bands at 1024) of the art and of the laid figure coincide, window by
    window: near 1 where the art shows the very figure, near 0 under haze, behind a thing in front, or where the
    figure sits elsewhere than the art's."""
    blur = lambda im, s: cv2.GaussianBlur(im, (0, 0), s * k)
    art = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    fig = cv2.cvtColor(np.clip(colour, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    art = blur(art, 2) - blur(art, 6)
    fig = blur(fig, 2) - blur(fig, 6)
    mean = lambda im: blur(im, 20)
    spread = (mean(art * art) - mean(art) ** 2) * (mean(fig * fig) - mean(fig) ** 2)
    return (mean(art * fig) - mean(art) * mean(fig)) / np.sqrt(np.maximum(spread, 1e-3))


def _finished(base, colour, alpha, out, keep_lights=True):
    """The laid figure, toned like the art, over the art where the two agree, and the figures of merit. With
    `keep_lights` off, a light the art paints over the figure no longer holds the figure out (a card whose haze
    the art lights everywhere, so that nothing of the figure would show: 엘리스 10/16, 라이징 리벨리온 팔콘
    "빛 무시하구 넣어보면요") — the lights go soft and a thing in front may let the figure through, so only by name."""
    k = out / 1024
    colour, _ = _toned(base, colour, alpha, k)
    whole = base * (1 - alpha) + colour
    differs = np.abs(_blur(whole, k) - _blur(base, k)).mean(axis=2)
    solid = alpha[:, :, 0] > 0.95
    covered = float((solid & (differs > 40)).sum() / max(solid.sum(), 1))
    gap = float(differs[solid].mean()) if solid.any() else 255.0
    # Where the fine lines of the art and of the figure coincide, the figure is plainly in place and the same
    # drawing, so it keeps its lines even under the sparks and bolts the art paints across it (엘리스 10/15,
    # 네가로기어 아제우스's hands: "라투디가 존재하는 영역의 선을 흐리게 하는 일은 없었으면"). A hazed part, an
    # occluded part or a part the rest pose holds elsewhere (라이징 리벨리온 팔콘's lower body) has no such match
    # (its correlation sits near 0) and keeps the strict bar, so it never doubles up.
    # a region, not a speck: most of a neighbourhood (σ 6 at 1024) must match
    sure = cv2.GaussianBlur((_lines_match(base, colour, k) > LINES).astype(np.float32), (0, 0), 6 * k)
    agree = (differs < np.where(sure > 0.5, BAR_SURE, BAR)).astype(np.float32)
    # a light the art adds over the figure (a muzzle flash, a burst, rays) is far brighter than the toned figure
    # beneath it, which the smooth toning cannot give: it stays the art's, however well the lines match beneath
    # (엘리스 10/15, 구스타프 맥스: "포문 쪽 빛 터지는 게 좀 사라졌어요")
    luminance = lambda im: cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    if keep_lights:
        glow = cv2.GaussianBlur(np.clip(luminance(base) - luminance(whole), 0, 255), (0, 0), 2 * k)
        agree = np.minimum(agree, np.clip((GLOW + 10 - glow) / 20, 0, 1))
    # the margin eroded off the agreeing area keeps a seam from showing, but it also took the thin tips (claws,
    # fingers) off a figure that is plainly in place; there the figure keeps its own edge (10/16)
    eroded = cv2.erode(agree, np.ones((int(11 * k) | 1,) * 2, np.uint8))
    agree = cv2.GaussianBlur(np.where(sure > 0.5, agree, eroded), (0, 0), 1.5 * k)[:, :, None]
    picture = base * (1 - alpha * agree) + colour * agree
    return picture.clip(0, 255).astype(np.uint8), covered, float((alpha > 0.5).mean()), gap


def compose(figure, M, art, out=OUT, keep_lights=True):
    """The figure (BGRA, any square size) laid on the art by M (ALIGN px -> ART px), the art's shape with its longer
    side `out` px: the picture (BGR), the share of the figure the art covers with something else, the share of the
    picture the figure fills, and how far the figure is from the art on average where it is solid (the gap: a
    figure wearing the wrong face scores higher)."""
    base = enlarged(art, out).astype(np.float32)
    return _finished(base, *_laid(figure, M, base, out), out, keep_lights)


def erase_and_lay(base, colour, alpha, out):
    """The figure trusted over the art (엘리스 10/16: "원본을 지운다", "배경을 채우는 방식으로 아예 삭제"): the art's
    monster — everything that is not background haze within the figure's reach — is cut out and the hole filled
    with a quilt of the art's own calm haze, then the figure is laid on that plate. For a card whose pose the
    cut-in moved a little (라이징 리벨리온 팔콘's head and lower body), so that the art's old parts would show
    beside the new; never where something stands in front of the figure, since that goes too. The plate's low
    frequencies come from an inpaint of the hole, its grain from real haze tiles (half-overlap, feathered), so the
    hole carries the sky's gradient and its texture without the monster's ghost."""
    k = out / 1024
    art = base.astype(np.uint8)
    footprint = (alpha[:, :, 0] > 0.5).astype(np.uint8)
    hsv = cv2.cvtColor(art, cv2.COLOR_BGR2HSV)
    haze = ((hsv[:, :, 2] > 150) & (hsv[:, :, 1] < 90)).astype(np.uint8)
    reach = cv2.dilate(footprint, np.ones((int(80 * k) + 1,) * 2, np.uint8))
    monster = ((reach > 0) & ((footprint > 0) | (haze == 0))).astype(np.uint8)
    monster = cv2.dilate(monster, np.ones((int(8 * k) + 1,) * 2, np.uint8))
    low = cv2.GaussianBlur(cv2.inpaint(art, monster, 25, cv2.INPAINT_TELEA).astype(np.float32), (0, 0), 40 * k)
    texture = base - cv2.GaussianBlur(base, (0, 0), 40 * k)
    fine = np.abs(base - cv2.GaussianBlur(base, (0, 0), 1.5 * k)).mean(axis=2)
    calm = cv2.GaussianBlur(fine, (0, 0), 8 * k) < 1.2                     # haze grain, not a bolt
    clean = cv2.erode(((monster == 0) & calm).astype(np.uint8), np.ones((int(8 * k) + 1,) * 2, np.uint8))
    H, W = art.shape[:2]
    T, O = int(96 * k), int(48 * k)
    rng = np.random.default_rng(int(base[::64, ::64].sum()) & 0xFFFF)
    ys, xs = np.where(clean[O:H - T - O, O:W - T - O] > 0)
    quilt = np.zeros((H, W, 3), np.float32)
    weight = np.zeros((H, W, 1), np.float32)
    ramp = np.minimum(np.minimum(np.arange(T), np.arange(T)[::-1]) + 1, O) / O
    feather = (ramp[:, None] * ramp[None, :])[:, :, None].astype(np.float32)
    if len(ys):
        for y in range(0, H - T + 1, T - O):
            for x in range(0, W - T + 1, T - O):
                for _ in range(300):
                    i = rng.integers(len(ys))
                    sy, sx = ys[i] + O, xs[i] + O
                    if clean[sy:sy + T, sx:sx + T].all():
                        break
                quilt[y:y + T, x:x + T] += texture[sy:sy + T, sx:sx + T] * feather
                weight[y:y + T, x:x + T] += feather
    plate = np.where(monster[:, :, None] > 0, low + 0.6 * quilt / np.maximum(weight, 1e-3), base)
    toned, _ = _toned(base, colour, alpha, k)
    picture = (plate * (1 - alpha) + toned).clip(0, 255).astype(np.uint8)
    solid = alpha[:, :, 0] > 0.95
    return picture, 0.0, float((alpha > 0.5).mean()), 0.0


def compose_looks(figures, M, art, out=OUT, keep_lights=True, erase=False):
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
    if erase:
        return (*erase_and_lay(base, colour, alpha, out), shares)
    return (*_finished(base, colour, alpha, out, keep_lights), shares)


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
    # the name carries the picture's own hash: nginx has browsers keep /media/ for ten years, so a picture made
    # again under the old name would never reach a phone that has seen it, while an unchanged one keeps its address (10/16)
    obj.image.save(f"cutin_{print_.md_id}_{hashlib.sha1(data).hexdigest()[:8]}.webp", ContentFile(data), save=False)
    obj.save()
    return obj, created


# moments of the animation whose look (eyes open, slots faded in) the rest pose is tried with, besides its own;
# the very start and end are left out, where most cut-ins are faded away
LOOKS = (None, 0.15, 0.35, 0.55, 0.75, 0.95)


def make(md_id, render, out_dir, keep_lights=True, erase=False):
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
    picture, covered, cover, gap, shares = compose_looks(figures, found.M, art, keep_lights=keep_lights, erase=erase)
    file = Path(out_dir, f"{md_id}.webp")
    cv2.imwrite(str(file), picture, [cv2.IMWRITE_WEBP_QUALITY, 92])
    return row | {"verdict": "clean" if covered <= CLEAN else "check", "covered": round(covered, 4), "cover": round(cover, 3),
                  "looks": dict(zip(map(str, LOOKS), shares)), "lights": keep_lights, "erase": erase, "gap": round(gap, 2), "file": str(file)}


class PoseRenderer:
    """Draws cut-ins at rest in a headless browser with the site's own Spine player (frontend/src/tools/cutinPose.ts,
    bundled into `work` on entry). The page is served from disk, the media folder under /media/. The browser lives
    on its own thread: Playwright's event loop on the main thread would have Django refuse every query."""
    ORIGIN = "http://cutin.local"

    def __init__(self, work):
        self.work = Path(work)

    PATIENCE = 180   # seconds a drawing may take before the browser is given up on (one takes 10–60; a dead driver
                     # answers never, and must be replaced well inside the watch a long run keeps on its log)

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
