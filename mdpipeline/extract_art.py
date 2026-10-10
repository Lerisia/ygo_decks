import argparse
import json
import os
import re

import UnityPy

from bundles import update_index, write_json

ART = re.compile(r"assets/resources/card/images/illust/(common|ocg|tcg)/\d+/(\d+)\.(?:bmp|png)$")


def save_webp(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    img.convert("RGB").save(tmp, "WEBP", quality=90, method=6)
    os.replace(tmp, path)


def extract(local_data, index_path, out_dir, versions):
    index, scanned = update_index(local_data, index_path)
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    made = failed = 0
    for rel, info in sorted(index.items()):
        for name in info["names"]:
            m = ART.match(name)
            if not m or m.group(1) not in versions:
                continue
            key = f"{m.group(1)}/{m.group(2)}"
            src = [rel, info["size"], info["mtime"]]
            if manifest.get(key, {}).get("src") == src and os.path.exists(os.path.join(out_dir, f"{key}.webp")):
                continue
            try:
                env = UnityPy.load(os.path.join(local_data, rel))
                img = next(o.read().image for o in env.objects if o.type.name == "Texture2D")
            except Exception as e:
                failed += 1
                print("failed", key, rel, e, flush=True)
                continue
            save_webp(img, os.path.join(out_dir, f"{key}.webp"))
            manifest[key] = {"src": src, "size": list(img.size)}
            made += 1
            if made % 500 == 0:
                write_json(manifest_path, manifest)
                print("made", made, flush=True)
    write_json(manifest_path, manifest)
    return {"bundles_scanned": scanned, "made": made, "failed": failed, "arts": len(manifest)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Save Master Duel card art from LocalData as webp; files already saved from the same bundle are skipped.")
    ap.add_argument("--local-data", required=True)
    ap.add_argument("--index", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--versions", required=True, help="comma separated: common,ocg,tcg")
    a = ap.parse_args()
    print(extract(a.local_data, a.index, a.out, set(a.versions.split(","))))
