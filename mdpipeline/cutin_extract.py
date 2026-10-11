"""Master Duel's monster cut-ins (the Spine 4.2 animation an ace monster plays as it is summoned, 엘리스 2026-10-11):
every card's skeleton (json), atlas and textures, in both qualities, saved as Spine's web player reads them
(textures named as the atlas names them). Konami's assets: they go to storage, never to the public repository.

usage: cutin_extract.py <LocalData dir> <containers.json> <out dir> [card id ...]
  containers.json: {bundle file: [container paths]} for the LocalData bundles
"""
import json
import os
import re
import sys
from collections import defaultdict

import UnityPy

PATH = re.compile(r"duel/timeline/duel/monstercutin/(tcg|ocg)/p(\d+)/(highend_hd|sd)/(?:(?:[\d.]+|img|image)/)?([^/]+)$")


def main():
    local, containers, out = sys.argv[1:4]
    only = set(sys.argv[4:])
    bundles = json.load(open(containers))
    # the Japanese client keeps an OCG version of some cut-ins (ocg/) next to the TCG one: that one wins (엘리스 10/11)
    ocg = {m.group(2) for names in bundles.values() for n in names if (m := PATH.search(n)) and m.group(1) == "ocg"}
    want = defaultdict(list)
    for f, names in bundles.items():
        for n in names:
            m = PATH.search(n)
            if not m or (m.group(1) == "tcg" and m.group(2) in ocg):
                continue
            if (not only or m.group(2) in only) and (n.endswith(".json") or n.endswith(".atlas.txt") or n.endswith(".png")):
                want[f].append((n, m.group(2), m.group(3), m.group(4)))
    done = 0
    for f, items in want.items():
        env = UnityPy.load(os.path.join(local, f))
        by_path = dict(env.container.items())
        for n, card, quality, name in items:
            obj = by_path.get(n)
            if obj is None:
                continue
            folder = os.path.join(out, quality, card)
            os.makedirs(folder, exist_ok=True)
            data = obj.read()
            if obj.type.name == "TextAsset":
                sc = data.m_Script
                raw = sc.encode("utf-8", "surrogateescape") if isinstance(sc, str) else bytes(sc)
                open(os.path.join(folder, "skeleton.json" if name.endswith(".json") else "atlas.txt"), "wb").write(raw)
            elif obj.type.name == "Texture2D":
                data.image.save(os.path.join(folder, name))
            done += 1
    # the atlas names its pages (P17795.png …); the files keep the bundle's lower-case names: link them as named
    for quality in ("highend_hd", "sd"):
        root = os.path.join(out, quality)
        for card in os.listdir(root) if os.path.isdir(root) else []:
            folder = os.path.join(root, card)
            atlas = os.path.join(folder, "atlas.txt")
            if not os.path.exists(atlas):
                continue
            for page in re.findall(r"^(\S+\.png)\s*$", open(atlas).read(), re.M):
                have = {x.lower(): x for x in os.listdir(folder)}
                if page not in os.listdir(folder) and page.lower() in have:
                    os.rename(os.path.join(folder, have[page.lower()]), os.path.join(folder, page))
    print(done, "files")


if __name__ == "__main__":
    main()
