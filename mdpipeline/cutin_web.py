"""Master Duel's monster cut-ins made ready for the card book's own player (frontend/src/lib/spine): per card the
skeleton (minified json), the atlas with its pages as WebP, and an index of which animation plays and how the game's
camera frames it (엘리스 2026-10-11). Konami's assets: written to media, never to the public repository.

usage: cutin_web.py <cutin dir (cutin_extract.py's)> <LocalData dir> <containers.json> <out dir> [--quality 88]

index.json: {card id: {"anim": name, "view": [cx, cy, half height]}} — the view in skeleton units: the game shows the
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
    """[cx, cy, half height] from the prefab's camera setting and its transforms, None when the prefab has none."""
    env = UnityPy.load(prefab_bundle)
    cam, scales = None, {}
    for obj in env.objects:
        if obj.type.name == "MonoBehaviour":
            try:
                tt = obj.read_typetree()
            except Exception:
                continue
            if "camera2DSize" in tt:
                cam = tt
        elif obj.type.name == "Transform":
            tt = obj.read_typetree()
            scales[obj.path_id] = tt
    if not cam:
        return None
    # the chain from the prefab root down: every transform's scale and position count
    by_child = {}
    for pid, tt in scales.items():
        for ch in tt.get("m_Children", []):
            by_child[ch["m_PathID"]] = pid
    leaves = [pid for pid, tt in scales.items() if not tt.get("m_Children")]
    leaf = leaves[0] if leaves else next(iter(scales))
    chain, p = [], leaf
    while p in scales:
        chain.append(scales[p])
        p = by_child.get(p)
    chain.reverse()
    s, ox, oy = 1.0, 0.0, 0.0
    for tt in chain:
        pos, sc = tt["m_LocalPosition"], tt["m_LocalScale"]
        ox += pos["x"] * s
        oy += pos["y"] * s
        s *= sc["x"]
    unit = SKELETON_SCALE * s
    cx = (cam["cameraPosition"]["x"] - ox) / unit
    cy = (cam["cameraPosition"]["y"] - oy) / unit
    return [round(cx, 2), round(cy, 2), round(cam["camera2DSize"] / unit, 2)]


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
    args = ap.parse_args()
    bundles = json.load(open(args.containers))
    prefab = {}
    for f, names in bundles.items():
        for n in names:
            m = re.search(r"monstercutin/tcg/p(\d+)/highend_hd/p\d+\.prefab$", n)
            if m:
                prefab[m.group(1)] = os.path.join(args.local, f)
    src_root = os.path.join(args.cutin, "highend_hd")
    # a few cut-ins are layered pictures, not Spine (no skeleton or atlas): the player can't show those
    cards = [c for c in sorted(os.listdir(src_root), key=int)
             if all(os.path.exists(os.path.join(src_root, c, f)) for f in ("skeleton.json", "atlas.txt"))]
    with multiprocessing.Pool(12) as pool:
        anims = pool.map(_card, [(os.path.join(src_root, c), os.path.join(args.out, c), args.quality) for c in cards])
    index = {c: {"anim": a, "view": view_of(prefab[c], c) if c in prefab else None} for c, a in zip(cards, anims)}
    json.dump(index, open(os.path.join(args.out, "index.json"), "w"), separators=(",", ":"))
    print(len(index), "cut-ins")


if __name__ == "__main__":
    main()
