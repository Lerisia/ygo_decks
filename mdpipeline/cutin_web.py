"""Master Duel's monster cut-ins made ready for the card book's own player (frontend/src/lib/spine): per card the
skeleton (minified json), the atlas with its pages as WebP, and an index of which animation plays and how the game's
camera frames it (엘리스 2026-10-11). Konami's assets: written to media, never to the public repository.

usage: cutin_web.py <cutin dir (cutin_extract.py's)> <LocalData dir> <containers.json> <out dir> [--quality 88]

index.json: {card id: {"anim": name, "view": [cx, cy, half height], "mp": megapixels of the large pages}} — the
phones take the large pictures unless they weigh too much; the view in skeleton units: the game shows the
cut-in through an orthographic camera (camera2DSize is half the screen's height) on a prefab scaled down (0.01 per
skeleton unit, then the prefab's own scale), so the same framing comes out here.
"""
import argparse
import json
import multiprocessing
import os
import re

import UnityPy
from PIL import Image

SKELETON_SCALE = 0.01   # SkeletonDataAsset.scale of every cut-in
ANIMS = ("animation", "animation_kde")


def view_of(prefab_bundle, card):
    """[cx, cy, half height] from the prefab's camera setting and the transforms above its Spine object, None when the
    prefab has no camera setting."""
    env = UnityPy.load(prefab_bundle)
    cam, spine_go, transforms = None, None, {}
    for obj in env.objects:
        if obj.type.name == "MonoBehaviour":
            try:
                tt = obj.read_typetree()
            except Exception:
                continue
            if "camera2DSize" in tt:
                cam = tt
            if "skeletonDataAsset" in tt:
                spine_go = tt["m_GameObject"]["m_PathID"]
        elif obj.type.name == "Transform":
            transforms[obj.path_id] = obj.read_typetree()
    if not cam:
        return None
    t = next((tt for tt in transforms.values() if tt["m_GameObject"]["m_PathID"] == spine_go), None)
    if t is None:
        return None
    chain = []
    while t is not None:
        chain.append(t)
        t = transforms.get(t["m_Father"]["m_PathID"])
    s, ox, oy = 1.0, 0.0, 0.0
    for tt in reversed(chain):   # from the prefab root down to the Spine object
        pos, sc = tt["m_LocalPosition"], tt["m_LocalScale"]
        ox += pos["x"] * s
        oy += pos["y"] * s
        s *= sc["x"]
    unit = SKELETON_SCALE * s
    cx = (cam["cameraPosition"]["x"] - ox) / unit
    cy = (cam["cameraPosition"]["y"] - oy) / unit
    return [round(cx, 2), round(cy, 2), round(cam["camera2DSize"] / unit, 2)]


def megapixels(folder):
    """Pixels of all the atlas pages of a cut-in, in millions (the GPU memory it takes is four bytes each)."""
    atlas = open(os.path.join(folder, "atlas.txt")).read()
    pages = re.findall(r"^\S+\.png\s*\n\s*size:\s*(\d+),\s*(\d+)", atlas, re.M)
    return round(sum(int(w) * int(h) for w, h in pages) / 1e6, 1)


def _card(job):
    """One cut-in written out; its animation's name (the view is read separately, from the prefab)."""
    src, dst, quality = job
    os.makedirs(dst, exist_ok=True)
    skel = json.load(open(os.path.join(src, "skeleton.json")))
    anim = next((a for a in ANIMS if a in skel.get("animations", {})), next(iter(skel.get("animations", {})), None))
    json.dump(skel, open(os.path.join(dst, "skeleton.json"), "w"), separators=(",", ":"))
    atlas = open(os.path.join(src, "atlas.txt")).read()
    for page in re.findall(r"^(\S+)\.png\s*$", atlas, re.M):
        out = os.path.join(dst, page + ".webp")
        if not os.path.exists(out):
            Image.open(os.path.join(src, page + ".png")).save(out, quality=quality, method=4)
    open(os.path.join(dst, "atlas.txt"), "w").write(re.sub(r"^(\S+)\.png(\s*)$", r"\1.webp\2", atlas, flags=re.M))
    return anim


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cutin")
    ap.add_argument("local")
    ap.add_argument("containers")
    ap.add_argument("out")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--source", default="highend_hd", help="highend_hd, or sd for phones (pages a quarter the size)")
    args = ap.parse_args()
    bundles = json.load(open(args.containers))
    prefab = {}
    for f, names in bundles.items():
        for n in names:
            m = re.search(r"monstercutin/tcg/p(\d+)/highend_hd/p\d+\.prefab$", n)
            if m:
                prefab[m.group(1)] = os.path.join(args.local, f)
    src_root = os.path.join(args.cutin, args.source)
    # a few cut-ins are layered pictures, not Spine (no skeleton or atlas): the player can't show those
    cards = [c for c in sorted(os.listdir(src_root), key=int)
             if all(os.path.exists(os.path.join(src_root, c, f)) for f in ("skeleton.json", "atlas.txt"))]
    with multiprocessing.Pool(12) as pool:
        anims = pool.map(_card, [(os.path.join(src_root, c), os.path.join(args.out, c), args.quality) for c in cards])
    index = {c: {"anim": a, "view": view_of(prefab[c], c) if c in prefab else None, "mp": megapixels(os.path.join(src_root, c))}
             for c, a in zip(cards, anims)}
    json.dump(index, open(os.path.join(args.out, "index.json"), "w"), separators=(",", ":"))
    print(len(index), "cut-ins")


if __name__ == "__main__":
    main()
